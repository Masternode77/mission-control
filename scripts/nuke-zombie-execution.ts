import { queryAll, run } from '@/lib/db';

type ZombieTask = {
  task_id: string;
  title: string | null;
  status: string | null;
  updated_at: string | null;
};

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function logSystemEvent(taskId: string, summary: string, metadata: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO events (id, type, task_id, message, metadata, created_at)
     VALUES (lower(hex(randomblob(16))), 'system', NULL, ?, ?, ?)`,
    [summary, JSON.stringify({ swarm_task_id: taskId, source: 'nuke-zombie-execution', ...metadata }), now]
  );
}

function main() {
  const cutoff = isoHoursAgo(1);
  const now = new Date().toISOString();

  const zombies = queryAll<ZombieTask>(
    `SELECT task_id, title, status, updated_at
     FROM swarm_tasks
     WHERE lower(COALESCE(status, '')) = 'in_execution'
       AND datetime(updated_at) <= datetime(?)
     ORDER BY updated_at ASC`,
    [cutoff]
  );

  if (zombies.length === 0) {
    console.log('[nuke-zombie-execution] no stale in_execution tasks found (>= 1h).');
    return;
  }

  let taskFailedCount = 0;
  let runFailedCount = 0;

  for (const z of zombies) {
    run(
      `UPDATE swarm_tasks
       SET status = 'failed', updated_at = ?
       WHERE task_id = ?`,
      [now, z.task_id]
    );
    taskFailedCount += 1;

    const beforeRunCount = queryAll<{ c: number }>(
      `SELECT COUNT(*) as c
       FROM swarm_runs
       WHERE task_id = ?
         AND lower(COALESCE(run_status, '')) IN ('queued','pending','running','in_progress','in_execution')`,
      [z.task_id]
    )[0]?.c || 0;

    run(
      `UPDATE swarm_runs
       SET run_status = 'failed',
           ended_at = COALESCE(ended_at, ?),
           error_message = COALESCE(error_message, 'System Timeout: zombie in_execution task cleaned by nuke script')
       WHERE task_id = ?
         AND lower(COALESCE(run_status, '')) IN ('queued','pending','running','in_progress','in_execution')`,
      [now, z.task_id]
    );

    runFailedCount += beforeRunCount;

    logSystemEvent(
      z.task_id,
      `[ZOMBIE_CLEANUP] task forced to failed after >=1h in_execution | task=${z.task_id} | title=${z.title || '-'} | runs_failed=${beforeRunCount}`,
      { title: z.title, previous_status: z.status, previous_updated_at: z.updated_at, runs_failed: beforeRunCount }
    );

    console.log(`[nuke-zombie-execution] cleaned task=${z.task_id} title="${z.title || '-'}" runs_failed=${beforeRunCount}`);
  }

  console.log(`[nuke-zombie-execution] done. tasks_failed=${taskFailedCount}, runs_failed=${runFailedCount}`);
}

main();
