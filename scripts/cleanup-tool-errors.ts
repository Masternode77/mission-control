import { queryAll, run } from '@/lib/db';

type BadRun = { run_id: string; task_id: string; error_message: string | null };

function main() {
  const badRuns = queryAll<BadRun>(
    `SELECT run_id, task_id, error_message
     FROM swarm_runs
     WHERE lower(COALESCE(error_message, '')) LIKE '%unexpected property%tools%'`
  );

  if (badRuns.length === 0) {
    console.log('[cleanup-tool-errors] no matching error runs found');
    return;
  }

  const taskIds = Array.from(new Set(badRuns.map((r) => r.task_id).filter(Boolean)));
  const runIds = badRuns.map((r) => r.run_id);
  const now = new Date().toISOString();

  // 1) remove bad runs
  for (const rid of runIds) {
    run('DELETE FROM swarm_runs WHERE run_id = ?', [rid]);
  }

  // 2) reset related tasks so board is clean and re-runnable
  for (const tid of taskIds) {
    run(
      `UPDATE swarm_tasks
       SET status = 'intake', updated_at = ?
       WHERE task_id = ?`,
      [now, tid]
    );

    run(
      `DELETE FROM swarm_approvals WHERE task_id = ?`,
      [tid]
    );

    run(
      `INSERT INTO events (id, type, task_id, message, metadata, created_at)
       VALUES (lower(hex(randomblob(16))), 'system', NULL, ?, ?, ?)`,
      [
        '[CLEANUP] Reset tool-schema-error task to intake',
        JSON.stringify({ source: 'cleanup-tool-errors', task_id: tid }),
        now,
      ]
    );
  }

  console.log(`[cleanup-tool-errors] removed runs=${runIds.length}, reset tasks=${taskIds.length}`);
}

main();
