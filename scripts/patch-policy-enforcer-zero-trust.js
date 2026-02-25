#!/usr/bin/env node
/**
 * Draft-only patcher for scripts/patch-policy-enforcer.js
 * Goal: enforce Zero-Trust default-deny (unknown actions => HITL)
 *
 * Usage:
 *   node scripts/patch-policy-enforcer-zero-trust.js --dry-run
 *   node scripts/patch-policy-enforcer-zero-trust.js --apply
 */
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'scripts', 'patch-policy-enforcer.js');
const dryRun = !process.argv.includes('--apply');

function patch(content) {
  let next = content;

  // 1) Change final fallback from auto_approve -> hitl_required
  next = next.replace(
    "  return { decision: 'auto_approve', reason: `AUTO_APPROVE: default ${name}` };",
    "  return { decision: 'hitl_required', reason: `HITL_REQUIRED: default-deny unknown action ${name}` };"
  );

  // 2) Make unknown tools explicit in reasoning block (human-auditable)
  next = next.replace(
    "  if (ctx.policy.auto_approve_actions.includes(name)) {\n    return { decision: 'auto_approve', reason: `AUTO_APPROVE: ${name}` };\n  }\n\n  return { decision: 'hitl_required', reason: `HITL_REQUIRED: default-deny unknown action ${name}` };",
    "  if (ctx.policy.auto_approve_actions.includes(name)) {\n    return { decision: 'auto_approve', reason: `AUTO_APPROVE: whitelist ${name}` };\n  }\n\n  return { decision: 'hitl_required', reason: `HITL_REQUIRED: default-deny unknown action ${name}` };"
  );

  // 3) Tighten untrusted telegram rule to include unknowns via default-deny path
  // (No direct replacement needed if fallback above is hitl_required)

  return next;
}

(function main() {
  if (!fs.existsSync(target)) {
    console.error(`[patch-policy-enforcer-zero-trust] target not found: ${target}`);
    process.exit(1);
  }

  const before = fs.readFileSync(target, 'utf8');
  const after = patch(before);

  if (before === after) {
    console.log('[patch-policy-enforcer-zero-trust] no changes needed (already zero-trust or anchor mismatch).');
    process.exit(0);
  }

  if (dryRun) {
    console.log('[patch-policy-enforcer-zero-trust] DRY-RUN: patch prepared (not applied).');
    console.log('--- key diff preview ---');
    console.log("- return { decision: 'auto_approve', reason: `AUTO_APPROVE: default ${name}` };");
    console.log("+ return { decision: 'hitl_required', reason: `HITL_REQUIRED: default-deny unknown action ${name}` };");
    process.exit(0);
  }

  fs.writeFileSync(target, after, 'utf8');
  console.log(`[patch-policy-enforcer-zero-trust] applied: ${target}`);
  process.exit(0);
})();
