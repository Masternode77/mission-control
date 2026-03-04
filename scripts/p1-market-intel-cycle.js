#!/usr/bin/env node
const path = require('path');
const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3005';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createP1Task() {
  const db = new Database(DB_PATH);
  try {
    const now = new Date().toISOString();
    const taskId = `MC-P1-${randomUUID().slice(0, 12)}`;
    const title = '[P1][Market Intelligence] CSP Infra + Site Selection Live Briefing';
    const objective = [
      'Collect latest AWS/Azure/GCP infra investment and DC expansion signals.',
      'Add site-selection relevant signals (power/capacity/site feasibility) from trusted public sources.',
      'Produce structured markdown briefing with evidence links and risk flags.',
      'Output must be ready for HITL approval.'
    ].join(' ');

    db.prepare(`
      INSERT INTO swarm_tasks (
        task_id, ws, title, objective, owner_role_id, priority, status,
        is_proactive, origin_type, created_by, created_at, updated_at, execution_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      'default',
      title,
      objective,
      'MC-MAIN',
      'P1',
      'intake',
      1,
      'topdown',
      'p1-intel-cycle',
      now,
      now,
      0
    );

    return { taskId, title };
  } finally {
    try { db.close(); } catch {}
  }
}

async function orchestrate(taskId) {
  const res = await fetch(`${BASE_URL}/api/swarm/tasks/${taskId}/orchestrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`orchestrate failed: ${res.status} ${body}`);
  }
}

async function fetchTask(taskId) {
  const res = await fetch(`${BASE_URL}/api/swarm/tasks?workspace_id=default`);
  if (!res.ok) throw new Error(`fetch tasks failed: ${res.status}`);
  const arr = await res.json();
  return arr.find((t) => String(t.id) === String(taskId) || String(t.task_id || '') === String(taskId));
}

async function waitForHitlReview(taskId, timeoutMs = 180000) {
  const seen = [];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(1500);
    const t = await fetchTask(taskId);
    if (!t) continue;
    const s = String(t.status || 'unknown');
    if (seen[seen.length - 1] !== s) seen.push(s);
    if (s === 'hitl_review') return { seen, elapsedMs: Date.now() - start };
  }
  throw new Error('timeout waiting hitl_review');
}

async function main() {
  const { taskId, title } = createP1Task();
  await orchestrate(taskId);
  const result = await waitForHitlReview(taskId);
  console.log('[P1 CYCLE PASS]', { taskId, title, finalStatus: 'hitl_review', seen: result.seen, elapsedMs: result.elapsedMs });
}

main().catch((e) => {
  console.error('[P1 CYCLE FAIL]', e.message);
  process.exit(1);
});
