import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string; deliverableId: string }> }) {
  try {
    const { id, deliverableId } = await params;

    const row = queryOne<{ output_path: string | null; output_summary: string | null }>(
      `SELECT output_path, output_summary
       FROM swarm_runs
       WHERE task_id = ? AND run_id = ?`,
      [id, deliverableId]
    );

    if (!row) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });

    if (row.output_path && existsSync(row.output_path)) {
      const content = readFileSync(row.output_path, 'utf-8');
      return NextResponse.json({ content, source: row.output_path });
    }

    return NextResponse.json({ content: row.output_summary || '_No content_', source: 'output_summary' });
  } catch (error) {
    console.error('Failed to read swarm deliverable content:', error);
    return NextResponse.json({ error: 'Failed to read deliverable content' }, { status: 500 });
  }
}
