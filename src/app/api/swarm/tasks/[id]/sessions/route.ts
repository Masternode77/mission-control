import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

type SessionRow = {
  id: string;
  agent_id: string | null;
  openclaw_session_id: string;
  channel: string | null;
  status: string;
  session_type: string;
  task_id: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  agent_avatar_emoji?: string;
};

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const rows = queryAll<SessionRow>(
      `SELECT
         sr.run_id as id,
         sr.role_id as agent_id,
         COALESCE(sr.session_key, sr.run_id) as openclaw_session_id,
         'swarm' as channel,
         CASE WHEN sr.run_status = 'running' THEN 'active' ELSE sr.run_status END as status,
         'swarm-run' as session_type,
         sr.task_id,
         sr.ended_at,
         COALESCE(sr.started_at, sr.created_at) as created_at,
         COALESCE(sr.ended_at, sr.created_at) as updated_at,
         ar.display_name as agent_name,
         '🧠' as agent_avatar_emoji
       FROM swarm_runs sr
       LEFT JOIN agent_roles ar ON ar.role_id = sr.role_id
       WHERE sr.task_id = ?
       ORDER BY sr.created_at DESC`,
      [id]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Failed to fetch swarm sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch swarm sessions' }, { status: 500 });
  }
}
