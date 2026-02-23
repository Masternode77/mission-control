import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from '@/lib/events';
import { queryOne, queryAll, run } from '@/lib/db';
import { normalizeSwarmPipelineStatus } from '@/lib/swarm-status';
import { canTriggerSynthesis, igniteTaskOrchestration } from '@/lib/swarm-ignite';

export const dynamic = 'force-dynamic';

type TaskRow = {
  task_id: string;
  title: string;
  objective: string | null;
  status: string;
  priority: string;
  ws: string;
  owner_role_id: string | null;
  owner_display_name: string | null;
  created_at: string;
  updated_at: string;
  parent_task_id?: string | null;
};

type ChildCompletionRow = {
  total_count: number;
  completed_count: number;
};

type ChildPayloadRow = {
  task_id: string;
  title: string;
  objective: string | null;
  status: string;
  owner_role_id: string | null;
  execution_order: number | null;
  context_payload: string | null;
  updated_at: string;
};

function mapPriority(priority: string): 'low' | 'normal' | 'high' | 'urgent' {
  const p = (priority || '').toUpperCase();
  if (p === 'P0' || p === 'URGENT') return 'urgent';
  if (p === 'P1' || p === 'HIGH') return 'high';
  if (p === 'P3' || p === 'LOW') return 'low';
  return 'normal';
}

function toResponse(row: TaskRow) {
  return {
    id: row.task_id,
    title: row.title,
    description: row.objective || undefined,
    status: normalizeSwarmPipelineStatus(row.status),
    swarm_status: row.status,
    priority: mapPriority(row.priority),
    ws: row.ws,
    workspace_id: row.ws,
    parent_task_id: row.parent_task_id || undefined,
    owner_role_id: row.owner_role_id || 'MC-MAIN',
    assigned_agent: row.owner_role_id
      ? {
          id: row.owner_role_id,
          name: row.owner_display_name || row.owner_role_id,
          avatar_emoji: '🧠',
        }
      : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function failRunsForTerminalTask(taskId: string, now: string) {
  run(
    `UPDATE swarm_runs
     SET run_status = CASE WHEN run_status = 'completed' THEN 'completed' ELSE 'failed' END,
         ended_at = COALESCE(ended_at, ?),
         error_message = CASE
           WHEN run_status = 'completed' THEN error_message
           WHEN error_message IS NULL OR error_message = '' THEN 'Parent task moved to terminal state'
           ELSE error_message
         END
     WHERE task_id = ?`,
    [now, taskId]
  );
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

function tryParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function triggerParentSynthesisIfReady(completedTaskId: string, now: string) {
  const row = queryOne<{ parent_task_id: string | null; ws: string }>(
    'SELECT parent_task_id, ws FROM swarm_tasks WHERE task_id = ?',
    [completedTaskId]
  );

  const parentTaskId = row?.parent_task_id || null;
  if (!parentTaskId) return;

  const counts = queryOne<ChildCompletionRow>(
    `SELECT
      COUNT(*) as total_count,
      SUM(CASE WHEN lower(COALESCE(status, '')) IN ('completed', 'done', 'accepted', 'resolved') THEN 1 ELSE 0 END) as completed_count
     FROM swarm_tasks
     WHERE parent_task_id = ?`,
    [parentTaskId]
  );

  const total = Number(counts?.total_count || 0);
  const completed = Number(counts?.completed_count || 0);
  if (total === 0 || completed < total) return;

  if (!canTriggerSynthesis(parentTaskId)) return;

  const existing = queryOne<{ task_id: string }>(
    `SELECT task_id
     FROM swarm_tasks
     WHERE parent_task_id = ?
       AND title = 'Synthesis & Final Report'
       AND lower(COALESCE(origin_type, '')) = 'synthesis'
     ORDER BY created_at DESC
     LIMIT 1`,
    [parentTaskId]
  );

  if (existing?.task_id) return;

  const children = queryAll<ChildPayloadRow>(
    `SELECT task_id, title, objective, status, owner_role_id, execution_order, context_payload, updated_at
     FROM swarm_tasks
     WHERE parent_task_id = ?
     ORDER BY COALESCE(execution_order, 0) ASC, updated_at ASC`,
    [parentTaskId]
  );

  const mergedRelay = children.map((c) => ({
    task_id: c.task_id,
    title: c.title,
    objective: c.objective,
    status: c.status,
    owner_role_id: c.owner_role_id,
    execution_order: Number(c.execution_order || 0),
    updated_at: c.updated_at,
    context_payload: tryParseJson(c.context_payload),
  }));

  const synthesisTaskId = uuidv4();
  const contextPayload = JSON.stringify({
    type: 'fan_in_synthesis',
    parent_task_id: parentTaskId,
    source_subtasks: mergedRelay,
    generated_at: now,
  });

  run(
    `INSERT INTO swarm_tasks (
      task_id, parent_task_id, ws, title, objective, owner_role_id, priority, status,
      origin_type, execution_order, context_payload, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      synthesisTaskId,
      parentTaskId,
      row?.ws || 'default',
      'Synthesis & Final Report',
      'All sibling subtasks are completed. Synthesize child outputs into a final report.',
      'MC-MAIN',
      'P1',
      'orchestrating',
      'synthesis',
      999,
      contextPayload,
      'MC-MAIN',
      now,
      now,
    ]
  );

  run(
    `INSERT INTO swarm_handoffs (handoff_id, from_role_id, to_role_id, task_id, handoff_type, created_at)
     VALUES (?, 'MC-MAIN', 'MC-MAIN', ?, 'synthesis', ?)`,
    [uuidv4(), synthesisTaskId, now]
  );

  broadcast({
    type: 'task_created',
    payload: {
      id: synthesisTaskId,
      task_id: synthesisTaskId,
      parent_task_id: parentTaskId,
      title: 'Synthesis & Final Report',
      status: 'orchestrating',
      ws: row?.ws || 'default',
    } as any,
  });

  broadcast({
    type: 'event_logged',
    payload: {
      taskId: synthesisTaskId,
      sessionId: synthesisTaskId,
      summary: 'synthesis_task_auto_created',
    },
  });

  void igniteTaskOrchestration(synthesisTaskId, 'phase3-fanin-synthesis');
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const row = queryOne<TaskRow>(
      `SELECT st.task_id, st.title, st.objective, st.status, st.priority, st.ws, st.parent_task_id, st.owner_role_id,
              ar.display_name AS owner_display_name, st.created_at, st.updated_at
       FROM swarm_tasks st
       LEFT JOIN agent_roles ar ON ar.role_id = st.owner_role_id
       WHERE st.task_id = ?`,
      [id]
    );

    if (!row) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json(toResponse(row));
  } catch (error) {
    console.error('Failed to get swarm task:', error);
    return NextResponse.json({ error: 'Failed to get swarm task' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const rawStatus = String(body.status || 'intake').toLowerCase();
    const nextStatus = normalizeSwarmPipelineStatus(body.status || 'intake');
    const now = new Date().toISOString();

    const title = typeof body.title === 'string' ? body.title.trim() : undefined;
    const objective = typeof body.description === 'string' ? body.description : (typeof body.objective === 'string' ? body.objective : undefined);
    const ownerRoleId = typeof body.owner_role_id === 'string' ? body.owner_role_id : undefined;

    run(
      `UPDATE swarm_tasks
       SET status = ?,
           title = COALESCE(?, title),
           objective = COALESCE(?, objective),
           owner_role_id = COALESCE(?, owner_role_id),
           updated_at = ?
       WHERE task_id = ?`,
      [nextStatus, title ?? null, objective ?? null, ownerRoleId ?? null, now, id]
    );

    if (nextStatus === 'completed') {
      finalizeRunsForCompletedTask(id, now);
      await triggerParentSynthesisIfReady(id, now);
    }

    if (rawStatus === 'failed') {
      failRunsForTerminalTask(id, now);
    }

    broadcast({ type: 'task_updated', payload: { id, status: nextStatus } as any });
    broadcast({ type: 'event_logged', payload: { taskId: id, sessionId: id, summary: 'task_status_changed' } });

    return NextResponse.json({ ok: true, task_id: id, status: nextStatus });
  } catch (error) {
    console.error('Failed to patch swarm task:', error);
    return NextResponse.json({ error: 'Failed to patch swarm task' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    run('DELETE FROM swarm_handoffs WHERE task_id = ?', [id]);
    run('DELETE FROM swarm_approvals WHERE task_id = ?', [id]);
    run('DELETE FROM swarm_runs WHERE task_id = ?', [id]);
    const result = run('DELETE FROM swarm_tasks WHERE task_id = ?', [id]);

    if (result.changes === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    broadcast({ type: 'task_deleted', payload: { id } });
    broadcast({ type: 'event_logged', payload: { taskId: id, sessionId: id, summary: 'task_deleted' } });

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error('Failed to delete swarm task:', error);
    return NextResponse.json({ error: 'Failed to delete swarm task' }, { status: 500 });
  }
}
