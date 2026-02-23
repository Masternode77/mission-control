import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { igniteTaskOrchestration } from '@/lib/swarm-ignite';

export const dynamic = 'force-dynamic';

type RadarOptions = {
  workspaceId: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  ownerRoleId: string;
  title: string;
  dryRun: boolean;
  source: string;
};

function toSwarmPriority(priority: RadarOptions['priority']): 'P0' | 'P1' | 'P2' | 'P3' {
  if (priority === 'urgent') return 'P0';
  if (priority === 'high') return 'P1';
  if (priority === 'low') return 'P3';
  return 'P2';
}

function parseBoolean(raw: string | null): boolean {
  const v = String(raw || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on';
}

function parsePriority(raw: string | null): RadarOptions['priority'] {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'urgent') return 'urgent';
  if (v === 'high') return 'high';
  if (v === 'low') return 'low';
  return 'normal';
}

function getOptionsFromRequest(request: NextRequest, source: string): RadarOptions {
  const sp = request.nextUrl.searchParams;

  const workspaceId = String(sp.get('workspace_id') || 'default').trim() || 'default';
  const priority = parsePriority(sp.get('priority'));
  const ownerRoleId = String(sp.get('owner_role_id') || 'MC-MAIN').trim() || 'MC-MAIN';
  const topic = String(sp.get('topic') || '').trim();
  const titlePrefix = String(sp.get('title_prefix') || '').trim();
  const defaultTitle = 'Global Market & Data Center Daily Radar';
  const title = topic || titlePrefix || defaultTitle;
  const dryRun = parseBoolean(sp.get('dry_run'));

  return {
    workspaceId,
    priority,
    ownerRoleId,
    title,
    dryRun,
    source,
  };
}

async function createRadarTaskAndIgnite(options: RadarOptions) {
  const now = new Date().toISOString();
  const taskId = uuidv4();

  const payload = {
    task_id: taskId,
    ws: options.workspaceId,
    title: options.title,
    objective:
      'Build daily radar across macro, rates/FX, AI semiconductor supply chain, and data center market moves. Fan-out to 2-3 specialists and synthesize final action memo.',
    owner_role_id: options.ownerRoleId,
    priority: options.priority,
    swarm_priority: toSwarmPriority(options.priority),
    status: 'orchestrating',
    origin_type: 'proactive_radar',
    execution_order: 0,
    context_payload: {
      type: 'proactive_radar',
      trigger_source: options.source,
      triggered_at: now,
      workspace_id: options.workspaceId,
      owner_role_id: options.ownerRoleId,
      priority: options.priority,
      title: options.title,
    },
    created_by: 'MC-MAIN',
    created_at: now,
    updated_at: now,
  };

  if (options.dryRun) {
    return {
      ok: true,
      dry_run: true,
      would_create: payload,
    };
  }

  run(
    `INSERT INTO swarm_tasks (
      task_id, ws, title, objective, owner_role_id, priority, status,
      origin_type, execution_order, context_payload, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.task_id,
      payload.ws,
      payload.title,
      payload.objective,
      payload.owner_role_id,
      payload.swarm_priority,
      payload.status,
      payload.origin_type,
      payload.execution_order,
      JSON.stringify(payload.context_payload),
      payload.created_by,
      payload.created_at,
      payload.updated_at,
    ]
  );

  broadcast({
    type: 'task_created',
    payload: {
      id: taskId,
      task_id: taskId,
      title: payload.title,
      status: payload.status,
      ws: payload.ws,
    } as any,
  });

  broadcast({
    type: 'event_logged',
    payload: {
      taskId,
      sessionId: taskId,
      summary: 'proactive_radar_task_created',
    },
  });

  void igniteTaskOrchestration(taskId, options.source);

  return { ok: true, dry_run: false, taskId, status: 'orchestrating' as const };
}

export async function GET(request: NextRequest) {
  try {
    const options = getOptionsFromRequest(request, 'cron-radar-get');
    const result = await createRadarTaskAndIgnite(options);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to execute radar GET:', error);
    return NextResponse.json({ ok: false, error: 'Failed to execute radar' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const options = getOptionsFromRequest(request, 'cron-radar-post');
    const result = await createRadarTaskAndIgnite(options);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to execute radar POST:', error);
    return NextResponse.json({ ok: false, error: 'Failed to execute radar' }, { status: 500 });
  }
}
