#!/usr/bin/env node
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3005';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createTask() {
  const res = await fetch(`${BASE_URL}/api/swarm/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `[E2E] core-flow ${new Date().toISOString()}`,
      description: 'E2E core flow validation',
      workspace_id: 'default',
      priority: 'normal',
      assigned_agent_id: 'MC-MAIN',
    }),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
  return res.json();
}

async function orchestrate(taskId) {
  const res = await fetch(`${BASE_URL}/api/swarm/tasks/${taskId}/orchestrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`orchestrate failed: ${res.status}`);
  return res.json();
}

async function fetchTask(taskId) {
  const res = await fetch(`${BASE_URL}/api/swarm/tasks?workspace_id=default`);
  if (!res.ok) throw new Error(`fetchTask list failed: ${res.status}`);
  const arr = await res.json();
  return arr.find((t) => t.id === taskId);
}

async function main() {
  const created = await createTask();
  const taskId = created.id;
  if (!taskId) throw new Error('task id missing');

  const routed = await orchestrate(taskId);
  if (!routed.ok) throw new Error('orchestrate response not ok');

  let found = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    found = await fetchTask(taskId);
    if (found && ['in_execution', 'hitl_review', 'completed'].includes(found.status)) break;
  }

  if (!found) throw new Error('task not found after orchestrate');
  if (!['in_execution', 'hitl_review', 'completed'].includes(found.status)) {
    throw new Error(`unexpected status: ${found.status}`);
  }

  console.log('[E2E PASS]', {
    taskId,
    status: found.status,
    owner: found.assigned_agent?.id || 'unknown',
  });
}

main().catch((e) => {
  console.error('[E2E FAIL]', e.message);
  process.exit(1);
});
