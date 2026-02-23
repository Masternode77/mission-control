import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { run, queryOne } from '@/lib/db';
import { handleInsightInterrupt } from '@/lib/swarm-replan';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type EvidenceRef = {
  type: 'url' | 'file' | 'db_query' | 'calc';
  ref: string;
  snippet: string;
  timestamp: string;
};

type InsightPacketV2 = {
  version?: string;
  task_id?: string;
  agent_id?: string;
  parent_task_id?: string;
  status: 'started' | 'partial' | 'done' | 'blocked';
  claim: string;
  evidence_refs?: EvidenceRef[];
  impact?: string;
  suggested_next_tasks?: Array<Record<string, unknown>>;
  affected_tasks?: string[];
  severity: 'S0' | 'S1' | 'S2' | 'S3';
  deliverables?: Array<string | Record<string, unknown>>;
  open_questions?: string[];
  generated_at?: string;
};

function normalizePayload(input: unknown): InsightPacketV2 | null {
  if (!input || typeof input !== 'object') return null;

  const body = input as Record<string, unknown>;
  const status = body.status;
  const claim = body.claim;
  const severity = body.severity;

  if (typeof status !== 'string' || !['started', 'partial', 'done', 'blocked'].includes(status)) {
    return null;
  }
  if (typeof claim !== 'string' || claim.trim().length === 0) {
    return null;
  }
  if (typeof severity !== 'string' || !['S0', 'S1', 'S2', 'S3'].includes(severity)) {
    return null;
  }

  const parentTaskId =
    typeof body.parent_task_id === 'string' && body.parent_task_id.trim().length > 0
      ? body.parent_task_id.trim()
      : undefined;

  return {
    version: typeof body.version === 'string' ? body.version : undefined,
    task_id: typeof body.task_id === 'string' ? body.task_id : undefined,
    agent_id: typeof body.agent_id === 'string' ? body.agent_id : undefined,
    parent_task_id: parentTaskId,
    status: status as InsightPacketV2['status'],
    claim: claim.trim(),
    evidence_refs: Array.isArray(body.evidence_refs) ? (body.evidence_refs as EvidenceRef[]) : undefined,
    impact: typeof body.impact === 'string' ? body.impact : undefined,
    suggested_next_tasks: Array.isArray(body.suggested_next_tasks)
      ? (body.suggested_next_tasks as Array<Record<string, unknown>>)
      : undefined,
    affected_tasks: Array.isArray(body.affected_tasks)
      ? (body.affected_tasks as string[]).filter((t) => typeof t === 'string' && t.trim().length > 0)
      : [],
    severity: severity as InsightPacketV2['severity'],
    deliverables: Array.isArray(body.deliverables) ? (body.deliverables as Array<string | Record<string, unknown>>) : undefined,
    open_questions: Array.isArray(body.open_questions)
      ? (body.open_questions as string[]).filter((item) => typeof item === 'string')
      : undefined,
    generated_at: typeof body.generated_at === 'string' ? body.generated_at : undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = normalizePayload(body);

    if (!payload) {
      return NextResponse.json({ error: 'Invalid insight packet. status, severity, claim are required.' }, { status: 400 });
    }

    const parentTaskId = payload.parent_task_id || payload.task_id;
    if (!parentTaskId) {
      return NextResponse.json({ error: 'Either parent_task_id or task_id is required.' }, { status: 400 });
    }

    const taskRow = queryOne<{ task_id: string }>(
      'SELECT task_id FROM swarm_tasks WHERE task_id = ?',
      [parentTaskId]
    );
    if (!taskRow) {
      return NextResponse.json({ error: `parent_task_id does not exist: ${parentTaskId}` }, { status: 400 });
    }

    const insightId = uuidv4();
    const now = new Date().toISOString();

    const packetPayload = {
      version: payload.version ?? 'v2',
      task_id: payload.task_id,
      severity: payload.severity,
      status: payload.status,
      claim: payload.claim,
      evidence_refs: payload.evidence_refs || [],
      impact: payload.impact,
      suggested_next_tasks: payload.suggested_next_tasks || [],
      affected_tasks: payload.affected_tasks || [],
      deliverables: payload.deliverables || [],
      open_questions: payload.open_questions || [],
      generated_at: payload.generated_at || now,
    };

    run(
      `INSERT INTO swarm_insights (insight_id, parent_task_id, agent_id, status, claim, severity, impact, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        insightId,
        parentTaskId,
        payload.agent_id || null,
        payload.status,
        payload.claim,
        payload.severity,
        payload.impact || null,
        JSON.stringify(packetPayload),
        now,
      ]
    );

    if (payload.severity === 'S2' || payload.severity === 'S3') {
      void handleInsightInterrupt(
        {
          parent_task_id: parentTaskId,
          severity: payload.severity,
          claim: payload.claim,
          affected_tasks: payload.affected_tasks,
          suggested_next_tasks: payload.suggested_next_tasks,
          status: payload.status,
        },
        parentTaskId
      ).catch((err) => {
        console.error('handleInsightInterrupt background failure:', err);
      });
    }

    return NextResponse.json({ success: true, insight_id: insightId, received_at: now }, { status: 200 });
  } catch (error) {
    console.error('Failed to store insight packet:', error);
    return NextResponse.json({ error: 'Failed to store insight packet' }, { status: 500 });
  }
}
