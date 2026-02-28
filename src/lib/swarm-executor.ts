import { randomUUID } from 'crypto';
import { run, queryOne, queryAll } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { CORE_SWARM_TOOLS } from '@/lib/openclaw/skills';
import { executeToolByName } from '@/lib/openclaw/tool-executors';
import { sendTelegramReply, sendTelegramMessage } from '@/lib/telegram';
import { archiveToNotion } from '@/lib/notion-archiver';
import { createSwarmTracer } from '@/lib/tracer';
import { classifyIntent, formatIntentForPrompt } from '@/lib/pre-router';
import fs from 'fs';
import path from 'path';

const MAX_WAIT_MS = 600000; // 10 minutes streaming hard kill-switch
const HITL_REVIEW_WAIT_MS = 86400000; // 24 hours (do not auto-regress HITL state)
const TELEGRAM_CHUNK_SIZE = 4000;
const MAX_TOOL_LOOP = 6;

function resolvePublicBaseUrl() {
  const base = String(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3005').trim();
  return base.replace(/\/$/, '');
}

type GatewayEventEnvelope = {
  event?: string;
  payload?: any;
  seq?: number;
};

type ToolCallCandidate = {
  id: string;
  name: string;
  arguments: unknown;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trim(text: string, max = 220) {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stripHandoffLeak(rawContent: string | null | undefined): string {
  const raw = String(rawContent || '');
  if (!raw) return '';

  const splitByHandoff = raw.split(/\{?\s*"handoff"\s*:/i)[0] || raw;

  const cleaned = splitByHandoff
    .replace(/```json\s*$/i, '')
    .replace(/```\s*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

function logEvent(taskId: string, runId: string, summary: string, type = 'system') {
  const now = new Date().toISOString();
  run(
    `INSERT INTO events (id, type, task_id, message, metadata, created_at)
     VALUES (?, ?, NULL, ?, ?, ?)`,
    [randomUUID(), type, summary, JSON.stringify({ swarm_task_id: taskId, run_id: runId }), now]
  );
  broadcast({ type: 'event_logged', payload: { taskId, sessionId: runId, summary } });
}

function failRunAndTaskSafely(params: { taskId: string; runId: string; reason: string; report: string; preserveHitlReview?: boolean }) {
  const endedAt = new Date().toISOString();

  run(
    `UPDATE swarm_runs
     SET run_status = 'failed', ended_at = ?, error_message = ?, output_summary = COALESCE(output_summary, ?)
     WHERE run_id = ?`,
    [endedAt, params.reason, params.report, params.runId]
  );

  const current = queryOne<{ status: string | null }>('SELECT status FROM swarm_tasks WHERE task_id = ?', [params.taskId]);
  const currentStatus = String(current?.status || '').toLowerCase();

  if (params.preserveHitlReview && currentStatus === 'hitl_review') {
    logEvent(
      params.taskId,
      params.runId,
      `[HITL_WAIT] timeout reached ${HITL_REVIEW_WAIT_MS}ms. process terminated; DB state preserved as hitl_review for manual re-ignition.`
    );
    return { endedAt, taskStatus: 'hitl_review' as const };
  }

  run(`UPDATE swarm_tasks SET status = 'failed', updated_at = ? WHERE task_id = ?`, [endedAt, params.taskId]);
  return { endedAt, taskStatus: 'failed' as const };
}

function extractTextFromChatPayload(payload: any): string | null {
  const msg = payload?.message;
  if (!msg || msg.role !== 'assistant') return null;
  const content = msg.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((c) => c?.type === 'text' && typeof c?.text === 'string')
    .map((c) => c.text)
    .join('')
    .trim();
  return text || null;
}

function parseToolCallsDeep(node: any, out: ToolCallCandidate[]) {
  if (!node) return;

  if (Array.isArray(node)) {
    node.forEach((n) => parseToolCallsDeep(n, out));
    return;
  }

  if (typeof node !== 'object') return;

  const maybeToolCalls = (node as any).tool_calls;
  if (Array.isArray(maybeToolCalls)) {
    for (const tc of maybeToolCalls) {
      const id = String(tc?.id || randomUUID());
      const name = String(tc?.name || tc?.tool_name || tc?.function?.name || '').trim();
      const args = tc?.arguments ?? tc?.function?.arguments ?? {};
      if (name) out.push({ id, name, arguments: args });
    }
  }

  const type = String((node as any).type || '').toLowerCase();
  if (type === 'tool_call' || type === 'tool-use' || type === 'tool_use') {
    const id = String((node as any).id || randomUUID());
    const name = String((node as any).name || (node as any).tool_name || (node as any).function?.name || '').trim();
    const args = (node as any).arguments ?? (node as any).function?.arguments ?? {};
    if (name) out.push({ id, name, arguments: args });
  }

  for (const value of Object.values(node)) {
    parseToolCallsDeep(value, out);
  }
}

function extractToolCalls(payload: any): ToolCallCandidate[] {
  const out: ToolCallCandidate[] = [];
  parseToolCallsDeep(payload, out);
  return out;
}

function errorReportMarkdown(taskTitle: string, roleId: string, reason: string) {
  return [
    '# Executor Error Report',
    '',
    `- task: ${taskTitle}`,
    `- role: ${roleId}`,
    `- reason: ${reason}`,
    '',
    '시스템 타임아웃 또는 에러 발생. 로그를 확인하세요.',
  ].join('\n');
}

function buildTelegramMessages(taskTitle: string, markdown: string, taskId: string): string[] {
  const head = `✅ 작업 완료\n${taskTitle}\n(Task: ${taskId})\n\n`;
  const baseUrl = resolvePublicBaseUrl();
  const deepLink = `\n\n🔗 대시보드에서 확인하기: ${baseUrl}/workspace/default?taskId=${taskId}`;
  const full = `${head}${markdown}${deepLink}`;
  const chunks: string[] = [];

  for (let i = 0; i < full.length; i += TELEGRAM_CHUNK_SIZE) {
    chunks.push(full.slice(i, i + TELEGRAM_CHUNK_SIZE));
  }

  return chunks.length > 0 ? chunks : [head];
}

function isMasterReportTask(taskTitle: string) {
  const t = String(taskTitle || '').toLowerCase();
  return t.includes('synthesis & final report') || t.includes('final report');
}

function extractDomainAndSummary(markdown: string): { domain: '거시경제' | '데이터센터' | '투자전략'; summaryLines: string[] } {
  const content = String(markdown || '');
  const domainMatch = content.match(/\[DOMAIN:\s*(거시경제|데이터센터|투자전략)\s*\]/i);
  const domain = (domainMatch?.[1] as '거시경제' | '데이터센터' | '투자전략' | undefined) || '거시경제';

  const summaryHeader = /\[EXECUTIVE SUMMARY\]/i;
  const lines = content.split('\n');
  const startIndex = lines.findIndex((l) => summaryHeader.test(l));

  let summaryLines: string[] = [];
  if (startIndex >= 0) {
    summaryLines = lines
      .slice(startIndex + 1)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith('#') && !/^\[.*\]$/.test(l))
      .slice(0, 3);
  }

  if (summaryLines.length < 3) {
    const fallback = lines.map((l) => l.trim()).filter(Boolean).filter((l) => !l.startsWith('#')).slice(0, 3);
    summaryLines = (fallback.length ? fallback : ['요약 없음']).slice(0, 3);
  }

  while (summaryLines.length < 3) summaryLines.push('요약 없음');

  return { domain, summaryLines };
}

function buildMasterReportBroadcast(taskTitle: string, domain: string, summaryLines: string[], notionUrl: string) {
  const summary = summaryLines.join('\n');

  return [
    '🚀 [마스터 리포트 완성]',
    `🔹 제목: ${taskTitle}`,
    `🔹 도메인: ${domain}`,
    '[핵심 3줄 요약]',
    summary,
    `📂 노션에서 전문 읽기: ${notionUrl || 'N/A'}`,
  ].join('\n');
}

async function fanoutMasterReportDelivery(taskId: string, taskTitle: string, markdown: string, runId: string) {
  const { domain, summaryLines } = extractDomainAndSummary(markdown);

  let notionUrl = '';
  try {
    notionUrl = await archiveToNotion(taskTitle, markdown, domain);
    logEvent(taskId, runId, `[MASTER_ARCHIVE] Notion archived: ${notionUrl}`);
  } catch (error) {
    logEvent(taskId, runId, `[MASTER_ARCHIVE_ERROR] Notion archive failed: ${String(error)}`);
  }

  try {
    const msg = buildMasterReportBroadcast(taskTitle, domain, summaryLines, notionUrl);
    const masterChatId = process.env.TELEGRAM_MASTER_CHAT_ID;

    let res = await sendTelegramMessage({
      text: msg,
      chatId: masterChatId,
      parseMode: 'MarkdownV2',
    });

    let body = res ? await res.text().catch(() => '') : 'no_response';

    const parseError = /parse entities|can't parse entities|markdownv2|bad request/i.test(body || '');
    if (!res || !res.ok || parseError) {
      // Safe fallback: force plain text retry without parse_mode
      res = await sendTelegramMessage({
        text: msg,
        chatId: masterChatId,
      });
      body = res ? await res.text().catch(() => '') : 'no_response';
    }

    if (!res || !res.ok) {
      throw new Error(`telegram_master_broadcast_failed status=${res?.status || 'null'} body=${body}`);
    }

    logEvent(taskId, runId, '[MASTER_DELIVERY] Telegram direct broadcast delivered');
  } catch (error) {
    logEvent(taskId, runId, `[MASTER_DELIVERY_ERROR] Telegram direct broadcast failed: ${String(error)}`);
  }
}

function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractTelegramTarget(row: { metadata?: string | null; source_event?: string | null }) {
  const meta = parseJsonSafe(row.metadata || null) || {};
  const source = parseJsonSafe(row.source_event || null) || {};

  const chatId =
    meta?.telegram_chat_id ||
    source?.metadata?.telegram_chat_id ||
    source?.chat_id ||
    null;

  const messageId = Number(
    meta?.telegram_message_id ||
    source?.metadata?.telegram_message_id ||
    source?.message_id ||
    0
  );

  return {
    chatId: chatId ? String(chatId) : null,
    replyToMessageId: Number.isFinite(messageId) && messageId > 0 ? messageId : undefined,
  };
}

async function bridgeDeliverableToTelegram(taskId: string, taskTitle: string, finalMarkdown: string) {
  const hasMetadataColumn = queryAll<{ name: string }>('PRAGMA table_info(swarm_tasks)').some((c) => c.name === 'metadata');

  const row = hasMetadataColumn
    ? queryOne<{ metadata: string | null; source_event: string | null }>(
        'SELECT metadata, source_event FROM swarm_tasks WHERE task_id = ?',
        [taskId]
      )
    : queryOne<{ source_event: string | null }>(
        'SELECT source_event FROM swarm_tasks WHERE task_id = ?',
        [taskId]
      );

  if (!row) {
    return { attempted: false, delivered: false, reason: 'task_not_found' };
  }

  const target = extractTelegramTarget((row as any) || {});
  if (!target.chatId) {
    return { attempted: false, delivered: false, reason: 'no_telegram_chat_id' };
  }

  const chunks = buildTelegramMessages(taskTitle, finalMarkdown, taskId);

  for (let i = 0; i < chunks.length; i += 1) {
    const res = await sendTelegramReply({
      chatId: target.chatId,
      text: chunks[i],
      replyToMessageId: i === 0 ? target.replyToMessageId : undefined,
    });

    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : 'no_response';
      throw new Error(`telegram_send_failed chunk=${i + 1}/${chunks.length} status=${res?.status || 'null'} body=${body}`);
    }
  }

  return { attempted: true, delivered: true, chunks: chunks.length };
}


type PolicyDecision = 'auto_approve' | 'hitl_required' | 'banned';

type PolicyConfig = {
  auto_approve_actions: string[];
  hitl_required_actions: string[];
  banned_actions: string[];
  allowed_fetch_domains: string[];
  sandbox_rules: { untrusted_telegram_to_hitl?: boolean };
};

type PolicyContext = {
  policy: PolicyConfig;
  isUntrustedTelegram: boolean;
  sourceChatId: string | null;
  resolvedBy: string;
};

const DEFAULT_POLICY: PolicyConfig = {
  auto_approve_actions: ['search_past_deliverables', 'internal_log_read'],
  hitl_required_actions: ['spawn_sub_task', 'create_subtasks', 'scrape_and_parse_url', 'send_telegram_reply'],
  banned_actions: ['read_env_file', 'read_dot_env_file', 'fetch_data_from_unapproved_domain'],
  allowed_fetch_domains: ['localhost', '127.0.0.1', 'mission-control', 'mission-control.local'],
  sandbox_rules: { untrusted_telegram_to_hitl: true },
};

function parsePolicyYaml(raw: string): PolicyConfig {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const cfg: PolicyConfig = {
    auto_approve_actions: [],
    hitl_required_actions: [],
    banned_actions: [],
    allowed_fetch_domains: [],
    sandbox_rules: {},
  };
  let current: null | 'auto_approve_actions' | 'hitl_required_actions' | 'banned_actions' | 'allowed_fetch_domains' = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const section = /^([a-zA-Z_][a-zA-Z0-9_]*):$/.exec(trimmed);
    if (section) {
      const name = section[1];
      if (name === 'auto_approve_actions' || name === 'hitl_required_actions' || name === 'banned_actions' || name === 'allowed_fetch_domains') {
        current = name;
      } else {
        current = null;
      }
      continue;
    }
    const item = /^-\s*(.+)$/.exec(trimmed);
    if (item && current) {
      cfg[current].push(String(item[1]).trim());
      continue;
    }
    if (trimmed.startsWith('sandbox_rules:')) {
      const hit = /untrusted_telegram_to_hitl:\s*(true|false)/i.exec(trimmed);
      cfg.sandbox_rules = {
        untrusted_telegram_to_hitl: hit ? String(hit[1]).toLowerCase() === 'true' : true,
      };
    }
  }
  return {
    auto_approve_actions: cfg.auto_approve_actions.length ? cfg.auto_approve_actions : DEFAULT_POLICY.auto_approve_actions,
    hitl_required_actions: cfg.hitl_required_actions.length ? cfg.hitl_required_actions : DEFAULT_POLICY.hitl_required_actions,
    banned_actions: cfg.banned_actions.length ? cfg.banned_actions : DEFAULT_POLICY.banned_actions,
    allowed_fetch_domains: cfg.allowed_fetch_domains.length ? cfg.allowed_fetch_domains : DEFAULT_POLICY.allowed_fetch_domains,
    sandbox_rules: { untrusted_telegram_to_hitl: cfg.sandbox_rules.untrusted_telegram_to_hitl !== false },
  };
}

function loadPolicy(): PolicyConfig {
  const p = path.join(process.cwd(), 'policy.yaml');
  if (!fs.existsSync(p)) return DEFAULT_POLICY;
  try {
    return parsePolicyYaml(fs.readFileSync(p, 'utf8'));
  } catch {
    return DEFAULT_POLICY;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  if (typeof value === 'string') return toRecordSafe(value);
  return value as Record<string, unknown>;
}

function toRecordSafe(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getTaskPolicyContext(taskId: string): PolicyContext {
  const policy = loadPolicy();
  const row = queryOne<{ source_event: string | null; metadata: string | null }>('SELECT source_event, metadata FROM swarm_tasks WHERE task_id = ?', [taskId]);
  const source = toRecordSafe(row?.source_event || null);
  const metadata = toRecordSafe(row?.metadata || null);
  const sourceMeta = toRecord(source['metadata']);
  const sourceChatId = String(
    source['telegram_chat_id'] ||
    source['chat_id'] ||
    sourceMeta['telegram_chat_id'] ||
    sourceMeta['chatId'] ||
    metadata['telegram_chat_id'] ||
    ''
  ).trim();
  const sourceType = String(source['source'] || '').toLowerCase();
  const isTelegram = sourceType === 'telegram' || !!sourceChatId;
  const masterChatId = String(process.env.TELEGRAM_MASTER_CHAT_ID || '').trim();
  const untrusted = isTelegram && (!masterChatId || (sourceChatId ? sourceChatId !== masterChatId : false));
  return {
    policy,
    isUntrustedTelegram: untrusted && policy.sandbox_rules?.untrusted_telegram_to_hitl !== false,
    sourceChatId: sourceChatId || null,
    resolvedBy: 'policy.yaml',
  };
}

function isAllowedDomain(url: string, allowed: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (allowed || []).some((candidate) => {
      const c = String(candidate || '').toLowerCase();
      return host === c || host.endsWith('.' + c);
    });
  } catch {
    return false;
  }
}

function enforceTenantIsolationForTask(taskId: string): {ok: boolean; reason?: string; taskTenant?: string; requesterTenant?: string} {
  try {
    const row = queryOne<{ tenant_id: string | null; source_event: string | null; metadata: string | null }>('SELECT tenant_id, source_event, metadata FROM swarm_tasks WHERE task_id = ?', [taskId]);
    const taskTenant = String(row?.tenant_id || 'default').trim() || 'default';
    const source = toRecordSafe(row?.source_event || null);
    const metadata = toRecordSafe(row?.metadata || null);
    const sourceMeta = toRecord(source['metadata']);
    const requesterTenant = String(
      source['tenant_id'] ||
      sourceMeta['tenant_id'] ||
      metadata['tenant_id'] ||
      process.env.REQUEST_TENANT_ID ||
      'default'
    ).trim() || 'default';
    if (requesterTenant !== taskTenant) {
      return { ok: false, reason: 'TENANT_ISOLATION_BLOCK', taskTenant, requesterTenant };
    }
    return { ok: true, taskTenant, requesterTenant };
  } catch {
    return { ok: false, reason: 'TENANT_ISOLATION_CHECK_FAILED' };
  }
}

function classifyToolAction(toolName: string, argsRaw: unknown, ctx: PolicyContext): { decision: PolicyDecision; reason: string } {
  const name = String(toolName || '').trim().toLowerCase();
  const args = toRecordSafe(typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw));
  const payload = JSON.stringify(args);
  const targetUrl = String(args['url'] || '').trim();

  if (payload.includes('.env')) return { decision: 'banned', reason: 'BANNED_ACTION: .env access in args' };
  if (name === 'scrape_and_parse_url' && targetUrl && !isAllowedDomain(targetUrl, ctx.policy.allowed_fetch_domains)) {
    return { decision: 'banned', reason: 'BANNED_ACTION: unapproved domain fetch ' + targetUrl };
  }
  if (ctx.policy.banned_actions.includes(name)) return { decision: 'banned', reason: 'BANNED_ACTION: ' + name };

  if (ctx.policy.hitl_required_actions.includes(name)) {
    if (ctx.isUntrustedTelegram) {
      return { decision: 'hitl_required', reason: 'HITL_REQUIRED: ' + name + ' from untrusted telegram (' + (ctx.sourceChatId || 'unknown') + ')' };
    }
    return { decision: 'hitl_required', reason: 'HITL_REQUIRED: ' + name };
  }

  if (ctx.policy.auto_approve_actions.includes(name)) {
    return { decision: 'auto_approve', reason: 'AUTO_APPROVE: ' + name };
  }

  return { decision: 'hitl_required', reason: 'HITL_REQUIRED: default-deny unknown action' + (name ? ' ' + name : '') };
}


function estimateTokensFromText(text: unknown): number {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function extractTotalTokensFromGatewayEvent(value: unknown, depth = 0): number | undefined {
  if (depth > 6 || value == null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = extractTotalTokensFromGatewayEvent(item, depth + 1);
      if (typeof hit === 'number' && Number.isFinite(hit)) return hit;
    }
    return undefined;
  }
  if (typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const direct = extractTotalTokensFromUsage(obj);
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return direct;
  for (const key of Object.keys(obj)) {
    const hit = extractTotalTokensFromGatewayEvent(obj[key], depth + 1);
    if (typeof hit === 'number' && Number.isFinite(hit)) return hit;
  }
  return undefined;
}

function extractTotalTokensFromUsage(response: unknown): number | undefined {
  const r = (response && typeof response === "object") ? (response as Record<string, unknown>) : {};
  const usage = (r.usage && typeof r.usage === "object") ? (r.usage as Record<string, unknown>) : {};
  const total = Number(usage.total_tokens);
  if (Number.isFinite(total) && total >= 0) return total;
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? usage.inputTokenCount ?? 0);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidates_token_count ?? usage.outputTokenCount ?? 0);
  const merged = (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0);
  if (merged > 0) return merged;
  // Some wrappers put usage in nested result payloads
  const result = (r.result && typeof r.result === "object") ? (r.result as Record<string, unknown>) : {};
  const nestedUsage = (result.usage && typeof result.usage === "object") ? (result.usage as Record<string, unknown>) : {};
  const nestedTotal = Number(nestedUsage.total_tokens);
  if (Number.isFinite(nestedTotal) && nestedTotal >= 0) return nestedTotal;
  return undefined;
}

function enterPolicyGate(params: { taskId: string; runId: string; toolName: string; toolCallId: string; reason: string }) {
  const now = new Date().toISOString();
  const approvalId = 'policy-' + params.runId + '-' + params.toolCallId;
  run("INSERT OR IGNORE INTO swarm_approvals (approval_id, task_id, gate_reason, approval_status, requested_at) VALUES (?, ?, ?, 'pending', ?)",
    [approvalId, params.taskId, 'policy:' + params.reason, now],
  );
  run("UPDATE swarm_runs SET run_status='hitl_review', ended_at=?, duration_ms=?, output_summary=? WHERE run_id=?", [
    now,
    0,
    'Policy gate triggered: ' + params.reason,
    params.runId,
  ]);
  run("UPDATE swarm_tasks SET status='hitl_review', updated_at=? WHERE task_id=?", [now, params.taskId]);
  logEvent(params.taskId, params.runId, '[POLICY_GATE] ' + params.toolName + ' blocked for HITL: ' + params.reason);
}


export async function executeSwarmRunAsync(params: {
  taskId: string;
  runId: string;
  roleId: string;
  sessionKey: string;
  taskTitle: string;
  objective?: string | null;
  subPrompt: string;
}) {
  const preRouteIntentInput = `${params.taskTitle || ""}\n${params.objective || ""}\n${params.subPrompt || ""}`;
  const preRouteIntent = classifyIntent(preRouteIntentInput);
  logEvent(params.taskId, params.runId, `[PREROUTER] intent=${preRouteIntent.category} score=${preRouteIntent.score}`);
  const preRouteSystemPrompt = formatIntentForPrompt(preRouteIntent);
  logEvent(params.taskId, params.runId, `[PREROUTER] metadata=${preRouteSystemPrompt}`);
  const startedAtMs = Date.now();
  const tracer = createSwarmTracer(params.taskId, params.runId);
  const client = getOpenClawClient();

  let finalMarkdown: string | null = null;
  let ended = false;
  let failedReason: string | null = null;
  let streamRunId: string | null = null;
  let streamUsageTotalTokens: number | undefined = undefined;

  const seenToolCalls = new Set<string>();
  const pendingToolCalls: ToolCallCandidate[] = [];

  let draftingLogged = false;
  let deliverableSavedLogged = false;
  let toolLoopCount = 0;

  const onGatewayEvent = (evt: GatewayEventEnvelope) => {
    const eventName = evt?.event;
    const payload = evt?.payload || {};
    if (!eventName) return;

    if (streamRunId && payload.runId !== streamRunId) return;

    const eventUsageTokens = extractTotalTokensFromGatewayEvent(evt) ?? extractTotalTokensFromGatewayEvent(payload);
    if (typeof eventUsageTokens === 'number' && Number.isFinite(eventUsageTokens)) {
      streamUsageTotalTokens = eventUsageTokens;
    }

    const discovered = extractToolCalls(payload);
    for (const tc of discovered) {
      if (seenToolCalls.has(tc.id)) continue;
      seenToolCalls.add(tc.id);
      pendingToolCalls.push(tc);
      logEvent(params.taskId, params.runId, `[TOOL_USE] Executing ${tc.name}...`);
    }

    if (eventName === 'agent') {
      const stream = String(payload.stream || '');

      if (stream === 'assistant') {
        const txt = String(payload?.data?.delta || payload?.data?.text || '').trim();
        if (txt && !draftingLogged) {
          draftingLogged = true;
          logEvent(params.taskId, params.runId, '[DRAFTING] Writing markdown report...');
        }
      }

      if (stream === 'lifecycle') {
        const phase = String(payload?.data?.phase || '').toLowerCase();
        if (phase === 'error' || phase === 'failed') {
          failedReason = String(payload?.data?.error || payload?.data?.message || 'agent lifecycle error');
          ended = true;
        }
        if (phase === 'end' && pendingToolCalls.length === 0) ended = true;
      }
    }

    if (eventName === 'chat') {
      const state = String(payload.state || '').toLowerCase();
      const text = extractTextFromChatPayload(payload);
      if (text && !draftingLogged) {
        draftingLogged = true;
        logEvent(params.taskId, params.runId, '[DRAFTING] Writing markdown report...');
      }
      if (text && state === 'final' && pendingToolCalls.length === 0) {
        finalMarkdown = stripHandoffLeak(text);
        ended = true;
      }
    }
  };

  try {
    if (!client.isConnected()) await client.connect();

    logEvent(params.taskId, params.runId, `[DISPATCH_DETAIL] Monica told ${params.roleId}: ${trim(params.subPrompt, 280)}`);
    logEvent(params.taskId, params.runId, `[THINKING] ${params.roleId} started execution`);

    const role = queryOne<{ prompt_template_ref: string | null; default_agent_id: string | null }>(
      'SELECT prompt_template_ref, default_agent_id FROM agent_roles WHERE role_id = ?',
      [params.roleId]
    );

    const synthesisFormatInstruction = isMasterReportTask(params.taskTitle)
      ? [
          '',
          '# SYNTHESIS FORMAT (MANDATORY)',
          'At the very top of your markdown output, you MUST print:',
          '1) [DOMAIN: 거시경제|데이터센터|투자전략]  (choose exactly one)',
          '2) [EXECUTIVE SUMMARY]',
          '3) exactly 3 lines of summary (no more, no less)',
        ].join('\n')
      : '';

    const payload = [
      role?.prompt_template_ref || '',
      '',
      '# ROUTING',
      preRouteSystemPrompt,
      '',
      '# TASK',
      `Title: ${params.taskTitle}`,
      `Objective: ${params.objective || '-'}`,
      '',
      '# EXECUTION INSTRUCTION',
      params.subPrompt,
      synthesisFormatInstruction,
      '',
      '# TOOLING',
      `You may call tools when needed. Available tools: ${CORE_SWARM_TOOLS.map((t) => t.function.name).join(', ')}`,
      'Return markdown report only when complete.',
    ].join('\n');

    client.on('gateway_event', onGatewayEvent);

    const llmCallStartedAt = new Date().toISOString();
    let sendRes: any;
    let sendResTotalTokens: number | undefined = undefined;
    let usedModel = undefined as string | undefined;
    let initialSendSuccess = false;
    let initialSendError: unknown = null;
    try {
      usedModel = role?.default_agent_id
        ? queryOne<{ model: string | null }>(
            'SELECT model FROM agents WHERE id = ?',
            [role.default_agent_id]
          )?.model || undefined
        : undefined;
    } catch {}

    try {
      sendRes = await client.call('chat.send', {
        sessionKey: params.sessionKey,
        message: payload,
        idempotencyKey: `swarm-exec-${params.taskId}-${Date.now()}`,
        __timeoutMs: 86400000,
      });
      sendResTotalTokens = extractTotalTokensFromUsage(sendRes);
      initialSendSuccess = true;
    } catch (err) {
      initialSendSuccess = false;
      initialSendError = err;
      throw err;
    } finally {
      tracer.logSpan({
        spanType: 'llm_call',
        spanName: 'chat.send.initial',
        model: usedModel || undefined,
        success: initialSendSuccess,
        latencyMs: Date.now() - Date.parse(llmCallStartedAt),
        startedAt: llmCallStartedAt,
        endedAt: new Date().toISOString(),
        costTokens: sendResTotalTokens,
        metadata: {
          method: 'llm',
          ...(initialSendError ? { error: initialSendError instanceof Error ? initialSendError.message : String(initialSendError) } : {}),
        },
      });
    }
    streamRunId = String(sendRes?.runId || '');
    if (!streamRunId) {
      throw new Error('chat.send did not return runId');
    }

    logEvent(params.taskId, params.runId, `[THINKING] waiting for streamed final response runId=${streamRunId}`);

    while (!ended && Date.now() - startedAtMs < MAX_WAIT_MS) {
      if (pendingToolCalls.length > 0) {
        const next = pendingToolCalls.shift()!;
        toolLoopCount += 1;
        if (toolLoopCount > MAX_TOOL_LOOP) {
          throw new Error(`tool loop limit exceeded (${MAX_TOOL_LOOP})`);
        }

        const toolStartedAt = new Date().toISOString();
        const tenantGuard = enforceTenantIsolationForTask(params.taskId);
        if (!tenantGuard.ok) {
          tracer.logSpan({
            spanType: 'tool_call',
            spanName: next.name,
            toolName: next.name,
            toolArguments: next.arguments,
            success: false,
            latencyMs: Date.now() - Date.parse(toolStartedAt),
            startedAt: toolStartedAt,
            endedAt: new Date().toISOString(),
            metadata: {
              tool_call_id: next.id,
              policy_decision: 'banned',
              policy_reason: tenantGuard.reason || 'TENANT_ISOLATION_BLOCK',
              tenant_task: tenantGuard.taskTenant,
              tenant_requester: tenantGuard.requesterTenant,
            },
          });
          throw new Error('POLICY_BLOCKED: TENANT_ISOLATION_BLOCK');
        }
        const policyContext = getTaskPolicyContext(params.taskId);
        const policyDecision = classifyToolAction(next.name, next.arguments, policyContext);
        if (policyDecision.decision === 'banned') {
          tracer.logSpan({
            spanType: 'tool_call',
            spanName: next.name,
            toolName: next.name,
            toolArguments: next.arguments,
            success: false,
            latencyMs: Date.now() - Date.parse(toolStartedAt),
            startedAt: toolStartedAt,
            endedAt: new Date().toISOString(),
            metadata: {
              tool_call_id: next.id,
              policy_decision: policyDecision.decision,
              policy_reason: policyDecision.reason,
            },
          });
          throw new Error('POLICY_BLOCKED: ' + policyDecision.reason);
        }
        if (policyDecision.decision === 'hitl_required') {
          tracer.logSpan({
            spanType: 'tool_call',
            spanName: next.name,
            toolName: next.name,
            toolArguments: next.arguments,
            success: false,
            latencyMs: Date.now() - Date.parse(toolStartedAt),
            startedAt: toolStartedAt,
            endedAt: new Date().toISOString(),
            metadata: {
              tool_call_id: next.id,
              policy_decision: policyDecision.decision,
              policy_reason: policyDecision.reason,
            },
          });
          enterPolicyGate({
            taskId: params.taskId,
            runId: params.runId,
            toolName: next.name,
            toolCallId: next.id,
            reason: policyDecision.reason,
          });
          return;
        }
        let toolResult: unknown = null;
        let toolSucceeded = false;
        let toolError: unknown = null;

        try {
          toolResult = await executeToolByName(next.name, next.arguments, {
            workspaceId: 'default',
            parentTaskId: params.taskId,
            requesterRoleId: params.roleId,
          });
          toolSucceeded = true;
        } catch (err) {
          toolError = err;
          throw err;
        } finally {
          tracer.logSpan({
            spanType: 'tool_call',
            spanName: next.name,
            toolName: next.name,
            toolArguments: next.arguments,
            success: toolSucceeded,
            latencyMs: Date.now() - Date.parse(toolStartedAt),
            startedAt: toolStartedAt,
            endedAt: new Date().toISOString(),
            costTokens: undefined,
            metadata: {
              tool_call_id: next.id,
              ...(toolError ? { error: toolError instanceof Error ? toolError.message : String(toolError) } : {}),
            },
          });
        }

        run(
          `INSERT INTO events (id, type, task_id, message, metadata, created_at)
           VALUES (?, ?, NULL, ?, ?, ?)`,
          [
            randomUUID(),
            'system',
            `[TOOL_RESULT] ${next.name} completed`,
            JSON.stringify({ swarm_task_id: params.taskId, run_id: params.runId, tool_name: next.name, tool_call_id: next.id }),
            new Date().toISOString(),
          ]
        );

        broadcast({
          type: 'event_logged',
          payload: {
            taskId: params.taskId,
            sessionId: params.runId,
            summary: `[TOOL_USE] Executing ${next.name}...done`,
          },
        });

        await client.call('chat.send', {
          sessionKey: params.sessionKey,
          message: `TOOL_RESULT\nname=${next.name}\ncall_id=${next.id}\n\n${toolResult}`,
          idempotencyKey: `swarm-tool-${params.taskId}-${next.id}-${Date.now()}`,
          __timeoutMs: 120000,
        });
      }

      await sleep(500);
    }

    if (failedReason) throw new Error(failedReason);
    if (!finalMarkdown) throw new Error(`timeout exceeded ${MAX_WAIT_MS}ms while waiting streaming final`);

    const tokenSource = (typeof streamUsageTotalTokens === 'number' && Number.isFinite(streamUsageTotalTokens))
      ? 'exact'
      : 'estimated';
    const tokenEstimated = tokenSource !== 'exact';
    const finalizedTotalTokens = tokenEstimated
      ? (estimateTokensFromText(payload) + estimateTokensFromText(finalMarkdown))
      : (streamUsageTotalTokens ?? 0);

    tracer.logSpan({
      spanType: 'llm_call',
      spanName: 'chat.send.usage.final',
      model: usedModel || undefined,
      success: true,
      costTokens: finalizedTotalTokens,
      latencyMs: Date.now() - Date.parse(llmCallStartedAt),
      startedAt: llmCallStartedAt,
      endedAt: new Date().toISOString(),
      metadata: {
        method: 'llm',
        source: tokenEstimated ? 'estimated_from_prompt_and_final_text' : 'gateway_event_or_final_payload',
        token_source: tokenSource,
        token_estimated: tokenEstimated,
        run_id: streamRunId || undefined,
      },
    });

    const cleanMarkdown = stripHandoffLeak(finalMarkdown);
    const isMaster = isMasterReportTask(params.taskTitle);

    tracer.logSpan({
      spanType: 'synthesis',
      spanName: params.taskTitle,
      success: true,
      latencyMs: Date.now() - startedAtMs,
      metadata: { is_master: isMaster }
    });

    const endedAt = new Date().toISOString();
    run(
      `UPDATE swarm_runs
       SET run_status = 'completed', ended_at = ?, duration_ms = ?, output_summary = ?
       WHERE run_id = ?`,
      [endedAt, Date.now() - startedAtMs, cleanMarkdown, params.runId]
    );

    if (!deliverableSavedLogged) {
      deliverableSavedLogged = true;
      logEvent(params.taskId, params.runId, '[DELIVERABLE_SAVED] Report finalized and saved.');
    }

    if (!isMaster) {
      tracer.logSpan({
        spanType: 'hitl_gate',
        spanName: 'execution_to_hitl_review',
        approver: 'pending',
        success: true,
        startedAt: endedAt,
        endedAt: new Date().toISOString(),
        metadata: {
          reason: 'execution_completed_needs_review',
        },
      });
    }

    const nextTaskStatus = isMaster ? 'completed' : 'hitl_review';

    run(`UPDATE swarm_tasks SET status = ?, updated_at = ? WHERE task_id = ?`, [nextTaskStatus, endedAt, params.taskId]);

    if (!isMaster) {
      run(
        `INSERT OR IGNORE INTO swarm_approvals (approval_id, task_id, gate_reason, approval_status, requested_at)
         VALUES (?, ?, ?, 'pending', ?)`,
        [`approval-${params.runId}`, params.taskId, 'execution_completed_needs_review', endedAt]
      );
    }

    try {
      const bridge = await bridgeDeliverableToTelegram(params.taskId, params.taskTitle, cleanMarkdown);
      if (bridge.attempted && bridge.delivered) {
        logEvent(params.taskId, params.runId, `[DELIVERABLE_SAVED] Telegram reply delivered. chunks=${bridge.chunks || 1}`);
      }
    } catch (bridgeError) {
      logEvent(params.taskId, params.runId, `[EXECUTOR_ERROR] Telegram bridge failed: ${String(bridgeError)}`);
    }

    if (isMaster) {
      void fanoutMasterReportDelivery(params.taskId, params.taskTitle, cleanMarkdown, params.runId);
    }

    logEvent(params.taskId, params.runId, `task_status_changed:${nextTaskStatus}`);
    broadcast({ type: 'task_updated', payload: { id: params.taskId, status: nextTaskStatus } as any });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    tracer.logSpan({
      spanType: 'synthesis',
      spanName: params.taskTitle,
      success: false,
      latencyMs: Date.now() - startedAtMs,
      metadata: {
        error: reason,
        phase: 'execution_error',
      },
    });

    const report = errorReportMarkdown(params.taskTitle, params.roleId, reason);
    const result = failRunAndTaskSafely({
      taskId: params.taskId,
      runId: params.runId,
      reason,
      report,
      preserveHitlReview: true,
    });

    logEvent(params.taskId, params.runId, `[EXECUTOR_ERROR] ${reason}`);
    logEvent(params.taskId, params.runId, '[EXECUTOR_ERROR] 시스템 타임아웃 또는 에러 발생. 로그를 확인하세요.');
    broadcast({ type: 'task_updated', payload: { id: params.taskId, status: result.taskStatus } as any });
  } finally {
    client.off('gateway_event', onGatewayEvent);
  }
}
