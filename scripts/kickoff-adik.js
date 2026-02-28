#!/usr/bin/env node
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3005';
const TARGET_TITLE = '[ADIK] Site C 영업 패킷 및 Site A 하이브리드 패키지 보강';

async function main() {
  const db = new Database(DB_PATH);
  try {
    const waiting = db.prepare(`
      SELECT task_id, title, status
      FROM swarm_tasks
      WHERE title = ?
        AND status IN ('intake','queued','todo','pending','ready','backlog')
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(TARGET_TITLE);

    const fallback = db.prepare(`
      SELECT task_id, title, status
      FROM swarm_tasks
      WHERE title = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(TARGET_TITLE);

    const picked = waiting || fallback;
    if (!picked) {
      console.error('[kickoff-adik] target task not found');
      process.exit(1);
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE swarm_tasks SET status = ?, updated_at = ? WHERE task_id = ?').run('in_progress', now, picked.task_id);
    console.log(`[kickoff-adik] task marked in_progress: ${picked.task_id} (was ${picked.status})`);

    const res = await fetch(`${BASE_URL}/api/swarm/tasks/${picked.task_id}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`[kickoff-adik] orchestrate failed: ${res.status} ${text}`);
      process.exit(1);
    }

    console.log(`[kickoff-adik] executeSwarmRunAsync triggered via orchestrate route for task=${picked.task_id}`);
    console.log(text);
    process.exit(0);
  } catch (e) {
    console.error('[kickoff-adik] failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    try { db.close(); } catch {}
  }
}

main();
