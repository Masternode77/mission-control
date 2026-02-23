import path from 'path';
import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const db = new Database(dbPath);
const now = new Date().toISOString();

const before = db.prepare("SELECT run_status, COUNT(*) c FROM swarm_runs GROUP BY run_status").all();

const tx = db.transaction(() => {
  db.prepare(
    `UPDATE swarm_runs
     SET run_status = CASE WHEN run_status = 'running' THEN 'failed' ELSE run_status END,
         ended_at = COALESCE(ended_at, ?),
         duration_ms = COALESCE(duration_ms, 0),
         error_message = CASE WHEN run_status = 'running' THEN COALESCE(error_message, 'cleanup: stale running state') ELSE error_message END
     WHERE run_status = 'running' OR ended_at IS NULL`
  ).run(now);
});

tx();

const after = db.prepare("SELECT run_status, COUNT(*) c FROM swarm_runs GROUP BY run_status").all();
console.log('cleanup-swarm-runs');
console.log('dbPath=', dbPath);
console.log('before=', before);
console.log('after=', after);

db.close();
