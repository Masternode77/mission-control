import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { queryOne, run } from '@/lib/db';
import { executeSwarmRunAsync } from '@/lib/swarm-executor';

type RouteDecision = {
  target_agent_id: string;
  sub_prompt: string;
};

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function heuristicRoute(title: string, objective: string | null): RouteDecision {
  const text = `${title}\n${objective || ''}`.toLowerCase();

  if (/cpi|fomc|inflation|macro|금리|환율|거시/.test(text)) {
    return {
      target_agent_id: 'shared_planner_architect',
      sub_prompt: `Analyze this macro task with scenario framework and execution checklist.\nTask: ${title}\nObjective: ${objective || '-'}`,
    };
  }

  if (/pricing|competitor|supply|pipeline|rfp/.test(text)) {
    return {
      target_agent_id: 'dc_deep_researcher',
      sub_prompt: `Produce competitor/supply intelligence and decision-grade summary.\nTask: ${title}\nObjective: ${objective || '-'}`,
    };
  }

  return {
    target_agent_id: 'dc_strategy_analyst',
    sub_prompt: `Create strategy brief with risks, options, and next actions.\nTask: ${title}\nObjective: ${objective || '-'}`,
  };
}

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const now = new Date().toISOString();

    const task = queryOne<{ task_id: string; title: string; objective: string | null }>(
      'SELECT task_id, title, objective FROM swarm_tasks WHERE task_id = ?',
      [id]
    );
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    run(`UPDATE swarm_tasks SET status = 'orchestrating', owner_role_id = 'MC-MAIN', updated_at = ? WHERE task_id = ?`, [now, id]);
    broadcast({ type: 'event_logged', payload: { taskId: id, sessionId: id, summary: 'task_orchestrating_started' } });

    const client = getOpenClawClient();
    let mcSendOk = false;

    try {
      if (!client.isConnected()) await client.connect();
      await client.call('chat.send', {
        sessionKey: 'agent:main:MC-MAIN',
        message: `You are MC-MAIN. Return strict JSON: {\"target_agent_id\":\"...\",\"sub_prompt\":\"...\"}. Task: ${task.title}. Objective: ${task.objective || '-'}`,
        idempotencyKey: `swarm-orchestrate-monica-${id}-${Date.now()}`,
      });
      mcSendOk = true;
    } catch {
      // continue with deterministic fallback routing
    }

    const decision = heuristicRoute(task.title, task.objective);
    const targetExists = queryOne<{ role_id: string }>('SELECT role_id FROM agent_roles WHERE role_id = ?', [decision.target_agent_id]);
    const targetRole = targetExists ? decision.target_agent_id : 'shared_planner_architect';
    const subPrompt = decision.sub_prompt;

    run(
      `UPDATE swarm_tasks
       SET owner_role_id = ?, status = 'in_execution', updated_at = ?
       WHERE task_id = ?`,
      [targetRole, new Date().toISOString(), id]
    );

    const runId = uuidv4();
    const runAt = new Date().toISOString();
    const sessionKey = `agent:main:${targetRole}`;

    run(
      `INSERT INTO swarm_runs (run_id, task_id, role_id, session_key, run_status, started_at, output_summary, created_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      [runId, id, targetRole, sessionKey, runAt, subPrompt, runAt]
    );

    run(
      `INSERT INTO swarm_handoffs (handoff_id, from_role_id, to_role_id, task_id, handoff_type, created_at)
       VALUES (?, 'MC-MAIN', ?, ?, 'delegate', ?)`,
      [uuidv4(), targetRole, id, runAt]
    );

    void executeSwarmRunAsync({
      taskId: id,
      runId,
      roleId: targetRole,
      sessionKey,
      taskTitle: task.title,
      objective: task.objective,
      subPrompt,
    });

    broadcast({ type: 'event_logged', payload: { taskId: id, sessionId: runId, summary: `task_routed:${targetRole}` } });
    broadcast({ type: 'task_updated', payload: { id, status: 'in_execution' } as any });

    return NextResponse.json({
      ok: true,
      task_id: id,
      status: 'in_execution',
      owner_role_id: targetRole,
      route: { target_agent_id: targetRole, sub_prompt: subPrompt },
      run_id: runId,
      mc_send_ok: mcSendOk,
      async_executor: true,
    });
  } catch (error) {
    console.error('Failed to orchestrate task:', error);
    return NextResponse.json({ error: 'Failed to orchestrate task' }, { status: 500 });
  }
}
