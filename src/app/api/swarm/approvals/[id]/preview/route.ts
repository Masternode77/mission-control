import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

function resolveMocPath(taskId: string) {
  if (taskId === 'MC-MAIN-240221-P01') {
    return '/Users/josh/.openclaw/workspace/memory/dc-insights/DC-FIN-240221-P01.md';
  }
  return `/Users/josh/.openclaw/workspace/memory/swarm-results/${taskId}.md`;
}

function obsidianLink(filePath: string) {
  const vault = 'workspace';
  const file = filePath.replace('/Users/josh/.openclaw/workspace/', '');
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const approval = queryOne<{ approval_id: string; task_id: string }>(
      'SELECT approval_id, task_id FROM swarm_approvals WHERE approval_id = ?',
      [id]
    );
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });

    const task = queryOne<{ task_id: string; title: string; objective: string | null }>(
      'SELECT task_id, title, objective FROM swarm_tasks WHERE task_id = ?',
      [approval.task_id]
    );

    const run = queryOne<{ output_summary: string | null }>(
      `SELECT output_summary FROM swarm_runs WHERE task_id = ? ORDER BY COALESCE(ended_at, started_at, created_at) DESC LIMIT 1`,
      [approval.task_id]
    );

    const filePath = resolveMocPath(approval.task_id);
    const runMarkdown = run?.output_summary || '';
    const fileMarkdown = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    // Prefer latest run draft for HITL quick review; fallback to archived file.
    let markdown = runMarkdown || fileMarkdown;

    if (!markdown.trim()) {
      markdown = `# ${task?.title || approval.task_id}\n\n## Objective\n${task?.objective || '-'}\n\n## Draft\n실행 결과 초안이 아직 없어 기본 템플릿으로 표시합니다.`;
    }

    return NextResponse.json({
      approval_id: id,
      task_id: approval.task_id,
      title: task?.title || approval.task_id,
      markdown,
      file_path: filePath,
      obsidian_url: obsidianLink(filePath),
    });
  } catch (error) {
    console.error('Failed to load approval preview:', error);
    return NextResponse.json({ error: 'Failed to load approval preview' }, { status: 500 });
  }
}
