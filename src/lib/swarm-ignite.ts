import { getMissionControlUrl } from '@/lib/config';
import { run, queryAll, queryOne } from '@/lib/db';

export function canTriggerSynthesis(parentTaskId: string): boolean {
  const childStatuses = queryAll<{ status: string }>(
    `SELECT status FROM swarm_tasks WHERE parent_task_id = ?`,
    [parentTaskId]
  ).map((r) => (r.status || '').toLowerCase());

  const hasBlocked = childStatuses.some((s) =>
    ['needs_update', 'blocked', 'failed', 'needs-rework', 'blocked_review', 'review', 'retry'].includes(s)
  );
  if (hasBlocked) {
    return false;
  }

  const badStatus = childStatuses.some((s) => ['needs_update', 'blocked', 'failed'].includes(s));
  if (badStatus) return false;

  const reviewerRecords = queryAll<{ payload: string | null }>(
    `SELECT payload
     FROM swarm_insights
     WHERE parent_task_id = ?
       AND payload IS NOT NULL`,
    [parentTaskId]
  );

  let latestVerdict: string | null = null;
  for (const row of reviewerRecords) {
    if (!row.payload) continue;
    try {
      const parsed = JSON.parse(row.payload);
      const verdict = typeof parsed.verdict === 'string' ? parsed.verdict.toUpperCase() : '';
      if (['APPROVE', 'NEEDS_REVISION', 'BLOCK'].includes(verdict)) {
        latestVerdict = verdict;
      }
    } catch {
      // Ignore malformed payloads.
    }
  }

  if (!latestVerdict) return false;
  return latestVerdict === 'APPROVE';
}

export async function igniteTaskOrchestration(taskId: string, source: string): Promise<void> {
  const baseUrl = getMissionControlUrl().replace(/\/$/, '');

  try {
    const res = await fetch(`${baseUrl}/api/swarm/tasks/${taskId}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      run(
        `INSERT INTO events (id, type, task_id, message, metadata, created_at)
         VALUES (lower(hex(randomblob(16))), 'system', NULL, ?, ?, datetime('now'))`,
        [
          `[AUTO_IGNITION_FAILED] ${source} -> ${taskId}`,
          JSON.stringify({ task_id: taskId, source, status: res.status, body }),
        ]
      );
      return;
    }

    run(
      `INSERT INTO events (id, type, task_id, message, metadata, created_at)
       VALUES (lower(hex(randomblob(16))), 'system', NULL, ?, ?, datetime('now'))`,
      [
        `[AUTO_IGNITION_OK] ${source} -> ${taskId}`,
        JSON.stringify({ task_id: taskId, source }),
      ]
    );
  } catch (error) {
    run(
      `INSERT INTO events (id, type, task_id, message, metadata, created_at)
       VALUES (lower(hex(randomblob(16))), 'system', NULL, ?, ?, datetime('now'))`,
      [
        `[AUTO_IGNITION_ERROR] ${source} -> ${taskId}`,
        JSON.stringify({ task_id: taskId, source, error: String(error) }),
      ]
    );
  }
}
