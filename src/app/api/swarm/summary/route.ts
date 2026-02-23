import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ARCHIVE_HIDE_DAYS = 7;

export async function GET(request: NextRequest) {
  try {
    const ws = String(request.nextUrl.searchParams.get('workspace_id') || 'default');

    const queueVisible = queryOne<{ c: number }>(
      `SELECT COUNT(*) as c
       FROM swarm_tasks st
       WHERE (? = 'all' OR st.ws = ?)
         AND NOT (
           lower(COALESCE(st.status, '')) = 'completed'
           AND datetime(st.updated_at) <= datetime('now', ?)
         )`,
      [ws, ws, `-${ARCHIVE_HIDE_DAYS} days`]
    )?.c ?? 0;

    const activeRuns = queryOne<{ c: number }>(
      `SELECT COUNT(*) as c
       FROM swarm_runs sr
       JOIN swarm_tasks st ON st.task_id = sr.task_id
       WHERE sr.run_status = 'running'
         AND lower(COALESCE(st.status, '')) IN ('in_execution', 'orchestrating')
         AND (? = 'all' OR st.ws = ?)`,
      [ws, ws]
    )?.c ?? 0;

    const activeRoles = queryOne<{ c: number }>(
      `SELECT COUNT(DISTINCT ar.role_id) as c
       FROM agent_roles ar
       JOIN swarm_runs sr ON sr.role_id = ar.role_id
       JOIN swarm_tasks st ON st.task_id = sr.task_id
       WHERE sr.run_status = 'running'
         AND lower(COALESCE(st.status, '')) IN ('in_execution', 'orchestrating')
         AND (? = 'all' OR st.ws = ?)`,
      [ws, ws]
    )?.c ?? 0;

    return NextResponse.json({
      workspace_id: ws,
      queue_visible: Number(queueVisible || 0),
      active_runs: Number(activeRuns || 0),
      active_roles: Number(activeRoles || 0),
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to fetch swarm summary:', error);
    return NextResponse.json({ error: 'Failed to fetch swarm summary' }, { status: 500 });
  }
}
