import { queryAll, run } from '@/lib/db';

type ZombieRow = {
  task_id: string;
  title: string;
  updated_at: string;
};

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function logZombieEvent(taskId: string, summary: string) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO events (id, type, task_id, message, metadata, created_at)
     VALUES (lower(hex(randomblob(16))), 'system', NULL, ?, ?, ?)`,
    [summary, JSON.stringify({ swarm_task_id: taskId, source: 'cleanup-zombies' }), now]
  );
}

function main() {
  const cutoff = hoursAgoIso(1);

  const zombies = queryAll<ZombieRow>(
    `SELECT task_id, title, updated_at
     FROM swarm_tasks
     WHERE status = 'in_execution'
       AND datetime(updated_at) <= datetime(?)
     ORDER BY updated_at ASC`,
    [cutoff]
  );

  if (zombies.length === 0) {
    console.log('[cleanup-zombies] no stale in_execution tasks found');
    return;
  }

  const now = new Date().toISOString();

  for (const z of zombies) {
    run(`UPDATE swarm_tasks SET status = 'failed', updated_at = ? WHERE task_id = ?`, [now, z.task_id]);
    run(
      `UPDATE swarm_runs
       SET run_status = 'failed', ended_at = COALESCE(ended_at, ?), error_message = COALESCE(error_message, ?)
       WHERE task_id = ? AND run_status IN ('queued','running','in_progress','pending')`,
      [now, 'System Timeout: Zombie process detected', z.task_id]
    );

    const summary = `System Timeout: Zombie process detected | task=${z.task_id} | title=${z.title}`;
    logZombieEvent(z.task_id, summary);
    console.log(`[cleanup-zombies] failed ${z.task_id} (${z.title})`);
  }

  console.log(`[cleanup-zombies] completed. cleaned=${zombies.length}`);
}

main();
