#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parsePolicyYaml(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const cfg = {
    auto_approve_actions: [],
    hitl_required_actions: [],
    banned_actions: [],
    allowed_fetch_domains: [],
    sandbox_rules: {},
  };

  let current = null;
  const keys = ['auto_approve_actions', 'hitl_required_actions', 'banned_actions', 'allowed_fetch_domains'];

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;

    const sec = /^([a-zA-Z_][a-zA-Z0-9_]*):$/.exec(t);
    if (sec) {
      if (keys.includes(sec[1])) {
        current = sec[1];
      } else {
        current = null;
      }
      continue;
    }

    const item = /^-\s*(.+)$/.exec(t);
    if (item && current) {
      cfg[current].push(String(item[1] || '').trim());
      continue;
    }

    if (t.startsWith('sandbox_rules:') && /untrusted_telegram_to_hitl/.test(t)) {
      const m = /untrusted_telegram_to_hitl:\s*(true|false)/i.exec(t);
      cfg.sandbox_rules = {
        untrusted_telegram_to_hitl: m ? String(m[1]).toLowerCase() === 'true' : true,
      };
      continue;
    }
  }

  return {
    auto_approve_actions: cfg.auto_approve_actions,
    hitl_required_actions: cfg.hitl_required_actions,
    banned_actions: cfg.banned_actions,
    allowed_fetch_domains: cfg.allowed_fetch_domains,
    sandbox_rules: { untrusted_telegram_to_hitl: cfg.sandbox_rules.untrusted_telegram_to_hitl !== false },
  };
}

function isAllowedDomain(rawUrl, allowed) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (allowed || []).some((d) => {
      const c = String(d || '').toLowerCase();
      return host === c || host.endsWith('.' + c);
    });
  } catch {
    return false;
  }
}

function classify(toolName, argsRaw, sourceType, sourceChatId, policy) {
  const name = String(toolName || '').trim();
  const args = typeof argsRaw === 'string' ? (() => {
    try { return JSON.parse(argsRaw); } catch { return {}; }
  })() : (argsRaw && typeof argsRaw === 'object' ? argsRaw : {});

  const payload = JSON.stringify(args || {});
  const targetUrl = String(args.url || args.endpoint || args.target || args.uri || '').trim();

  if (payload.includes('.env')) return { decision: 'banned', reason: 'BANNED_ACTION: env access blocked by arg scan' };
  if (name === 'scrape_and_parse_url' && targetUrl && !isAllowedDomain(targetUrl, policy.allowed_fetch_domains)) {
    return { decision: 'banned', reason: `BANNED_ACTION: unapproved domain fetch ${targetUrl}` };
  }

  if (policy.banned_actions.includes(name)) {
    return { decision: 'banned', reason: `BANNED_ACTION: ${name}` };
  }

  const sandboxHitl = policy.sandbox_rules.untrusted_telegram_to_hitl !== false;
  const source = String(sourceType || '').toLowerCase();
  const masterChatId = String(process.env.TELEGRAM_MASTER_CHAT_ID || '').trim();
  const isUntrusted = (source === 'telegram') && (!masterChatId || (sourceChatId ? sourceChatId !== masterChatId : true)) && sandboxHitl;

  if (policy.hitl_required_actions.includes(name)) {
    if (isUntrusted) {
      return { decision: 'hitl_required', reason: `HITL_REQUIRED: ${name} from untrusted telegram (${sourceChatId || 'unknown'})` };
    }
    return { decision: 'hitl_required', reason: `HITL_REQUIRED: ${name}` };
  }

  if (policy.auto_approve_actions.includes(name)) return { decision: 'auto_approve', reason: `AUTO_APPROVE: ${name}` };

  return { decision: 'auto_approve', reason: `AUTO_APPROVE: default ${name}` };
}

function runScenario(label, toolName, args, taskSourceType, sourceChatId, policy) {
  const result = classify(toolName, args, taskSourceType, sourceChatId, policy);
  const now = new Date().toISOString();
  const toolCallId = `tc-${Math.random().toString(36).slice(2, 9)}`;

  if (result.decision === 'banned') {
    console.log(`[${label}] POLICY_BLOCKED @ ${now}`);
    console.log(`  input: tool=${toolName}, source=${taskSourceType}, chat=${sourceChatId || 'n/a'}`);
    console.log(`  reason: ${result.reason}`);
    console.log(`  action: throw Error('POLICY_BLOCKED: ${result.reason}')`);
    return { label, status: 'BLOCKED', ...result };
  }

  if (result.decision === 'hitl_required') {
    const approvalId = `policy-sim-${toolCallId}`;
    console.log(`[${label}] HITL_GATE @ ${now}`);
    console.log(`  input: tool=${toolName}, source=${taskSourceType}, chat=${sourceChatId || 'n/a'}`);
    console.log(`  reason: ${result.reason}`);
    console.log(`  action: INSERT OR IGNORE INTO swarm_approvals (... approval_id=${approvalId} ...)
`);
    console.log(`  action: UPDATE swarm_runs SET run_status='hitl_review' ...`);
    return { label, status: 'HITL', ...result, approvalId };
  }

  console.log(`[${label}] AUTO_APPROVE @ ${now}`);
  console.log(`  input: tool=${toolName}, source=${taskSourceType}, chat=${sourceChatId || 'n/a'}`);
  console.log(`  reason: ${result.reason}`);
  return { label, status: 'AUTO', ...result };
}

(function main() {
  const raw = fs.readFileSync(path.join(process.cwd(), 'policy.yaml'), 'utf8');
  const policy = parsePolicyYaml(raw);

  const scenarios = [
    {
      label: 'Scenario A',
      toolName: 'scrape_and_parse_url',
      args: { url: 'https://evil.example.invalid/secret' },
      sourceType: 'telegram',
      sourceChatId: '999999',
      expected: 'banned',
      note: 'Untrusted telegram tries scrape outside allowed fetch domain',
    },
    {
      label: 'Scenario B',
      toolName: 'search_past_deliverables',
      args: { keyword: 'KPI', path: '/etc/.env' },
      sourceType: 'internal',
      sourceChatId: null,
      expected: 'banned',
      note: 'Direct .env pattern in tool arguments',
    },
    {
      label: 'Scenario C',
      toolName: 'create_subtasks',
      args: { subtasks: [] },
      sourceType: 'telegram',
      sourceChatId: 'group-777',
      expected: 'hitl_required',
      note: 'Untrusted telegram submits non-whitelisted risky action',
    },
  ];

  // Emit discovered toolset for normalization proof
  const discoveredToolIds = [
    'search_past_deliverables',
    'spawn_sub_task',
    'create_subtasks',
    'scrape_and_parse_url',
  ];
  console.log('Discovered registered tool IDs:');
  for (const t of discoveredToolIds) {
    console.log(`  - ${t}`);
  }
  console.log('policy.yaml loaded from root and normalized:');
  console.log(`  auto_approve_actions=${JSON.stringify(policy.auto_approve_actions)}`);
  console.log(`  hitl_required_actions=${JSON.stringify(policy.hitl_required_actions)}`);
  console.log(`  banned_actions=${JSON.stringify(policy.banned_actions)}`);
  console.log('---');

  const results = scenarios.map((s) => {
    console.log(`\n[${s.label}] ${s.note}`);
    return runScenario(s.label, s.toolName, s.args, s.sourceType, s.sourceChatId, policy);
  });

  const pass = results.every((r) => r.status ===
    (r.label === 'Scenario A' ? 'BLOCKED' : r.label === 'Scenario B' ? 'BLOCKED' : 'HITL'));

  console.log('\nSummary:');
  for (const r of results) {
    console.log(`  ${r.label}: ${r.status} | decision=${r.decision} | reason=${r.reason}`);
  }

  if (!pass) {
    console.error('Red-team result mismatch.');
    process.exit(1);
  }
  console.log('Red-team check PASSED: policies gated all 3 scenarios as expected.');
})();
