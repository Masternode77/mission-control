#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const targetPath = path.join(repoRoot, 'src', 'lib', 'swarm-executor.ts');

function ensureImport(content) {
  const importLine = "import { createSwarmTracer } from '@/lib/tracer';\n";
  if (content.includes("from '@/lib/tracer'") || content.includes('createSwarmTracer')) return content;

  const lines = content.split('\n');
  let insertIdx = 0;
  while (insertIdx < lines.length && lines[insertIdx].startsWith('import ')) {
    insertIdx += 1;
  }
  lines.splice(insertIdx, 0, importLine.trimEnd());
  return lines.join('\n');
}

function ensureTracerInit(content) {
  const marker = '  const startedAtMs = Date.now();';
  const inject = `${marker}\n  const tracer = createSwarmTracer(params.taskId, params.runId);`;

  if (content.includes('const tracer = createSwarmTracer(params.taskId, params.runId);')) return content;
  if (!content.includes(marker)) return content;
  return content.replace(marker, inject);
}

function patchLlmCall(content) {
  if (content.includes('spanType: \'llm_call\'')) return content;

  const start = content.indexOf("    let sendRes: any;");
  const end = content.indexOf('    streamRunId = String(sendRes?.runId || \'\');', start);
  if (start === -1 || end === -1) return content;

  const replacement = [
    '    const llmCallStartedAt = new Date().toISOString();',
    '    let sendRes: any;',
    '    let initialSendSuccess = false;',
    '    let usedModel = undefined as string | undefined;',
    '    try {',
    '      usedModel = role?.default_agent_id ?',
    "        queryOne<{ model: string | null }>(\'SELECT model FROM agents WHERE id = ?\', [role?.default_agent_id]).model || undefined',",
    '        : undefined;',
    '    } catch {}',
    '    try {',
    '      sendRes = await client.call(\'chat.send\', {',
    '        sessionKey: params.sessionKey,',
    '        message: payload,',
    "        idempotencyKey: `swarm-exec-${params.taskId}-${Date.now()}`,",
    '        __timeoutMs: 86400000,',
    '      });',
    '      initialSendSuccess = true;',
    '    } catch (initialSendError) {',
    '      tracer.logSpan({',
    "        spanType: 'llm_call',",
    "        spanName: 'chat.send.initial',",
    '        model: usedModel || undefined,',
    '        success: false,',
    '        latencyMs: Date.now() - Date.parse(llmCallStartedAt),',
    '        metadata: { error: initialSendError instanceof Error ? initialSendError.message : String(initialSendError) },',
    '      });',
    '      throw initialSendError;',
    '    } finally {',
    '      tracer.logSpan({',
    "        spanType: 'llm_call',",
    "        spanName: 'chat.send.initial',",
    '        model: usedModel || undefined,',
    '        success: initialSendSuccess,',
    '        latencyMs: Date.now() - Date.parse(llmCallStartedAt),',
    '        hitlStartedAt: llmCallStartedAt,',
    '        metadata: { method: \'llm\' },',
    '      });',
    '    }',
    '',
  ].join('\n');

  return content.slice(0, start) + replacement + content.slice(end);
}

function patchToolCalls(content) {
  if (content.includes('spanType: \'tool_call\'')) return content;

  const blockStart = content.indexOf('        const toolResult = await executeToolByName(next.name, next.arguments, {');
  if (blockStart === -1) return content;

  const blockEnd = content.indexOf('        await client.call(\'chat.send\', {', blockStart);
  if (blockEnd === -1) return content;

  const toolCallEnd = content.indexOf('        });', blockEnd);
  if (toolCallEnd === -1) return content;

  const blockEndAfter = toolCallEnd + '        });'.length;

  const replacement = [
    '        const toolStartedAt = new Date().toISOString();',
    '        let toolSucceeded = false;',
    '        let toolResult: unknown = null;',
    '        try {',
    '          toolResult = await executeToolByName(next.name, next.arguments, {',
    "            workspaceId: 'default',",
    "            parentTaskId: params.taskId,",
    "            requesterRoleId: params.roleId,",
    '          });',
    '          toolSucceeded = true;',
    '        } finally {',
    "          tracer.logSpan({",
    "            spanType: 'tool_call',",
    "            spanName: next.name,",
    "            toolName: next.name,",
    "            toolArguments: next.arguments,",
    '            success: toolSucceeded,',
    '            latencyMs: Date.now() - Date.parse(toolStartedAt),',
    '            hitlStartedAt: toolStartedAt,',
    '            metadata: { tool_call_id: next.id },',
    '          });',
    '        }',

    '        run(',
    "          `INSERT INTO events (id, type, task_id, message, metadata, created_at)',",
    "           VALUES (?, ?, NULL, ?, ?, ?)`,",
    '          [',
    '            randomUUID(),',
    "            '\\'system\\'',",
    "            `[TOOL_RESULT] ${next.name} completed`,",
    '            JSON.stringify({ swarm_task_id: params.taskId, run_id: params.runId, tool_name: next.name, tool_call_id: next.id }),',
    '            new Date().toISOString(),',
    '          ]',
    '        );',

    '        broadcast({',
    "          type: 'event_logged',",
    '          payload: {',
    '            taskId: params.taskId,',
    '            sessionId: params.runId,',
    "            summary: `[TOOL_USE] Executing ${next.name}...done`,",
    '          },',
    '        });',

    '        await client.call(\'chat.send\', {',
    '          sessionKey: params.sessionKey,',
    "          message: `TOOL_RESULT\\nname=${next.name}\\ncall_id=${next.id}\\n\\n${toolResult}`,",
    '          idempotencyKey: `swarm-tool-${params.taskId}-${next.id}-${Date.now()}`,',
    '          __timeoutMs: 120000,',
    '        });',
  ].join('\n');

  return content.slice(0, blockStart) + replacement + content.slice(blockEndAfter);
}

function patchSynthesis(content) {
  if (content.includes('spanType: \'synthesis\'')) return content;

  const marker = '    const cleanMarkdown = stripHandoffLeak(finalMarkdown);';
  if (!content.includes(marker)) return content;

  const inject = [
    '    const cleanMarkdown = stripHandoffLeak(finalMarkdown);',
    '',
    "    tracer.logSpan({",
    "      spanType: 'synthesis',",
    '      spanName: params.taskTitle,',
    '      success: true,',
    '      latencyMs: Date.now() - startedAtMs,',
    "      metadata: { is_master: isMasterReportTask(params.taskTitle) }",
    '    });',
    '',
  ].join('\n');

  return content.replace(marker, inject);
}

function ensureHitlGateOnExit(content) {
  if (content.includes('spanType: \'hitl_gate\'')) return content;

  const marker = "    const isMaster = isMasterReportTask(params.taskTitle);";
  if (!content.includes(marker)) return content;

  const replacement = [
    "    tracer.logSpan({",
    "      spanType: 'hitl_gate',",
    "      spanName: 'execute_to_hitl_review',",
    '      success: true,',
    "      metadata: {",
    '        started_at: new Date().toISOString(),',
    '        expected_wait_end: new Date(Date.now() + 1).toISOString(),',
    '      }',
    '    });',
    '',
    marker,
  ].join('\n');

  return content.replace(marker, replacement);
}

function ensureRoleDefaultAgent(content) {
  const oldSel = "    const role = queryOne<{ prompt_template_ref: string | null }>(";
  const newSel = "    const role = queryOne<{ prompt_template_ref: string | null; default_agent_id: string | null }>(";
  if (!content.includes(oldSel)) return content;
  return content.replace(oldSel, newSel);
}

function runPatch() {
  const cwd = process.cwd();
  if (repoRoot !== cwd) {
    process.chdir(repoRoot);
  }

  let content = fs.readFileSync(targetPath, 'utf8');

  content = ensureImport(content);
  content = ensureRoleDefaultAgent(content);
  content = ensureTracerInit(content);
  content = patchLlmCall(content);
  content = patchToolCalls(content);
  content = patchSynthesis(content);
  content = ensureHitlGateOnExit(content);

  fs.writeFileSync(targetPath, content);
  console.log('patched', targetPath);
}

(async function main() {
  try {
    runPatch();
  } catch (error) {
    console.error('patch-tracer failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    // no open resources are intentionally kept, but guarantee clean termination
    process.exit(process.exitCode ?? 0);
  }
})();