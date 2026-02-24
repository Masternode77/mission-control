#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src', 'lib', 'swarm-executor.ts');
const dryRun = process.argv.includes('--dry-run');

function ensureImports(content) {
  const anchor = "import { createSwarmTracer } from '@/lib/tracer';";
  const insertion = "import { createSwarmTracer } from '@/lib/tracer';\nimport fs from 'fs';\nimport path from 'path';";
  if (!content.includes("import fs from 'fs';")) {
    if (!content.includes(anchor)) throw new Error('tracer import anchor not found');
    return content.replace(anchor, insertion);
  }
  return content;
}

function policyBlockTemplate() {
  return [
    '',
    "type PolicyDecision = 'auto_approve' | 'hitl_required' | 'banned';",
    '',
    'type PolicyConfig = {',
    '  auto_approve_actions: string[];',
    '  hitl_required_actions: string[];',
    '  banned_actions: string[];',
    '  allowed_fetch_domains: string[];',
    "  sandbox_rules: { untrusted_telegram_to_hitl?: boolean };",
    '};',
    '',
    'type PolicyContext = {',
    '  policy: PolicyConfig;',
    '  sourceType: string;',
    '  isUntrustedTelegram: boolean;',
    '  sourceChatId: string | null;',
    '  resolvedBy: string;',
    '};',
    '',
    'const DEFAULT_POLICY: PolicyConfig = {',
    "  auto_approve_actions: ['search_past_deliverables', 'internal_log_read', 'query_internal_db'],",
    "  hitl_required_actions: ['spawn_sub_task', 'create_subtasks', 'scrape_and_parse_url', 'send_telegram_reply', 'send_external_api', 'external_api_call'],",
    "  banned_actions: ['fetch_data_from_unapproved_domain', 'read_env_file', 'read_dot_env_file', 'read_environment', 'read_env'],",
    "  allowed_fetch_domains: ['localhost', '127.0.0.1', 'mission-control', 'mission-control.local', 'api.mission-control.local'],",
    '  sandbox_rules: { untrusted_telegram_to_hitl: true },',
    '};',
    '',
    'function parsePolicyYaml(raw: string): PolicyConfig {',
    "  const lines = String(raw || '').replace(/\\r/g, '').split('\\n');",
    '  const cfg: PolicyConfig = {',
    '    auto_approve_actions: [],',
    '    hitl_required_actions: [],',
    '    banned_actions: [],',
    '    allowed_fetch_domains: [],',
    '    sandbox_rules: {},',
    '  };',
    '  let section: null | keyof Omit<PolicyConfig, "sandbox_rules"> = null;',
    '  for (const line of lines) {',
    "    const t = line.trim();",
    '    if (!t || t.startsWith(\'#\')) continue;',
    '    const sectionHeader = /^([a-zA-Z_][a-zA-Z0-9_]*):$/.exec(t);',
    '    if (sectionHeader) {',
    '      const name = sectionHeader[1];',
    '      if (',
    "        name === 'auto_approve_actions' ||",
    "        name === 'hitl_required_actions' ||",
    "        name === 'banned_actions' ||",
    "        name === 'allowed_fetch_domains'",
    '      ) {',
    '        section = name as keyof Omit<PolicyConfig, "sandbox_rules">;',
    '      } else {',
    '        section = null;',
    '      }',
    '      continue;',
    '    }',
    '    const item = /^-\s*(.+)$/.exec(t);',
    '    if (item && section) {',
    '      cfg[section].push(String(item[1] || \'\').trim());',
    '      continue;',
    '    }',
    '    if (t.startsWith(\'sandbox_rules:\') && t.includes(\'untrusted_telegram_to_hitl\')) {',
    '      const m = /untrusted_telegram_to_hitl:\\s*(true|false)/i.exec(t);',
    '      cfg.sandbox_rules = {',
    '        untrusted_telegram_to_hitl: m ? String(m[1]).toLowerCase() === "true" : true,',
    '      };',
    '    }',
    '  }',
    '  return {',
    "    auto_approve_actions: cfg.auto_approve_actions.length ? cfg.auto_approve_actions : DEFAULT_POLICY.auto_approve_actions,",
    "    hitl_required_actions: cfg.hitl_required_actions.length ? cfg.hitl_required_actions : DEFAULT_POLICY.hitl_required_actions,",
    "    banned_actions: cfg.banned_actions.length ? cfg.banned_actions : DEFAULT_POLICY.banned_actions,",
    "    allowed_fetch_domains: cfg.allowed_fetch_domains.length ? cfg.allowed_fetch_domains : DEFAULT_POLICY.allowed_fetch_domains,",
    '    sandbox_rules: { untrusted_telegram_to_hitl: cfg.sandbox_rules.untrusted_telegram_to_hitl !== false },',
    '  };',
    '}',
    '',
    'function loadPolicyConfig(): PolicyConfig {',
    "  const p = path.join(process.cwd(), 'policy.yaml');",
    '  if (!fs.existsSync(p)) return DEFAULT_POLICY;',
    '  try {',
    '    return parsePolicyYaml(fs.readFileSync(p, \"utf8\"));',
    '  } catch {',
    '    return DEFAULT_POLICY;',
    '  }',
    '}',
    '',
    'function parseSafeObject(value: unknown): Record<string, unknown> {',
    '  if (!value || typeof value !== \"object\") return {};',
    '  return value as Record<string, unknown>;',
    '}',
    '',
    'function parseJsonObject(value: unknown): Record<string, unknown> {',
    '  if (!value) return {};',
    '  if (typeof value === \"object\") return parseSafeObject(value);',
    '  if (typeof value !== \"string\") return {};',
    '  try {',
    '    const parsed = JSON.parse(value);',
    '    return parseSafeObject(parsed);',
    '  } catch {',
    '    return {};',
    '  }',
    '}',
    '',
    'function getTaskPolicyContext(taskId: string): PolicyContext {',
    '  const policy = loadPolicyConfig();',
    "  const row = queryOne<{ source_event: string | null; metadata: string | null }>(\"SELECT source_event, metadata FROM swarm_tasks WHERE task_id = ?\", [taskId]);",
    '  const source = parseJsonObject(row?.source_event || null);',
    '  const metadata = parseJsonObject(row?.metadata || null);',
    '  const sourceMeta = parseSafeObject(source.metadata);',
    '  const sourceChatId = String(',
    '    source.telegram_chat_id ||',
    '    source.chat_id ||',
    '    sourceMeta.telegram_chat_id ||',
    '    sourceMeta.chatId ||',
    '    metadata.telegram_chat_id ||',
    '    sourceMeta.chat_id ||',
    '    sourceMeta.master_chat_id ||',
    "    ''",
    '  ).trim();',
    "  const sourceType = String(source.source || '').toLowerCase();",
    '  const isTelegram = sourceType === \'telegram\' || sourceType === \'telegram_webhook\';',
    '  const masterChatId = String(process.env.TELEGRAM_MASTER_CHAT_ID || \'\').trim();',
    '  const isUntrusted = isTelegram && (!masterChatId || (sourceChatId ? sourceChatId !== masterChatId : true));',
    '  return {',
    '    policy,',
    '    sourceType,',
    '    isUntrustedTelegram: isUntrusted && policy.sandbox_rules.untrusted_telegram_to_hitl !== false,',
    '    sourceChatId: sourceChatId || null,',
    "    resolvedBy: 'policy.yaml',",
    '  };',
    '}',
    '',
    'function isAllowedDomain(rawUrl: string, allowed: string[]): boolean {',
    '  try {',
    '    const host = new URL(rawUrl).hostname.toLowerCase();',
    '    return (allowed || []).some((item) => {',
    '      const c = String(item || \'\').toLowerCase();',
    '      return host === c || host.endsWith(\'.\' + c);',
    '    });',
    '  } catch {',
    '    return false;',
    '  }',
    '}',
    '',
    'function classifyToolAction(toolName: string, argsRaw: unknown, ctx: PolicyContext): { decision: PolicyDecision; reason: string } {',
    '  const name = String(toolName || \'\').trim().toLowerCase();',
    '  const args = parseSafeObject(argsRaw);',
    '  const payload = JSON.stringify(args);',
    '  const targetUrl = String(args.url || args.endpoint || args.target || args.uri || ).trim();',
    '',
    '  if (payload.includes(\'.env\') || name.includes(\'read_env\') || name.includes(\'_env\')) {',
    "    return { decision: 'banned', reason: `BANNED_ACTION: env access blocked (${name})` };",
    '  }',
    "  if ((name === 'scrape_and_parse_url' || name === 'fetch_url' || name === 'http_request' || name === 'external_api_call' || name === 'fetch_data_from_unapproved_domain') && targetUrl && !isAllowedDomain(targetUrl, ctx.policy.allowed_fetch_domains)) {",
    "    return { decision: 'banned', reason: 'BANNED_ACTION: unapproved domain fetch ' + targetUrl };",
    '  }',
    '',
    '  if (ctx.policy.banned_actions.includes(name)) {',
    "    return { decision: 'banned', reason: `BANNED_ACTION: ${name} policy deny` };",
    '  }',
    '',
    "  if (ctx.policy.hitl_required_actions.includes(name) || ctx.isUntrustedTelegram && (name === 'search_past_deliverables' || name === 'internal_log_read' || name === 'query_internal_db' || name === 'scrape_and_parse_url')) {",
    "    return { decision: 'hitl_required', reason: `HITL_REQUIRED: ${name} from ${ctx.isUntrustedTelegram ? 'untrusted source' : 'policy'}` };",
    '  }',
    '',
    '  if (ctx.policy.auto_approve_actions.includes(name)) {',
    "    return { decision: 'auto_approve', reason: `AUTO_APPROVE: ${name}` };",
    '  }',
    '',
    "  return { decision: 'auto_approve', reason: `AUTO_APPROVE: default ${name}` };",
    '}',
    '',
    'function enterPolicyGate(params: { taskId: string; runId: string; toolCallId: string; toolName: string; reason: string }) {',
    '  const approvalId = `policy-${params.runId}-${params.toolCallId}`;',
    "  const now = new Date().toISOString();",
    "  run(\"INSERT OR IGNORE INTO swarm_approvals (approval_id, task_id, gate_reason, approval_status, requested_at) VALUES (?, ?, ?, 'pending', ?)\",",
    '    [approvalId, params.taskId, `policy:${params.reason}`, now],',
    '  );',
    "  run(\"UPDATE swarm_runs SET run_status='hitl_review', ended_at=?, duration_ms=?, output_summary=? WHERE run_id=?\", [now, 0, `Policy gate: ${params.reason}`, params.runId]);",
    "  run(\"UPDATE swarm_tasks SET status='hitl_review', updated_at=? WHERE task_id=?\", [now, params.taskId]);",
    "  logEvent(params.taskId, params.runId, `[POLICY_GATE] ${params.toolName} -> ${params.reason}`);",
    '}',
    '',
  ].join('\n');
}

function applyPolicyBlock(content) {
  const marker = "type PolicyDecision = 'auto_approve' | 'hitl_required' | 'banned';";
  if (content.includes(marker)) return content;

  const anchor = 'export async function executeSwarmRunAsync(params: {';
  if (!content.includes(anchor)) throw new Error('executeSwarmRunAsync anchor not found');
  return content.replace(anchor, policyBlockTemplate() + '\n\n' + anchor);
}

function applyToolGate(content) {
  const anchor = [
    "        const toolStartedAt = new Date().toISOString();",
    '        let toolResult: unknown = null;',
    '        let toolSucceeded = false;',
  ].join('\n');

  if (content.includes("policyDecision.decision === 'banned'")) {
    return content;
  }

  const inserted = [
    "        const toolStartedAt = new Date().toISOString();",
    '        const policyContext = getTaskPolicyContext(params.taskId);',
    '        const policyDecision = classifyToolAction(next.name, next.arguments, policyContext);',
    "        if (policyDecision.decision === 'banned') {",
    '          tracer.logSpan({',
    "            spanType: 'tool_call',",
    "            spanName: next.name,",
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
    "              policy_source: policyContext.resolvedBy,",
    '            },',
    '          });',
    "          throw new Error('POLICY_BLOCKED: ' + policyDecision.reason);",
    '        }',
    "        if (policyDecision.decision === 'hitl_required') {",
    '          tracer.logSpan({',
    "            spanType: 'tool_call',",
    "            spanName: next.name,",
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
    "              policy_source: policyContext.resolvedBy,",
    '            },',
    '          });',
    '          enterPolicyGate({',
    '            taskId: params.taskId,',
    '            runId: params.runId,',
    '            toolCallId: next.id,',
    '            toolName: next.name,',
    '            reason: policyDecision.reason,',
    '          });',
    '          return;',
    '        }',
    '        let toolResult: unknown = null;',
    '        let toolSucceeded = false;',
  ].join('\n');

  if (!content.includes(anchor)) throw new Error('tool call anchor not found');
  return content.replace(anchor, inserted);
}

(function main() {
  try {
    let content = fs.readFileSync(target, 'utf8');
    const original = content;
    content = ensureImports(content);
    content = applyPolicyBlock(content);
    content = applyToolGate(content);

    if (dryRun) {
      if (content === original) {
        console.log('dry-run: no changes needed.');
      } else {
        console.log('dry-run: patch needed / would apply changes.');
      }
      process.exit(0);
    }

    if (content !== original) {
      fs.writeFileSync(target, content, 'utf8');
      console.log('patched:', target);
    } else {
      console.log('patch already present; no changes made.');
    }
  } catch (error) {
    console.error('patch-policy-enforcer failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode ?? 0);
  }
})();
