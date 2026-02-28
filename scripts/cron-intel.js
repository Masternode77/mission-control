#!/usr/bin/env node
const cron = require('node-cron');
const path = require('path');
const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');

function createIntelTask() {
  const db = new Database(DB_PATH);
  try {
    const now = new Date().toISOString();
    const taskId = `MC-INTAKE-${randomUUID().slice(0,12)}`;
    const title = '[AUTO-INTEL] Actis/Equinix/Digital Realty daily crawl summary';
    const objective = 'Actis, Equinix, Digital Realty의 최신 동향을 크롤링하여 요약하라';

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
      'intel-cron',
      now,
      now,
      0
    );

    console.log(`[intel-cron] task created: ${taskId}`);
  } catch (e) {
    console.error('[intel-cron] failed:', e instanceof Error ? e.message : String(e));
  } finally {
    try { db.close(); } catch {}
  }
}

cron.schedule('0 7 * * *', createIntelTask, { timezone: 'Asia/Seoul' });
console.log('[intel-cron] started (daily 07:00 Asia/Seoul)');
