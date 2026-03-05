import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from '@/lib/events';
import { queryOne, run } from '@/lib/db';
import { executeSwarmRunAsync } from '@/lib/swarm-executor';
import { sendTaskStatusWebhooks } from '@/lib/webhook-notifier';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const note = String(body.note || '').trim();
    const reviewer = String(body.reviewer || 'human').trim();

    if (!note) {
      return NextResponse.json({ error: 'Revision note is required' }, { status: 400 });
    }

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

    const latestRun = queryOne<{ role_id: string | null; session_key: string | null }>(
      `SELECT role_id, session_key
       FROM swarm_runs
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [task.task_id]
    );

    const targetRole = String(latestRun?.role_id || task.owner_role_id || 'shared_planner_architect').trim();
    const sessionKey = String(latestRun?.session_key || `agent:main:${targetRole}`).trim();

    const now = new Date().toISOString();

    run(
      `UPDATE swarm_approvals
       SET approval_status = 'rejected', decided_at = ?, decided_by = ?, decision_note = ?
       WHERE approval_id = ?`,
      [now, reviewer, note, id]
    );

    run(
      `UPDATE swarm_tasks
       SET status = 'orchestrating', owner_role_id = ?, updated_at = ?
       WHERE task_id = ?`,
      [targetRole, now, task.task_id]
    );

    run(
      `INSERT INTO events (id, type, task_id, message, metadata, created_at)
       VALUES (?, 'task_status_changed', NULL, ?, ?, ?)`,
      [
        uuidv4(),
        `[HITL REJECT] ${task.task_id}: ${task.title} → ORCHESTRATING`,
        JSON.stringify({ task_id: task.task_id, revision_note: note, reviewer, status: 'orchestrating' }),
        now,
      ]
    );

    const reworkPrompt = `User rejected your previous draft. Reason: ${note}. Please fix this specific issue and generate the final markdown again.`;

    const runId = uuidv4();
    run(
      `INSERT INTO swarm_runs (run_id, task_id, role_id, session_key, run_status, started_at, output_summary, created_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      [runId, task.task_id, targetRole, sessionKey, now, reworkPrompt, now]
    );

    run(
      `INSERT INTO swarm_handoffs (handoff_id, from_role_id, to_role_id, task_id, handoff_type, created_at)
       VALUES (?, 'HITL_REVIEW', ?, ?, 'rework', ?)`,
      [uuidv4(), targetRole, task.task_id, now]
    );

    run(
      `UPDATE swarm_tasks
       SET status = 'in_execution', owner_role_id = ?, updated_at = ?
       WHERE task_id = ?`,
      [targetRole, new Date().toISOString(), task.task_id]
    );

    broadcast({
      type: 'event_logged',
      payload: {
        taskId: task.task_id,
        sessionId: runId,
        summary: `[REWORK_DISPATCH] ${targetRole} <= ${note}`,
      },
    });
    broadcast({ type: 'task_updated', payload: { id: task.task_id, status: 'in_execution' } as any });

    void sendTaskStatusWebhooks({
      taskId: task.task_id,
      title: task.title,
      status: 'in_execution',
      approvalId: id,
      reviewerNote: note,
      source: 'hitl_reject',
    });

    void executeSwarmRunAsync({
      taskId: task.task_id,
      runId,
      roleId: targetRole,
      sessionKey,
      taskTitle: task.title,
      objective: task.objective,
      subPrompt: reworkPrompt,
    });

    return NextResponse.json({
      ok: true,
      task_id: task.task_id,
      status: 'in_execution',
      role_id: targetRole,
      run_id: runId,
      rework_prompt: reworkPrompt,
    });
  } catch (error) {
    console.error('Failed to reject approval:', error);
    return NextResponse.json({ error: 'Failed to reject approval' }, { status: 500 });
  }
}
