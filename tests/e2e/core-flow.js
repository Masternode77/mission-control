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
      title: `[E2E] core-flow deep-track ${new Date().toISOString()}`,
      description: 'E2E deep tracking until terminal workflow status',
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
  return arr.find((t) => t.id === taskId) || null;
}

async function main() {
  const created = await createTask();
  const taskId = created.id;
  if (!taskId) throw new Error('task id missing');

  const routed = await orchestrate(taskId);
  if (!routed.ok) throw new Error('orchestrate response not ok');

  const seen = [];
  let found = null;
  const start = Date.now();
  const timeoutMs = 150000;
  let retriedOrchestrate = false;

  while (Date.now() - start < timeoutMs) {
    await sleep(1200);
    found = await fetchTask(taskId);
    if (!found) continue;

    const s = String(found.status || 'unknown');
    if (seen[seen.length - 1] !== s) seen.push(s);

    if ((s === 'intake' || s === 'queued') && seen.includes('in_execution') && !retriedOrchestrate) {
      await orchestrate(taskId);
      retriedOrchestrate = true;
      continue;
    }

    if (s === 'hitl_review' || s === 'completed') {
      console.log('[E2E PASS]', {
        taskId,
        finalStatus: s,
        seenStatuses: seen,
        owner: found.assigned_agent?.id || 'unknown',
        elapsedMs: Date.now() - start,
      });
      return;
    }
  }

  throw new Error(`timeout waiting terminal state; last=${found ? found.status : 'not_found'} seen=${seen.join(' -> ')}`);
}

main().catch((e) => {
  console.error('[E2E FAIL]', e.message);
  process.exit(1);
});
