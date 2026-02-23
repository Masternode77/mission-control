import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

type ActivityRow = {
  id: string;
  activity_type: string;
  message: string;
  metadata: string | null;
  created_at: string;
};

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const rows = queryAll<ActivityRow>(
      `SELECT id, 'status_changed' as activity_type, message, metadata, created_at
       FROM events
       WHERE task_id = ?
          OR json_extract(COALESCE(metadata, '{}'), '$.swarm_task_id') = ?
       UNION ALL
       SELECT run_id as id,
              CASE WHEN run_status = 'running' THEN 'spawned' WHEN run_status = 'failed' THEN 'updated' ELSE 'completed' END as activity_type,
              CASE
                WHEN run_status = 'failed' THEN ('[FAILED] ' || COALESCE(error_message, output_summary, role_id || ' run failed'))
                ELSE COALESCE(output_summary, '[' || role_id || '] run ' || run_status)
              END as message,
              json_object('role_id', role_id, 'run_status', run_status, 'started_at', started_at, 'ended_at', ended_at, 'error_message', error_message) as metadata,
              COALESCE(started_at, created_at) as created_at
       FROM swarm_runs
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT 300`,
      [id, id, id]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Failed to fetch swarm activities:', error);
    return NextResponse.json({ error: 'Failed to fetch swarm activities' }, { status: 500 });
  }
}
