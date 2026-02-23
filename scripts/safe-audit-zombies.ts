import { queryAll } from '@/lib/db';

type OrphanedRun = {
  run_id: string;
  task_id: string;
  run_status: string;
  task_status: string;
  started_at: string | null;
  ended_at: string | null;
};

type GhostApproval = {
  approval_id: string;
  task_id: string;
  approval_status: string;
  gate_reason: string | null;
  requested_at: string | null;
  task_status: string;
};

type StalledTask = {
  task_id: string;
  title: string;
  status: string;
  updated_at: string | null;
  created_at: string | null;
};

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function main() {
  // 1) Orphaned Runs: parent task terminal but run still active/pending
  const orphanedRuns = queryAll<OrphanedRun>(
    `SELECT
       sr.run_id,
       sr.task_id,
       sr.run_status,
       st.status AS task_status,
       sr.started_at,
       sr.ended_at
     FROM swarm_runs sr
     JOIN swarm_tasks st ON st.task_id = sr.task_id
     WHERE lower(COALESCE(st.status, '')) IN ('completed','failed','archived')
       AND lower(COALESCE(sr.run_status, '')) IN ('queued','pending','running','in_progress','in_execution')
     ORDER BY datetime(COALESCE(sr.started_at, sr.created_at)) DESC`
  );

  // 2) Ghost Approvals: task not in review stage but approval pending
  const ghostApprovals = queryAll<GhostApproval>(
    `SELECT
       sa.approval_id,
       sa.task_id,
       sa.approval_status,
       sa.gate_reason,
       sa.requested_at,
       st.status AS task_status
     FROM swarm_approvals sa
     JOIN swarm_tasks st ON st.task_id = sa.task_id
     WHERE lower(COALESCE(sa.approval_status, '')) = 'pending'
       AND lower(COALESCE(st.status, '')) NOT IN ('hitl_review','review')
     ORDER BY datetime(sa.requested_at) DESC`
  );

  // 3) Stalled Tasks: not terminal and stale for >24h
  const stalledTasks = queryAll<StalledTask>(
    `SELECT
       task_id,
       title,
       status,
       updated_at,
       created_at
     FROM swarm_tasks
     WHERE lower(COALESCE(status, '')) NOT IN ('completed','failed','archived')
       AND datetime(COALESCE(updated_at, created_at)) <= datetime('now', '-24 hours')
     ORDER BY datetime(COALESCE(updated_at, created_at)) ASC`
  );

  console.log('\n[SAFE READ-ONLY AUDIT REPORT]');
  console.log(`Generated at: ${new Date().toISOString()}`);

  section(`1) Orphaned Runs (count=${orphanedRuns.length})`);
  if (orphanedRuns.length) console.table(orphanedRuns);
  else console.log('No orphaned runs found.');

  section(`2) Ghost Approvals (count=${ghostApprovals.length})`);
  if (ghostApprovals.length) console.table(ghostApprovals);
  else console.log('No ghost approvals found.');

  section(`3) Stalled Tasks >24h (count=${stalledTasks.length})`);
  if (stalledTasks.length) console.table(stalledTasks);
  else console.log('No stalled tasks found.');

  console.log('\n[SUMMARY]');
  console.log(JSON.stringify({
    orphanedRuns: orphanedRuns.length,
    ghostApprovals: ghostApprovals.length,
    stalledTasks: stalledTasks.length,
  }, null, 2));
}

main();
