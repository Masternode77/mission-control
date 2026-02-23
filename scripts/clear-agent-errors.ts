import { queryAll, run } from '@/lib/db';

type Row = { run_id: string; task_id: string; task_status: string; run_status: string };

function main() {
  const now = new Date().toISOString();

  const stale = queryAll<Row>(
    `SELECT sr.run_id, sr.task_id, st.status as task_status, sr.run_status
     FROM swarm_runs sr
     JOIN swarm_tasks st ON st.task_id = sr.task_id
     WHERE lower(COALESCE(st.status,'')) IN ('completed','failed','accepted','rejected')
       AND sr.run_status IN ('failed','running','queued','pending','in_progress')`
  );

  for (const r of stale) {
    if (r.run_status === 'failed') {
      run(
        `UPDATE swarm_runs
         SET run_status='archived',
             ended_at = COALESCE(ended_at, ?),
             error_message = COALESCE(NULLIF(error_message,''), 'Archived after parent task terminal')
         WHERE run_id = ?`,
        [now, r.run_id]
      );
    } else {
      run(
        `UPDATE swarm_runs
         SET run_status='completed',
             ended_at = COALESCE(ended_at, ?),
             error_message = CASE WHEN error_message='retry superseded' THEN NULL ELSE error_message END
         WHERE run_id = ?`,
        [now, r.run_id]
      );
    }
  }

  console.log(`[clear-agent-errors] cleaned=${stale.length}`);
}

main();
