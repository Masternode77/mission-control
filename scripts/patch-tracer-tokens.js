#!/usr/bin/env node
/**
 * Draft-only patcher for src/lib/swarm-executor.ts
 * Goal: capture usage.total_tokens (or prompt+completion) into tracer.logSpan.costTokens
 *
 * Usage:
 *   node scripts/patch-tracer-tokens.js --dry-run
 *   node scripts/patch-tracer-tokens.js --apply
 */
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src', 'lib', 'swarm-executor.ts');
const dryRun = !process.argv.includes('--apply');

function injectUsageHelper(content) {
  const marker = 'function enterPolicyGate(params: {';
  if (content.includes('function extractTotalTokensFromUsage(')) return content;
  if (!content.includes(marker)) throw new Error('helper anchor not found');

  const helper = [
    '',
    'function extractTotalTokensFromUsage(response: unknown): number | undefined {',
    '  const r = (response && typeof response === "object") ? (response as Record<string, unknown>) : {};',
    '  const usage = (r.usage && typeof r.usage === "object") ? (r.usage as Record<string, unknown>) : {};',
    '  const total = Number(usage.total_tokens);',
    '  if (Number.isFinite(total) && total >= 0) return total;',
    '  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? usage.inputTokenCount ?? 0);',
    '  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidates_token_count ?? usage.outputTokenCount ?? 0);',
    '  const merged = (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0);',
    '  if (merged > 0) return merged;',
    '  // Some wrappers put usage in nested result payloads',
    '  const result = (r.result && typeof r.result === "object") ? (r.result as Record<string, unknown>) : {};',
    '  const nestedUsage = (result.usage && typeof result.usage === "object") ? (result.usage as Record<string, unknown>) : {};',
    '  const nestedTotal = Number(nestedUsage.total_tokens);',
    '  if (Number.isFinite(nestedTotal) && nestedTotal >= 0) return nestedTotal;',
    '  return undefined;',
    '}',
    '',
  ].join('\n');

  return content.replace(marker, `${helper}\n${marker}`);
}

function injectTokenCapture(content) {
  let next = content;

  // Add holder near sendRes declaration
  next = next.replace(
    '    let sendRes: any;\n    let usedModel = undefined as string | undefined;\n',
    '    let sendRes: any;\n    let sendResTotalTokens: number | undefined = undefined;\n    let usedModel = undefined as string | undefined;\n'
  );

  // Capture usage right after successful chat.send
  next = next.replace(
    '      sendRes = await client.call(\'chat.send\', {\n        sessionKey: params.sessionKey,\n        message: payload,\n        idempotencyKey: `swarm-exec-${params.taskId}-${Date.now()}`,\n        __timeoutMs: 86400000,\n      });\n      initialSendSuccess = true;\n',
    '      sendRes = await client.call(\'chat.send\', {\n        sessionKey: params.sessionKey,\n        message: payload,\n        idempotencyKey: `swarm-exec-${params.taskId}-${Date.now()}`,\n        __timeoutMs: 86400000,\n      });\n      sendResTotalTokens = extractTotalTokensFromUsage(sendRes);\n      initialSendSuccess = true;\n'
  );

  // Pass costTokens to llm_call span
  next = next.replace(
    "        metadata: {\n          method: 'llm',",
    "        costTokens: sendResTotalTokens,\n        metadata: {\n          method: 'llm',"
  );

  return next;
}

(function main() {
  if (!fs.existsSync(target)) {
    console.error(`[patch-tracer-tokens] target not found: ${target}`);
    process.exit(1);
  }

  const before = fs.readFileSync(target, 'utf8');
  let after = before;

  after = injectUsageHelper(after);
  after = injectTokenCapture(after);

  if (before === after) {
    console.log('[patch-tracer-tokens] no changes needed (already patched or anchor mismatch).');
    process.exit(0);
  }

  if (dryRun) {
    console.log('[patch-tracer-tokens] DRY-RUN: patch prepared (not applied).');
    console.log('--- key diff preview ---');
    console.log('+ function extractTotalTokensFromUsage(response: unknown): number | undefined { ... }');
    console.log('+ sendResTotalTokens = extractTotalTokensFromUsage(sendRes);');
    console.log('+ tracer.logSpan({ spanType:\'llm_call\', ..., costTokens: sendResTotalTokens, ... })');
    process.exit(0);
  }

  fs.writeFileSync(target, after, 'utf8');
  console.log(`[patch-tracer-tokens] applied: ${target}`);
  process.exit(0);
})();
