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

function classify(action, p) {
  if (p.banned.includes(action)) return 'banned';
  if (p.hitl.includes(action)) return 'hitl_required';
  if (p.auto.includes(action)) return 'auto_approve';
  return 'hitl_required'; // default-deny expectation
}

function assertEq(name, got, want) {
  if (got !== want) throw new Error(`${name}: expected=${want}, got=${got}`);
}

function main() {
  const policyPath = path.join(process.cwd(), 'policy.yaml');
  const p = parsePolicy(fs.readFileSync(policyPath, 'utf8'));

  assertEq('auto action', classify('search_past_deliverables', p), 'auto_approve');
  assertEq('hitl action', classify('create_subtasks', p), 'hitl_required');
  assertEq('banned action', classify('read_env_file', p), 'banned');
  assertEq('unknown action default-deny', classify('brand_new_tool_action', p), 'hitl_required');

  console.log('[POLICY MATRIX PASS]');
}

try {
  main();
} catch (e) {
  console.error('[POLICY MATRIX FAIL]', e.message);
  process.exit(1);
}
