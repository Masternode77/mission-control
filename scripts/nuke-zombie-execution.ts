import { queryAll, run } from '@/lib/db';
import { sendTelegramMessage } from '@/lib/telegram';

type ZombieTask = {
  task_id: string;
  title: string | null;
  status: string | null;
  updated_at: string | null;
};

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function getArgValue(name: string, fallback: string) {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  const token = process.argv[idx];
  if (token.includes('=')) return token.split('=').slice(1).join('=');
  return process.argv[idx + 1] || fallback;
}

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

async function notifyTelegram(text: string) {
  try {
    const res = await sendTelegramMessage({
      text,
      chatId: process.env.TELEGRAM_MASTER_CHAT_ID,
    });

    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : 'no_response';
      console.error(`[nuke-zombie-execution] telegram notify failed status=${res?.status || 'null'} body=${body}`);
      return false;
    }

    return true;
  } catch (e) {
    console.error(`[nuke-zombie-execution] telegram notify exception: ${String(e)}`);
    return false;
  }
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const hours = Number(getArgValue('--hours', '1'));
  const mode = getArgValue('--mode', 'failed').toLowerCase(); // failed | archived
  const targetStatus = mode === 'archived' ? 'archived' : 'failed';

  const cutoff = isoHoursAgo(hours);
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
    console.log(`[nuke-zombie-execution] no stale in_execution tasks found (>= ${hours}h). dryRun=${dryRun}`);
    return;
  }

  const summaryLines = zombies.map((z) => `- ${z.task_id} | ${z.title || '-'} | updated_at=${z.updated_at || '-'}`);
  console.log(`[nuke-zombie-execution] candidates=${zombies.length} dryRun=${dryRun} mode=${targetStatus}`);
  summaryLines.forEach((l) => console.log(l));

  if (dryRun) {
    await notifyTelegram(
      [
        '🧪 [DRY-RUN] Zombie IN_EXECUTION scan',
        `- cutoff: >= ${hours}h`,
        `- candidates: ${zombies.length}`,
        ...summaryLines.slice(0, 20),
      ].join('\n')
    );
    return;
  }

  let taskChanged = 0;
  let runChanged = 0;

  for (const z of zombies) {
    run(
      `UPDATE swarm_tasks
       SET status = ?, updated_at = ?
       WHERE task_id = ?`,
      [targetStatus, now, z.task_id]
    );
    taskChanged += 1;

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

    runChanged += beforeRunCount;

    const evt = `[ZOMBIE_CLEANUP] task => ${targetStatus} | task=${z.task_id} | title=${z.title || '-'} | runs_failed=${beforeRunCount}`;
    logSystemEvent(z.task_id, evt, {
      title: z.title,
      previous_status: z.status,
      previous_updated_at: z.updated_at,
      target_status: targetStatus,
      runs_failed: beforeRunCount,
      hours_cutoff: hours,
    });

    console.log(`[nuke-zombie-execution] cleaned task=${z.task_id} -> ${targetStatus} runs_failed=${beforeRunCount}`);
  }

  const finalMsg = [
    '🚨 [Zombie Cleanup Executed]',
    `- mode: ${targetStatus}`,
    `- cutoff: >= ${hours}h`,
    `- tasks_changed: ${taskChanged}`,
    `- runs_failed: ${runChanged}`,
    `- time: ${now}`,
  ].join('\n');

  await notifyTelegram(finalMsg);
  console.log(`[nuke-zombie-execution] done. tasks_changed=${taskChanged}, runs_failed=${runChanged}`);
}

main().catch((e) => {
  console.error('[nuke-zombie-execution] fatal:', e);
  process.exit(1);
});
