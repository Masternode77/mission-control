import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

type SearchRow = {
  task_id: string;
  title: string;
  objective: string | null;
  status: string;
  updated_at: string;
  run_id: string | null;
  output_summary: string | null;
  output_path: string | null;
};

function contains(text: string | null | undefined, q: string) {
  return String(text || '').toLowerCase().includes(q.toLowerCase());
}

function safeSnippet(text: string, q: string, size = 180) {
  const raw = text.replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const idx = raw.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return raw.slice(0, size);
  const start = Math.max(0, idx - Math.floor(size / 3));
  return raw.slice(start, start + size);
}

export async function GET(request: NextRequest) {
  try {
    const q = String(request.nextUrl.searchParams.get('q') || '').trim();
    if (!q) return NextResponse.json([]);

    const ws = String(request.nextUrl.searchParams.get('workspace_id') || 'default');

    const rows = queryAll<SearchRow>(
      `SELECT
         st.task_id,
         st.title,
         st.objective,
         st.status,
         st.updated_at,
         sr.run_id,
         sr.output_summary,
         sr.output_path
       FROM swarm_tasks st
       LEFT JOIN swarm_runs sr ON sr.task_id = st.task_id
       WHERE (st.ws = ? OR ? = 'all')
         AND (
           lower(st.title) LIKE lower(?) OR
           lower(COALESCE(st.objective, '')) LIKE lower(?) OR
           lower(COALESCE(sr.output_summary, '')) LIKE lower(?)
         )
       ORDER BY st.updated_at DESC
       LIMIT 200`,
      [ws, ws, `%${q}%`, `%${q}%`, `%${q}%`]
    );

    const dedup = new Map<string, any>();

    for (const row of rows) {
      let matchedBy = 'task';
      let snippet = '';

      if (contains(row.output_summary, q)) {
        matchedBy = 'deliverable';
        snippet = safeSnippet(String(row.output_summary || ''), q);
      } else if (contains(row.objective, q)) {
        matchedBy = 'description';
        snippet = safeSnippet(String(row.objective || ''), q);
      } else {
        snippet = safeSnippet(String(row.title || ''), q);
      }

      if (!dedup.has(row.task_id)) {
        dedup.set(row.task_id, {
          task_id: row.task_id,
          title: row.title,
          description: row.objective,
          status: row.status,
          updated_at: row.updated_at,
          matched_by: matchedBy,
          snippet,
        });
      }
    }

    // Optional deep scan for markdown file deliverables (top 30 recent tasks only)
    const candidates = queryAll<SearchRow>(
      `SELECT st.task_id, st.title, st.objective, st.status, st.updated_at, sr.run_id, sr.output_summary, sr.output_path
       FROM swarm_tasks st
       JOIN swarm_runs sr ON sr.task_id = st.task_id
       WHERE (st.ws = ? OR ? = 'all')
         AND sr.output_path IS NOT NULL
       ORDER BY st.updated_at DESC
       LIMIT 120`,
      [ws, ws]
    );

    for (const row of candidates) {
      if (dedup.has(row.task_id)) continue;
      const p = String(row.output_path || '');
      if (!p || !existsSync(p)) continue;
      let content = '';
      try {
        content = readFileSync(p, 'utf-8');
      } catch {
        continue;
      }
      if (!contains(content, q)) continue;

      dedup.set(row.task_id, {
        task_id: row.task_id,
        title: row.title,
        description: row.objective,
        status: row.status,
        updated_at: row.updated_at,
        matched_by: 'deliverable_file',
        snippet: safeSnippet(content, q),
      });
    }

    return NextResponse.json(Array.from(dedup.values()).slice(0, 80));
  } catch (error) {
    console.error('Failed to search swarm tasks:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
}
