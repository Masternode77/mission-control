#!/usr/bin/env node
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3005';

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function createTask() {
  const res = await fetch(`${BASE_URL}/api/swarm/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `[E2E] reject-revise-loop ${new Date().toISOString()}`,
      description: 'Validate HITL reject -> rework -> hitl_review loop',
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
  return arr.find((t) => String(t.id) === String(taskId) || String(t.task_id || '') === String(taskId)) || null;
}

async function fetchPendingApprovals() {
  const res = await fetch(`${BASE_URL}/api/swarm/approvals?status=pending`);
  if (!res.ok) throw new Error(`fetch approvals failed: ${res.status}`);
  return res.json();
}

async function rejectApproval(approvalId, note) {
  const res = await fetch(`${BASE_URL}/api/swarm/approvals/${approvalId}/reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note, reviewer: 'human' }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`reject failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function waitForStatus(taskId, wanted, timeoutMs = 480000) {
  const seen = [];
  const start = Date.now();
  let retriedOrchestrate = false;
  while (Date.now() - start < timeoutMs) {
    await sleep(1500);
    const t = await fetchTask(taskId);
    if (!t) continue;
    const s = String(t.status || 'unknown');
    if (seen[seen.length - 1] !== s) seen.push(s);

    if ((s === 'intake' || s === 'queued') && seen.includes('in_execution') && !retriedOrchestrate) {
      await orchestrate(taskId);
      retriedOrchestrate = true;
      continue;
    }

    if (s === wanted) return { task: t, seen, elapsedMs: Date.now() - start };
  }
  throw new Error(`timeout waiting ${wanted}; seen=${seen.join(' -> ')}`);
}

async function findApprovalForTask(taskId, title, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(1200);
    const approvals = await fetchPendingApprovals();
    const found = approvals.find((a) => String(a.task_id) === String(taskId) || String(a.title || '') === String(title));
    if (found) return found;
  }
  throw new Error('approval not found for task');
}

async function main() {
  const created = await createTask();
  const id = created.id || created.task_id;
  if (!id) throw new Error('task id missing');

  await orchestrate(id);
  const first = await waitForStatus(id, 'hitl_review');
  const approval = await findApprovalForTask(id, created.title || '');

  const note = '피드백: 데이터 소스 추가 바람';
  await rejectApproval(approval.approval_id, note);

  const rework = await waitForStatus(id, 'in_execution');
  const second = await waitForStatus(id, 'hitl_review');

  console.log('[E2E PASS]', {
    taskId: id,
    rejectNote: note,
    firstHitlSeen: first.seen,
    reworkSeen: rework.seen,
    secondHitlSeen: second.seen,
    elapsedMs: first.elapsedMs + rework.elapsedMs + second.elapsedMs,
  });
}

main().catch((e) => {
  console.error('[E2E FAIL]', e.message);
  process.exit(1);
});
