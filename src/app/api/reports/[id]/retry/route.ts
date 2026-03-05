import { NextRequest, NextResponse } from 'next/server';
import { retryReportRun } from '@/lib/reporting';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const step = (body?.step || 'all') as 'send' | 'index' | 'pdf' | 'all';
    const row = await retryReportRun(params.id, step);
    return NextResponse.json({ ok: true, report: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
