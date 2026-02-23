import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from '@/lib/events';
import { queryOne, run } from '@/lib/db';
import { applyRevisionInjection } from '@/lib/revision-injection';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const now = new Date().toISOString();

    const task = queryOne<{ task_id: string; title: string; objective: string | null }>(
      'SELECT task_id, title, objective FROM swarm_tasks WHERE task_id = ?',
      [id]
    );
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const basePrompt = `Task: ${task.title}\nObjective: ${task.objective || '-'}\n`;
    const { prompt: injectedPrompt } = applyRevisionInjection(id, basePrompt);

    run('UPDATE swarm_tasks SET status = ?, owner_role_id = ?, updated_at = ? WHERE task_id = ?', [
      'in_execution',
      'dc_tech_financial_modeler',
      now,
      id,
    ]);

    const runId = uuidv4();
    run(
      `INSERT INTO swarm_runs (run_id, task_id, role_id, run_status, started_at, output_summary, created_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      [runId, id, 'dc_tech_financial_modeler', now, injectedPrompt, now]
    );

    run(
      `INSERT INTO swarm_handoffs (handoff_id, from_role_id, to_role_id, task_id, handoff_type, created_at)
       VALUES (?, 'MC-MAIN', 'dc_tech_financial_modeler', ?, 'rework', ?)`,
      [uuidv4(), id, now]
    );

    run(
      `INSERT INTO events (id, type, task_id, message, metadata, created_at)
       VALUES (?, 'task_assigned', NULL, ?, ?, ?)`,
      [
        uuidv4(),
        `[REWORK DISPATCH] ${id} reassigned to dc_tech_financial_modeler`,
        JSON.stringify({ task_id: id, role_id: 'dc_tech_financial_modeler', injected_prompt: injectedPrompt }),
        now,
      ]
    );

    broadcast({ type: 'event_logged', payload: { taskId: id, sessionId: runId, summary: 'rework_dispatched' } });

    return NextResponse.json({
      ok: true,
      task_id: id,
      status: 'in_execution',
      role_id: 'dc_tech_financial_modeler',
      injected_prompt: injectedPrompt,
      run_id: runId,
    });
  } catch (error) {
    console.error('Failed to simulate rework dispatch:', error);
    return NextResponse.json({ error: 'Failed to simulate rework dispatch' }, { status: 500 });
  }
}
