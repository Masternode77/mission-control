import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RoleRow = {
  role_id: string;
  display_name: string;
  domain: string;
  profile_type: string;
  prompt_template_ref: string | null;
  version: number;
  enabled: number;
  running_runs: number;
  total_runs: number;
};

export async function GET(request: NextRequest) {
  try {
    const ws = String(request.nextUrl.searchParams.get('workspace_id') || 'all');

    const rows = queryAll<RoleRow>(`
      SELECT
        ar.role_id,
        ar.display_name,
        ar.domain,
        ar.profile_type,
        ar.prompt_template_ref,
        ar.version,
        ar.enabled,
        COALESCE(SUM(CASE WHEN sr.run_status = 'running' AND lower(COALESCE(st.status, '')) IN ('in_execution', 'orchestrating') THEN 1 ELSE 0 END), 0) AS running_runs,
        COALESCE(COUNT(sr.run_id), 0) AS total_runs
      FROM agent_roles ar
      LEFT JOIN swarm_runs sr ON sr.role_id = ar.role_id
      LEFT JOIN swarm_tasks st ON st.task_id = sr.task_id
      WHERE (? = 'all' OR st.ws = ? OR st.ws IS NULL)
      GROUP BY ar.role_id, ar.display_name, ar.domain, ar.profile_type, ar.prompt_template_ref, ar.version, ar.enabled
      ORDER BY ar.domain ASC, ar.display_name ASC
    `, [ws, ws]);

    return NextResponse.json(
      rows.map((r) => ({
        id: `role:${r.role_id}`,
        role_id: r.role_id,
        display_name: r.display_name,
        displayName: r.display_name,
        domain: r.domain,
        profile_type: r.profile_type,
        system_prompt: r.prompt_template_ref || '',
        systemPrompt: r.prompt_template_ref || '',
        version: Number(r.version || 1),
        enabled: Boolean(r.enabled),
        running_runs: Number(r.running_runs || 0),
        total_runs: Number(r.total_runs || 0),
        status: Number(r.running_runs || 0) > 0 ? 'working' : 'standby',
      }))
    );
  } catch (error) {
    console.error('Failed to fetch swarm roles:', error);
    return NextResponse.json({ error: 'Failed to fetch swarm roles' }, { status: 500 });
  }
}
