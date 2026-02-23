import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

type OrphanedRun = {
  run_id: string;
  task_id: string;
  run_status: string;
  task_status: string;
};

type CandidateTask = {
  task_id: string;
  title: string;
  status: string;
};

const hasApply = process.argv.includes('--apply');
const dryRun = !hasApply; // default safe mode

function nowIso() {
  return new Date().toISOString();
}

function findOrphanedRuns(): OrphanedRun[] {
  return db
    .prepare(
      `SELECT
         sr.run_id,
         sr.task_id,
         sr.run_status,
         st.status AS task_status
       FROM swarm_runs sr
       JOIN swarm_tasks st ON st.task_id = sr.task_id
       WHERE lower(COALESCE(st.status, '')) IN ('completed','failed','archived')
         AND lower(COALESCE(sr.run_status, '')) IN ('queued','pending','running','in_progress','in_execution')
       ORDER BY datetime(COALESCE(sr.started_at, sr.created_at)) DESC`
    )
    .all() as OrphanedRun[];
}

function findGhostApprovalTaskIds(): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT sa.task_id
       FROM swarm_approvals sa
       JOIN swarm_tasks st ON st.task_id = sa.task_id
       WHERE lower(COALESCE(sa.approval_status, '')) = 'pending'
         AND lower(COALESCE(st.status, '')) NOT IN ('hitl_review','review')`
    )
    .all() as Array<{ task_id: string }>;
  return rows.map((r) => r.task_id);
}

function findStalledTaskIds(hours = 24): string[] {
  const rows = db
    .prepare(
      `SELECT task_id
       FROM swarm_tasks
       WHERE lower(COALESCE(status, '')) NOT IN ('completed','failed','archived')
         AND datetime(COALESCE(updated_at, created_at)) <= datetime('now', ?)`
    )
    .all(`-${hours} hours`) as Array<{ task_id: string }>;
  return rows.map((r) => r.task_id);
}

function getTaskRows(taskIds: string[]): CandidateTask[] {
  if (!taskIds.length) return [];
  const placeholders = taskIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT task_id, title, status
       FROM swarm_tasks
       WHERE task_id IN (${placeholders})
       ORDER BY datetime(updated_at) ASC`
    )
    .all(...taskIds) as CandidateTask[];
}

function safeArchive(taskIds: string[], reason: string) {
  const runUpdate = db.prepare(
    `UPDATE swarm_runs
     SET run_status = 'failed',
         ended_at = COALESCE(ended_at, ?),
         error_message = COALESCE(error_message, ?)
     WHERE task_id = ?
       AND lower(COALESCE(run_status, '')) IN ('queued','pending','running','in_progress','in_execution')`
  );

  const taskArchive = db.prepare(
    `UPDATE swarm_tasks
     SET status = 'archived', updated_at = ?
     WHERE task_id = ?
       AND lower(COALESCE(status, '')) NOT IN ('archived')`
  );

  const eventInsert = db.prepare(
    `INSERT INTO events (id, type, task_id, message, metadata, created_at)
     VALUES (lower(hex(randomblob(16))), 'system', NULL, ?, ?, ?)`
  );

  const tx = db.transaction((ids: string[]) => {
    let runsFailed = 0;
    let tasksArchived = 0;
    const ts = nowIso();

    for (const taskId of ids) {
      const r = runUpdate.run(ts, `Soft-archived by safe-archive-zombies: ${reason}`, taskId);
      const t = taskArchive.run(ts, taskId);
      runsFailed += Number(r.changes || 0);
      tasksArchived += Number(t.changes || 0);

      eventInsert.run(
        `[SAFE_ARCHIVE] task=${taskId} | reason=${reason} | runs_failed=${r.changes || 0} | task_archived=${t.changes || 0}`,
        JSON.stringify({ source: 'safe-archive-zombies', task_id: taskId, reason, runs_failed: r.changes || 0, task_archived: t.changes || 0 }),
        ts
      );
    }

    return { runsFailed, tasksArchived };
  });

  return tx(taskIds);
}

function main() {
  const orphanedRuns = findOrphanedRuns();
  const ghostApprovalTaskIds = findGhostApprovalTaskIds();
  const stalledTaskIds = findStalledTaskIds(24);

  const candidateTaskIds = Array.from(
    new Set([
      ...orphanedRuns.map((r) => r.task_id),
      ...ghostApprovalTaskIds,
      ...stalledTaskIds,
    ])
  );

  const candidateTasks = getTaskRows(candidateTaskIds);

  console.log('\n[SAFE-ARCHIVE-ZOMBIES]');
  console.log(`mode=${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`db=${DB_PATH}`);
  console.log(`generated_at=${nowIso()}`);

  console.log('\n- Orphaned Runs:', orphanedRuns.length);
  if (orphanedRuns.length) console.table(orphanedRuns);

  console.log('\n- Ghost Approval Task IDs:', ghostApprovalTaskIds.length);
  if (ghostApprovalTaskIds.length) console.table(ghostApprovalTaskIds.map((task_id) => ({ task_id })));

  console.log('\n- Stalled Task IDs (>24h):', stalledTaskIds.length);
  if (stalledTaskIds.length) console.table(stalledTaskIds.map((task_id) => ({ task_id })));

  console.log('\n- Candidate Tasks to archive:', candidateTasks.length);
  if (candidateTasks.length) console.table(candidateTasks);

  if (dryRun) {
    console.log('\nDRY-RUN active. No data was modified.');
    console.log('To apply safely: npx tsx scripts/safe-archive-zombies.ts --apply');
    return;
  }

  if (!candidateTaskIds.length) {
    console.log('\nNo candidates. Nothing to archive.');
    return;
  }

  const result = safeArchive(candidateTaskIds, 'orphaned-run/ghost-approval/stalled-task');
  console.log('\nAPPLY complete:', result);
}

try {
  main();
} finally {
  db.close();
}
