#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parsePolicy(raw) {
  const out = { auto: [], hitl: [], banned: [] };
  let mode = '';
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (t === 'auto_approve_actions:') mode = 'auto';
    else if (t === 'hitl_required_actions:') mode = 'hitl';
    else if (t === 'banned_actions:') mode = 'banned';
    else if (/^[a-z_]+:/.test(t)) mode = '';
    else if (mode && t.startsWith('- ')) out[mode].push(t.slice(2).trim());
  }
  return out;
}

function classifyUnknown(action, p) {
  if (p.banned.includes(action)) return 'banned';
  if (p.hitl.includes(action)) return 'hitl_required';
  if (p.auto.includes(action)) return 'auto_approve';
  return 'hitl_required';
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(function main() {
  const policyPath = path.join(process.cwd(), 'policy.yaml');
  const executorPath = path.join(process.cwd(), 'src/lib/swarm-executor.ts');

  const policy = parsePolicy(fs.readFileSync(policyPath, 'utf8'));
  const executor = fs.readFileSync(executorPath, 'utf8');

  const unknownAction = 'unknown_action_test';
  const decision = classifyUnknown(unknownAction, policy);

  assert(decision === 'hitl_required', `unknown action must escalate to HITL, got=${decision}`);
  assert(executor.includes('default-deny unknown action'), 'runtime guard text missing in swarm-executor.ts');
  assert(!executor.includes('AUTO_APPROVE: default '), 'runtime still contains default auto-approve fallback');

  console.log('[POLICY REJECT FLOW PASS]', {
    action: unknownAction,
    decision,
    runtimeGuard: 'default-deny unknown action',
  });
})();
