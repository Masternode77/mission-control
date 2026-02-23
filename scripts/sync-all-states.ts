import { queryAll, run } from '@/lib/db';

type Ghost = {
  run_id: string;
  task_id: string;
  task_status: string;
  run_status: string;
};

function main() {
  const now = new Date().toISOString();

  const ghosts = queryAll<Ghost>(
    `SELECT sr.run_id, sr.task_id, st.status as task_status, sr.run_status
     FROM swarm_runs sr
     JOIN swarm_tasks st ON st.task_id = sr.task_id
     WHERE sr.run_status = 'running'
       AND lower(COALESCE(st.status,'')) IN ('completed','failed')`
  );

  for (const g of ghosts) {
    run(
      `UPDATE swarm_runs
       SET run_status = CASE WHEN lower(?) = 'completed' THEN 'completed' ELSE 'failed' END,
           ended_at = COALESCE(ended_at, ?),
           error_message = CASE
             WHEN lower(?) = 'failed' AND (error_message IS NULL OR error_message = '') THEN 'Ghost run synced from terminal parent task'
             ELSE error_message
           END
       WHERE run_id = ?`,
      [g.task_status, now, g.task_status, g.run_id]
    );
  }

  // normalize impossible state: task completed but latest run failed-only and no running -> keep task completed
  // normalize impossible state: task failed but run still queued/running -> fail them
  const staleActive = queryAll<{ run_id: string }>(
    `SELECT sr.run_id
     FROM swarm_runs sr
     JOIN swarm_tasks st ON st.task_id = sr.task_id
     WHERE lower(COALESCE(st.status,'')) = 'failed'
       AND sr.run_status IN ('queued','pending','in_progress','running')`
  );

  for (const r of staleActive) {
    run(
      `UPDATE swarm_runs
       SET run_status='failed', ended_at = COALESCE(ended_at, ?),
           error_message = COALESCE(NULLIF(error_message,''), 'System Timeout: Zombie process detected')
       WHERE run_id = ?`,
      [now, r.run_id]
    );
  }

  console.log(`[sync-all-states] ghost_runs_fixed=${ghosts.length}, stale_active_fixed=${staleActive.length}`);
}

main();
