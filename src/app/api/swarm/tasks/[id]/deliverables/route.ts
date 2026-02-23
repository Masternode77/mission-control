import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

type DeliverableRow = {
  id: string;
  title: string;
  path: string | null;
  description: string | null;
  created_at: string;
  deliverable_type: 'file' | 'artifact' | 'url';
};

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const fromRuns = queryAll<DeliverableRow>(
      `SELECT run_id as id,
              ('Run output: ' || role_id) as title,
              output_path as path,
              output_summary as description,
              COALESCE(ended_at, started_at, created_at) as created_at,
              CASE WHEN output_path IS NOT NULL THEN 'file' ELSE 'artifact' END as deliverable_type
       FROM swarm_runs
       WHERE task_id = ?
       ORDER BY created_at DESC`,
      [id]
    );

    return NextResponse.json(fromRuns);
  } catch (error) {
    console.error('Failed to fetch swarm deliverables:', error);
    return NextResponse.json({ error: 'Failed to fetch swarm deliverables' }, { status: 500 });
  }
}
