import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from '@/lib/events';
import { queryOne, run } from '@/lib/db';

export const dynamic = 'force-dynamic';

function resolveMocPath(taskId: string) {
  if (taskId === 'MC-MAIN-240221-P01') {
    return '/Users/josh/.openclaw/workspace/memory/dc-insights/DC-FIN-240221-P01.md';
  }
  return `/Users/josh/.openclaw/workspace/memory/swarm-results/${taskId}.md`;
}

function finalizeRunsForCompletedTask(taskId: string, now: string) {
  run(
    `UPDATE swarm_runs
     SET run_status = 'completed',
         ended_at = COALESCE(ended_at, ?),
         error_message = CASE WHEN error_message = 'retry superseded' THEN NULL ELSE error_message END
     WHERE task_id = ? AND run_status != 'completed'`,
    [now, taskId]
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const approver = body.approver || 'human';
    const now = new Date().toISOString();

    const approval = queryOne<{ approval_id: string; task_id: string }>(
      'SELECT approval_id, task_id FROM swarm_approvals WHERE approval_id = ?',
      [id]
    );
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });

    const task = queryOne<{ task_id: string; title: string; objective: string | null; owner_role_id: string | null }>(
      'SELECT task_id, title, objective, owner_role_id FROM swarm_tasks WHERE task_id = ?',
      [approval.task_id]
    );
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    run(
      `UPDATE swarm_approvals
       SET approval_status = 'approved', decided_at = ?, decided_by = ?, decision_note = ?
       WHERE approval_id = ?`,
      [now, approver, 'Approved from HITL Zone', id]
    );

    run('UPDATE swarm_tasks SET status = ?, updated_at = ? WHERE task_id = ?', ['completed', now, task.task_id]);
    finalizeRunsForCompletedTask(task.task_id, now);

    const filePath = resolveMocPath(task.task_id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const md = `# ${task.title}\n\n- task_id: ${task.task_id}\n- status: COMPLETED\n- approved_by: ${approver}\n- approved_at: ${now}\n- owner_role: ${task.owner_role_id || 'unknown'}\n\n## Objective\n${task.objective || '-'}\n\n## Result Summary\nAgent execution completed and approved via HITL.\n`;
    fs.writeFileSync(filePath, md, 'utf8');

    run(
      `INSERT INTO events (id, type, task_id, message, created_at)
       VALUES (?, 'task_completed', NULL, ?, ?)`,
      [uuidv4(), `[HITL] ${task.task_id} approved and archived output: ${path.basename(filePath)}`, now]
    );

    broadcast({ type: 'event_logged', payload: { taskId: task.task_id, sessionId: id, summary: 'hitl_approved' } });

    return NextResponse.json({ ok: true, task_id: task.task_id, status: 'completed', file_path: filePath });
  } catch (error) {
    console.error('Failed to approve task:', error);
    return NextResponse.json({ error: 'Failed to approve task' }, { status: 500 });
  }
}
