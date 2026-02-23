import path from 'path';
import Database from 'better-sqlite3';
import { normalizeSwarmPipelineStatus } from '../src/lib/swarm-status';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const db = new Database(dbPath);

try {
  const rows = db.prepare('SELECT task_id, status FROM swarm_tasks').all() as Array<{ task_id: string; status: string }>;

  const update = db.prepare('UPDATE swarm_tasks SET status = ?, updated_at = ? WHERE task_id = ?');
  const now = new Date().toISOString();

  let changed = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const normalized = normalizeSwarmPipelineStatus(row.status);
      if (normalized !== row.status) {
        update.run(normalized, now, row.task_id);
        changed += 1;
      }
    }
  });

  tx();

  const summary = db.prepare('SELECT status, COUNT(*) as count FROM swarm_tasks GROUP BY status ORDER BY status').all();

  console.log(`[migrate-swarm-task-statuses] scanned=${rows.length} changed=${changed}`);
  console.table(summary);
} finally {
  db.close();
}
