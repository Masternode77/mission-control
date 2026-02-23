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
      // Force-normalize current DB values into universal pipeline
      let normalized = normalizeSwarmPipelineStatus(row.status);

      // User-requested guardrail: tasks previously pinned to domain-specific stage
      // should be treated as active execution by default.
      if (row.status === 'power_negotiation' || row.status === 'financial_modeling') {
        normalized = 'in_execution';
      }

      if (normalized !== row.status) {
        update.run(normalized, now, row.task_id);
        changed += 1;
      }
    }
  });

  tx();

  const summary = db.prepare('SELECT status, COUNT(*) as count FROM swarm_tasks GROUP BY status ORDER BY status').all();
  console.log(`[migrate-swarm-task-statuses-universal] scanned=${rows.length} changed=${changed}`);
  console.table(summary);
} finally {
  db.close();
}
