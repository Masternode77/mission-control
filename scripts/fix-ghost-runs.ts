import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const db = new Database(dbPath);

try {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const now = new Date().toISOString();

  const completedTasks = db
    .prepare("SELECT task_id FROM swarm_tasks WHERE status = 'completed'")
    .all() as { task_id: string }[];

  const taskIds = completedTasks.map((r) => r.task_id);

  let updated = 0;
  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(',');
    const stmt = db.prepare(
      `UPDATE swarm_runs
       SET run_status = 'completed',
           ended_at = COALESCE(ended_at, ?),
           error_message = CASE WHEN error_message = 'retry superseded' THEN NULL ELSE error_message END
       WHERE task_id IN (${placeholders}) AND run_status != 'completed'`
    );
    const res = stmt.run(now, ...taskIds);
    updated = Number(res.changes || 0);
  }

  console.log(`[fix-ghost-runs] completed_tasks=${taskIds.length} updated_runs=${updated}`);
} finally {
  db.close();
}
