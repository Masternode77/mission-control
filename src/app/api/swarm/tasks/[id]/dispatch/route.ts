import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { queryOne, run } from '@/lib/db';
import { applyRevisionInjection } from '@/lib/revision-injection';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const forcedRoleId = typeof body.targetRoleId === 'string' && body.targetRoleId.trim() ? body.targetRoleId.trim() : null;
    const now = new Date().toISOString();

    const task = queryOne<{ task_id: string; title: string; objective: string | null; owner_role_id: string | null }>(
      'SELECT task_id, title, objective, owner_role_id FROM swarm_tasks WHERE task_id = ?',
      [id]
    );
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const targetRole = forcedRoleId || task.owner_role_id || 'dc_tech_financial_modeler';
    const basePrompt = `Task: ${task.title}\nObjective: ${task.objective || '-'}\n\nProvide revised output in markdown.`;
    const { prompt: injectedPrompt, injection } = applyRevisionInjection(id, basePrompt);

    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    const roleRow = queryOne<{ role_id: string; default_agent_id: string | null }>(
      'SELECT role_id, default_agent_id FROM agent_roles WHERE role_id = ?',
      [targetRole]
    );
    const targetAgent = roleRow?.default_agent_id || targetRole;
    const sessionKey = `agent:main:${targetAgent}`;

    await client.call('chat.send', {
      sessionKey,
      message: injectedPrompt,
      idempotencyKey: `swarm-dispatch-${id}-${Date.now()}`,
    });

    run('UPDATE swarm_tasks SET status = ?, owner_role_id = ?, updated_at = ? WHERE task_id = ?', [
      'in_execution',
      targetRole,
      now,
      id,
    ]);

    const runId = uuidv4();
    run(
      `INSERT INTO swarm_runs (run_id, task_id, role_id, run_status, started_at, output_summary, created_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      [runId, id, targetRole, now, injectedPrompt, now]
    );

    run(
      `INSERT INTO swarm_handoffs (handoff_id, from_role_id, to_role_id, task_id, handoff_type, created_at)
       VALUES (?, 'MC-MAIN', ?, ?, ?, ?)`,
      [uuidv4(), targetRole, id, injection.isRework ? 'rework' : 'delegate', now]
    );

    run(
      `INSERT INTO events (id, type, task_id, message, metadata, created_at)
       VALUES (?, 'task_assigned', NULL, ?, ?, ?)`,
      [
        uuidv4(),
        `[DISPATCH] ${id} sent to ${targetRole}`,
        JSON.stringify({ task_id: id, role_id: targetRole, injected_prompt: injectedPrompt, is_rework: injection.isRework }),
        now,
      ]
    );

    broadcast({ type: 'event_logged', payload: { taskId: id, sessionId: runId, summary: 'swarm_dispatched' } });

    return NextResponse.json({
      ok: true,
      task_id: id,
      role_id: targetRole,
      status: 'in_execution',
      is_rework: injection.isRework,
      injected_prompt: injectedPrompt,
      run_id: runId,
    });
  } catch (error) {
    console.error('Failed to dispatch swarm task:', error);
    return NextResponse.json({ error: 'Failed to dispatch swarm task' }, { status: 500 });
  }
}
