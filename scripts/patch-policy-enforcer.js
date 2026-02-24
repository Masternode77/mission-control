#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src', 'lib', 'swarm-executor.ts');

function ensureImport(content) {
  const anchor = "import { createSwarmTracer } from '@/lib/tracer';";
  const replacement = "import { createSwarmTracer } from '@/lib/tracer';\nimport fs from 'fs';\nimport path from 'path';";
  if (!content.includes("import fs from 'fs';")) {
    if (!content.includes(anchor)) throw new Error('anchor not found: tracer import');
    return content.replace(anchor, replacement);
  }
  return content;
}

function policyBlockLines() {
  return [
    "",
    "type PolicyDecision = 'auto_approve' | 'hitl_required' | 'banned';",
    "",
    "type PolicyConfig = {",
    "  auto_approve_actions: string[];",
    "  hitl_required_actions: string[];",
    "  banned_actions: string[];",
    "  allowed_fetch_domains: string[];",
    "  sandbox_rules: { untrusted_telegram_to_hitl?: boolean };",
    "};",
    "",
    "type PolicyContext = {",
    "  policy: PolicyConfig;",
    "  isUntrustedTelegram: boolean;",
    "  sourceChatId: string | null;",
    "  resolvedBy: string;",
    "};",
    "",
    "const DEFAULT_POLICY: PolicyConfig = {",
    "  auto_approve_actions: ['search_past_deliverables', 'internal_log_read'],",
    "  hitl_required_actions: ['spawn_sub_task', 'create_subtasks', 'scrape_and_parse_url', 'send_telegram_reply'],",
    "  banned_actions: ['read_env_file', 'read_dot_env_file', 'fetch_data_from_unapproved_domain'],",
    "  allowed_fetch_domains: ['localhost', '127.0.0.1', 'mission-control', 'mission-control.local'],",
    "  sandbox_rules: { untrusted_telegram_to_hitl: true },",
    "};",
    "",
    "function parsePolicyYaml(raw: string): PolicyConfig {",
    "  const lines = String(raw || '').replace(/\\r/g, '').split('\\n');",
    "  const cfg: PolicyConfig = {",
    "    auto_approve_actions: [],",
    "    hitl_required_actions: [],",
    "    banned_actions: [],",
    "    allowed_fetch_domains: [],",
    "    sandbox_rules: {},",
    "  };",
    "  let current: null | 'auto_approve_actions' | 'hitl_required_actions' | 'banned_actions' | 'allowed_fetch_domains' = null;",
    "  for (const line of lines) {",
    "    const trimmed = line.trim();",
    "    if (!trimmed || trimmed.startsWith('#')) continue;",
    "    const section = /^([a-zA-Z_][a-zA-Z0-9_]*):$/.exec(trimmed);",
    "    if (section) {",
    "      const name = section[1];",
    "      if (name === 'auto_approve_actions' || name === 'hitl_required_actions' || name === 'banned_actions' || name === 'allowed_fetch_domains') {",
    "        current = name;",
    "      } else {",
    "        current = null;",
    "      }",
    "      continue;",
    "    }",
    "    const item = /^-\\s*(.+)$/.exec(trimmed);",
    "    if (item && current) {",
    "      cfg[current].push(String(item[1]).trim());",
    "      continue;",
    "    }",
    "    if (trimmed.startsWith('sandbox_rules:')) {",
    "      const hit = /untrusted_telegram_to_hitl:\\s*(true|false)/i.exec(trimmed);",
    "      cfg.sandbox_rules = {",
    "        untrusted_telegram_to_hitl: hit ? String(hit[1]).toLowerCase() === 'true' : true,",
    "      };",
    "    }",
    "  }",
    "  return {",
    "    auto_approve_actions: cfg.auto_approve_actions.length ? cfg.auto_approve_actions : DEFAULT_POLICY.auto_approve_actions,",
    "    hitl_required_actions: cfg.hitl_required_actions.length ? cfg.hitl_required_actions : DEFAULT_POLICY.hitl_required_actions,",
    "    banned_actions: cfg.banned_actions.length ? cfg.banned_actions : DEFAULT_POLICY.banned_actions,",
    "    allowed_fetch_domains: cfg.allowed_fetch_domains.length ? cfg.allowed_fetch_domains : DEFAULT_POLICY.allowed_fetch_domains,",
    "    sandbox_rules: { untrusted_telegram_to_hitl: cfg.sandbox_rules.untrusted_telegram_to_hitl !== false },",
    "  };",
    "}",
    "",
    "function loadPolicy(): PolicyConfig {",
    "  const p = path.join(process.cwd(), 'policy.yaml');",
    "  if (!fs.existsSync(p)) return DEFAULT_POLICY;",
    "  try {",
    "    return parsePolicyYaml(fs.readFileSync(p, 'utf8'));",
    "  } catch {",
    "    return DEFAULT_POLICY;",
    "  }",
    "}",
    "",
    "function toRecord(value: unknown): Record<string, unknown> {",
    "  if (!value || typeof value !== 'object') return {};",
    "  if (typeof value === 'string') return toRecordSafe(value);",
    "  return value as Record<string, unknown>;",
    "}",
    "",
    "function toRecordSafe(raw: string): Record<string, unknown> {",
    "  if (!raw) return {};",
    "  try {",
    "    const parsed = JSON.parse(raw);",
    "    return (parsed && typeof parsed === 'object') ? (parsed as Record<string, unknown>) : {};",
    "  } catch {",
    "    return {};",
    "  }",
    "}",
    "",
    "function getTaskPolicyContext(taskId: string): PolicyContext {",
    "  const policy = loadPolicy();",
    "  const row = queryOne<{ source_event: string | null; metadata: string | null }>('SELECT source_event, metadata FROM swarm_tasks WHERE task_id = ?', [taskId]);",
    "  const source = toRecordSafe(row?.source_event || null);",
    "  const metadata = toRecordSafe(row?.metadata || null);",
    "  const sourceMeta = toRecord(source['metadata']);",
    "  const sourceChatId = String(",
    "    source['telegram_chat_id'] ||",
    "    source['chat_id'] ||",
    "    sourceMeta['telegram_chat_id'] ||",
    "    sourceMeta['chatId'] ||",
    "    metadata['telegram_chat_id'] ||",
    "    ''",
    "  ).trim();",
    "  const sourceType = String(source['source'] || '').toLowerCase();",
    "  const isTelegram = sourceType === 'telegram' || !!sourceChatId;",
    "  const masterChatId = String(process.env.TELEGRAM_MASTER_CHAT_ID || '').trim();",
    "  const untrusted = isTelegram && (!masterChatId || (sourceChatId ? sourceChatId !== masterChatId : false));",
    "  return {",
    "    policy,",
    "    isUntrustedTelegram: untrusted && policy.sandbox_rules?.untrusted_telegram_to_hitl !== false,",
    "    sourceChatId: sourceChatId || null,",
    "    resolvedBy: 'policy.yaml',",
    "  };",
    "}",
    "",
    "function isAllowedDomain(url: string, allowed: string[]): boolean {",
    "  try {",
    "    const host = new URL(url).hostname.toLowerCase();",
    "    return (allowed || []).some((candidate) => {",
    "      const c = String(candidate || '').toLowerCase();",
    "      return host === c || host.endsWith('.' + c);",
    "    });",
    "  } catch {",
    "    return false;",
    "  }",
    "}",
    "",
    "function classifyToolAction(toolName: string, argsRaw: unknown, ctx: PolicyContext): { decision: PolicyDecision; reason: string } {",
    "  const name = String(toolName || '').trim().toLowerCase();",
    "  const args = toRecordSafe(typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw));",
    "  const payload = JSON.stringify(args);",
    "  const targetUrl = String(args['url'] || '').trim();",
    "",
    "  if (payload.includes('.env')) return { decision: 'banned', reason: 'BANNED_ACTION: .env access in args' };",
    "  if (name === 'scrape_and_parse_url' && targetUrl && !isAllowedDomain(targetUrl, ctx.policy.allowed_fetch_domains)) {",
    "    return { decision: 'banned', reason: 'BANNED_ACTION: unapproved domain fetch ' + targetUrl };",
    "  }",
    "  if (ctx.policy.banned_actions.includes(name)) return { decision: 'banned', reason: 'BANNED_ACTION: ' + name };",
    "",
    "  if (ctx.policy.hitl_required_actions.includes(name)) {",
    "    if (ctx.isUntrustedTelegram) {",
    "      return { decision: 'hitl_required', reason: 'HITL_REQUIRED: ' + name + ' from untrusted telegram (' + (ctx.sourceChatId || 'unknown') + ')' };",
    "    }",
    "    return { decision: 'hitl_required', reason: 'HITL_REQUIRED: ' + name };",
    "  }",
    "",
    "  if (ctx.policy.auto_approve_actions.includes(name)) {",
    "    return { decision: 'auto_approve', reason: 'AUTO_APPROVE: ' + name };",
    "  }",
    "",
    "  return { decision: 'auto_approve', reason: 'AUTO_APPROVE: default ' + name };",
    "}",
    "",
    "function enterPolicyGate(params: { taskId: string; runId: string; toolName: string; toolCallId: string; reason: string }) {",
    "  const now = new Date().toISOString();",
    "  const approvalId = 'policy-' + params.runId + '-' + params.toolCallId;",
    "  run(\"INSERT OR IGNORE INTO swarm_approvals (approval_id, task_id, gate_reason, approval_status, requested_at) VALUES (?, ?, ?, 'pending', ?)\",",
    "    [approvalId, params.taskId, 'policy:' + params.reason, now],",
    "  );",
    "  run(\"UPDATE swarm_runs SET run_status='hitl_review', ended_at=?, duration_ms=?, output_summary=? WHERE run_id=?\", [",
    "    now,",
    "    0,",
    "    'Policy gate triggered: ' + params.reason,",
    "    params.runId,",
    "  ]);",
    "  run(\"UPDATE swarm_tasks SET status='hitl_review', updated_at=? WHERE task_id=?\", [now, params.taskId]);",
    "  logEvent(params.taskId, params.runId, '[POLICY_GATE] ' + params.toolName + ' blocked for HITL: ' + params.reason);",
    "}",
    "",
  ];
}

function applyPolicyBlock(content) {
  const marker = "type PolicyDecision = 'auto_approve' | 'hitl_required' | 'banned';";
  if (content.includes(marker)) return content;

  const anchor = 'export async function executeSwarmRunAsync(params: {';
  if (!content.includes(anchor)) throw new Error('anchor missing: executeSwarmRunAsync');
  return content.replace(anchor, policyBlockLines().join('\n') + '\n\n' + anchor);
}

function applyToolGate(content) {
  const anchor = [
    "        const toolStartedAt = new Date().toISOString();",
    '        let toolResult: unknown = null;',
    '        let toolSucceeded = false;',
  ].join('\n');

  const injected = [
    "        const toolStartedAt = new Date().toISOString();",
    '        const policyContext = getTaskPolicyContext(params.taskId);',
    '        const policyDecision = classifyToolAction(next.name, next.arguments, policyContext);',
    "        if (policyDecision.decision === 'banned') {",
    '          tracer.logSpan({',
    "            spanType: 'tool_call',",
    '            spanName: next.name,',
    "            toolName: next.name,",
    '            toolArguments: next.arguments,',
    '            success: false,',
    '            latencyMs: Date.now() - Date.parse(toolStartedAt),',
    '            startedAt: toolStartedAt,',
    '            endedAt: new Date().toISOString(),',
    '            metadata: {',
    "              tool_call_id: next.id,",
    "              policy_decision: policyDecision.decision,",
    "              policy_reason: policyDecision.reason,",
    '            },',
    '          });',
    "          throw new Error('POLICY_BLOCKED: ' + policyDecision.reason);",
    '        }',
    "        if (policyDecision.decision === 'hitl_required') {",
    '          tracer.logSpan({',
    "            spanType: 'tool_call',",
    '            spanName: next.name,',
    "            toolName: next.name,",
    '            toolArguments: next.arguments,',
    '            success: false,',
    '            latencyMs: Date.now() - Date.parse(toolStartedAt),',
    '            startedAt: toolStartedAt,',
    '            endedAt: new Date().toISOString(),',
    '            metadata: {',
    "              tool_call_id: next.id,",
    "              policy_decision: policyDecision.decision,",
    "              policy_reason: policyDecision.reason,",
    '            },',
    '          });',
    '          enterPolicyGate({',
    '            taskId: params.taskId,',
    '            runId: params.runId,',
    '            toolName: next.name,',
    '            toolCallId: next.id,',
    '            reason: policyDecision.reason,',
    '          });',
    '          return;',
    '        }',
    '        let toolResult: unknown = null;',
    '        let toolSucceeded = false;',
  ].join('\n');

  if (content.includes("policyDecision.decision === 'banned'")) return content;
  if (!content.includes(anchor)) throw new Error('tool gate anchor not found');
  return content.replace(anchor, injected);
}

(function main() {
  try {
    let content = fs.readFileSync(target, 'utf8');
    content = ensureImport(content);
    content = applyPolicyBlock(content);
    content = applyToolGate(content);
    fs.writeFileSync(target, content, 'utf8');
    console.log('patched', target);
  } catch (error) {
    console.error('patch-policy-enforcer failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode ?? 0);
  }
})();
