#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src', 'lib', 'swarm-executor.ts');
const dryRun = process.argv.includes('--dry-run');

function ensureImport(content) {
  const anchor = "import { createSwarmTracer } from '@/lib/tracer';";
  const replacement = "import { createSwarmTracer } from '@/lib/tracer';\nimport { classifyIntent, formatIntentForPrompt } from '@/lib/pre-router';";

  if (content.includes('classifyIntent') && content.includes('formatIntentForPrompt')) return content;
  if (!content.includes(anchor)) throw new Error('createSwarmTracer anchor missing');
  return content.replace(anchor, replacement);
}

function injectRouterAtStart(content) {
  const marker = '  const startedAtMs = Date.now();';
  const block = [
    '  const preRouteIntentInput = `${params.taskTitle || ""}\\n${params.objective || ""}\\n${params.subPrompt || ""}`;',
    '  const preRouteIntent = classifyIntent(preRouteIntentInput);',
    "  logEvent(params.taskId, params.runId, `[PREROUTER] intent=${preRouteIntent.category} score=${preRouteIntent.score}`);",
    '  const preRouteSystemPrompt = formatIntentForPrompt(preRouteIntent);',
    "  logEvent(params.taskId, params.runId, `[PREROUTER] metadata=${preRouteSystemPrompt}`);",
    '  const startedAtMs = Date.now();',
  ].join('\n');

  if (!content.includes(marker)) throw new Error('startedAtMs marker missing');
  if (content.includes('const preRouteIntent = classifyIntent(preRouteIntentInput);')) return content;

  return content.replace(marker, block);
}

function injectPromptMetadata(content) {
  const routingAnchor = [
    "    const payload = [",
    "      role?.prompt_template_ref || '',",
    "      '',",
    "      '# ROUTING',",
    '      preRouteSystemPrompt,',
    "      '# TASK',",
  ].join('\n');

  if (content.includes("'# ROUTING',") && content.includes('preRouteSystemPrompt')) return content;

  const old = [
    "    const payload = [",
    "      role?.prompt_template_ref || '',",
    "      '',",
    "      '# TASK',",
    "      `Title: ${params.taskTitle}`,",
    "      `Objective: ${params.objective || '-'}`",
  ].join('\n');

  const replacement = routingAnchor;
  if (!content.includes(old)) throw new Error('payload anchor block mismatch');

  return content.replace(old, replacement);
}

(function main() {
  try {
    let content = fs.readFileSync(target, 'utf8');
    const original = content;

    content = ensureImport(content);
    content = injectRouterAtStart(content);
    content = injectPromptMetadata(content);

    if (dryRun) {
      if (content !== original) {
        console.log('patch needed: pre-router changes would be applied.');
      } else {
        console.log('patch already present; no changes needed.');
      }
      process.exit(0);
    }

    if (content !== original) {
      fs.writeFileSync(target, content, 'utf8');
      console.log('patched', target);
    } else {
      console.log('patch already present; no changes made.');
    }
  } catch (error) {
    console.error('patch-pre-router failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode ?? 0);
  }
})();
