import { NextRequest, NextResponse } from 'next/server';
import { POST as orchestrate } from '../orchestrate/route';
import { run } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const now = new Date().toISOString();

  // clear only running/failed residue for retry cleanliness
  run(`UPDATE swarm_runs SET run_status='failed', ended_at=COALESCE(ended_at, ?), error_message=COALESCE(error_message,'retry superseded') WHERE task_id=? AND run_status='running'`, [now, id]);
  run(`UPDATE swarm_tasks SET status='intake', updated_at=? WHERE task_id=?`, [now, id]);

  return orchestrate(request, ctx);
}
