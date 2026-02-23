import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { sendEmergencyHITLRequest } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ReviewPacketV1 = {
  version?: string;
  task_id: string;
  parent_task_id?: string;
  verdict: 'APPROVE' | 'NEEDS_REVISION' | 'BLOCK';
  top_issues?: unknown[];
  evidence_check?: unknown[];
  logic_check?: unknown[];
  numerical_check?: unknown[];
  missing_counterpoints?: string[];
  required_fixes?: string[];
  ways_wrong?: string[];
  affected_tasks?: string[];
  agent_id?: string;
  generated_at?: string;
};

function normalize(payload: unknown): ReviewPacketV1 | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;

  const taskId =
    typeof body.task_id === 'string'
      ? body.task_id.trim()
      : undefined;
  const verdict =
    typeof body.verdict === 'string'
      ? (body.verdict as string)
      : undefined;

  if (!taskId) return null;
  if (!verdict || !['APPROVE', 'NEEDS_REVISION', 'BLOCK'].includes(verdict)) return null;

  const parentTaskId =
    typeof body.parent_task_id === 'string' && body.parent_task_id.trim().length > 0
      ? body.parent_task_id.trim()
      : taskId;

  return {
    version: typeof body.version === 'string' ? body.version : 'v1',
    task_id: taskId,
    parent_task_id: parentTaskId,
    verdict: verdict as ReviewPacketV1['verdict'],
    top_issues: Array.isArray(body.top_issues) ? (body.top_issues as unknown[]) : [],
    evidence_check: Array.isArray(body.evidence_check) ? (body.evidence_check as unknown[]) : [],
    logic_check: Array.isArray(body.logic_check) ? (body.logic_check as unknown[]) : [],
    numerical_check: Array.isArray(body.numerical_check) ? (body.numerical_check as unknown[]) : [],
    missing_counterpoints: Array.isArray(body.missing_counterpoints)
      ? body.missing_counterpoints.filter((item): item is string => typeof item === 'string')
      : [],
    required_fixes: Array.isArray(body.required_fixes)
      ? body.required_fixes.filter((item): item is string => typeof item === 'string')
      : [],
    ways_wrong: Array.isArray(body.ways_wrong)
      ? body.ways_wrong.filter((item): item is string => typeof item === 'string')
      : [],
    affected_tasks: Array.isArray(body.affected_tasks)
      ? body.affected_tasks.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    agent_id: typeof body.agent_id === 'string' ? body.agent_id : undefined,
    generated_at: typeof body.generated_at === 'string' ? body.generated_at : new Date().toISOString(),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const packet = normalize(body);

    if (!packet) {
      return NextResponse.json({ error: 'Invalid review packet' }, { status: 400 });
    }

    const parentTaskId = packet.parent_task_id || packet.task_id;
    const parent = queryOne<{ task_id: string }>(
      'SELECT task_id FROM swarm_tasks WHERE task_id = ?',
      [parentTaskId]
    );
    if (!parent?.task_id) {
      return NextResponse.json({ error: `parent_task_id does not exist: ${parentTaskId}` }, { status: 400 });
    }

    const now = new Date().toISOString();
    const reviewId = uuidv4();

    run(
      `INSERT INTO swarm_insights (
         insight_id,
         parent_task_id,
         agent_id,
         status,
         claim,
         severity,
         impact,
         payload,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reviewId,
        parentTaskId,
        packet.agent_id || 'verifier',
        packet.verdict === 'APPROVE' ? 'done' : 'blocked',
        packet.verdict,
        packet.verdict === 'BLOCK' ? 'S3' : 'S2',
        'review_packet_v1',
        JSON.stringify(packet),
        now,
        now,
      ]
    );

    let affected = packet.affected_tasks || [];
    if (affected.length === 0) {
      const rows = queryAll<{ task_id: string }>(
        'SELECT task_id FROM swarm_tasks WHERE parent_task_id = ? ORDER BY execution_order ASC',
        [parentTaskId]
      );
      affected = rows.map((r) => r.task_id);
    }

    if (packet.verdict === 'NEEDS_REVISION') {
      for (const taskId of affected) {
        run(`UPDATE swarm_tasks SET status = 'needs_update', updated_at = ? WHERE task_id = ?`, [now, taskId]);
      }

      run(
        `INSERT INTO swarm_handoffs (
           handoff_id,
           from_role_id,
           to_role_id,
           task_id,
           handoff_type,
           created_at
         ) VALUES (?, 'system', 'MC-MAIN', ?, 'rework', ?)`,
        [uuidv4(), parentTaskId, now]
      );

      broadcast({
        type: 'task_updated',
        payload: {
          id: parentTaskId,
          status: 'needs_update',
          summary: '[VERIFIER] NEEDS_REVISION received, rework requested',
        } as any,
      });

      return NextResponse.json({ success: true, review_id: reviewId, action: 'needs_revision_dispatched' }, { status: 200 });
    }

    if (packet.verdict === 'BLOCK') {
      run(`UPDATE swarm_tasks SET status = 'blocked', updated_at = ? WHERE task_id = ?`, [now, parentTaskId]);
      run(
        `INSERT INTO swarm_handoffs (
           handoff_id,
           from_role_id,
           to_role_id,
           task_id,
           handoff_type,
           created_at
         ) VALUES (?, 'verifier', 'MC-MAIN', ?, 'block', ?)`,
        [uuidv4(), parentTaskId, now]
      );

      void sendEmergencyHITLRequest(parentTaskId, 'Verifier verdict BLOCK', {
        agent_id: packet.agent_id || 'verifier',
        verdict: packet.verdict,
        affected_tasks: packet.affected_tasks || [],
        review_id: reviewId,
      });

      broadcast({
        type: 'task_updated',
        payload: {
          id: parentTaskId,
          status: 'blocked',
          summary: '[VERIFIER] BLOCK received, parent task halted',
        } as any,
      });

      return NextResponse.json({ success: true, review_id: reviewId, action: 'blocked' }, { status: 200 });
    }

    return NextResponse.json({ success: true, review_id: reviewId, action: 'approved' }, { status: 200 });
  } catch (error) {
    console.error('Failed to process review packet:', error);
    return NextResponse.json({ error: 'Failed to process review packet' }, { status: 500 });
  }
}
