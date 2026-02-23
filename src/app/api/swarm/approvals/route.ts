import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status') || 'pending';

    const rows = queryAll<{
      approval_id: string;
      task_id: string;
      gate_reason: string | null;
      approval_status: string;
      requested_at: string;
      title: string | null;
    }>(
      `
      SELECT sa.approval_id, sa.task_id, sa.gate_reason, sa.approval_status, sa.requested_at, st.title
      FROM swarm_approvals sa
      LEFT JOIN swarm_tasks st ON st.task_id = sa.task_id
      WHERE sa.approval_status = ?
      ORDER BY sa.requested_at DESC
      `,
      [status]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Failed to fetch approvals:', error);
    return NextResponse.json({ error: 'Failed to fetch approvals' }, { status: 500 });
  }
}
