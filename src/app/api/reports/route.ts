import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { createReportPipeline } from '@/lib/reporting';

export async function GET() {
  const rows = queryAll<any>('SELECT * FROM report_runs ORDER BY datetime(created_at) DESC LIMIT 20');
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = String(body?.title || 'Untitled Report');
    const content = String(body?.content || '# Empty report');
    const taskId = body?.taskId ? String(body.taskId) : undefined;
    const workspaceId = body?.workspaceId ? String(body.workspaceId) : 'default';
    const telegramChatId = body?.telegramChatId ? String(body.telegramChatId) : undefined;

    const row = await createReportPipeline({ title, content, taskId, workspaceId, telegramChatId });
    return NextResponse.json({ ok: true, report: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
