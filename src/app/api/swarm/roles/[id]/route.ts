import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from '@/lib/events';
import { queryOne, run } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PatchRoleSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  domain: z.string().trim().regex(/^[A-Z_]+$/, 'domain must be UPPERCASE_WITH_UNDERSCORES'),
  systemPrompt: z.string().min(50),
  baseVersion: z.number().int().positive(),
});

type RoleRow = {
  role_id: string;
  display_name: string;
  domain: string;
  prompt_template_ref: string | null;
  version: number;
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = PatchRoleSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { displayName, domain, systemPrompt, baseVersion } = parsed.data;

    const existing = queryOne<RoleRow>(
      `SELECT role_id, display_name, domain, prompt_template_ref, version
       FROM agent_roles
       WHERE role_id = ?`,
      [id]
    );

    if (!existing) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    if (Number(existing.version || 1) !== baseVersion) {
      return NextResponse.json(
        {
          error: 'Version conflict',
          code: 'ROLE_VERSION_CONFLICT',
          current: {
            role_id: existing.role_id,
            displayName: existing.display_name,
            domain: existing.domain,
            systemPrompt: existing.prompt_template_ref || '',
            version: Number(existing.version || 1),
          },
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const nextVersion = baseVersion + 1;

    const result = run(
      `UPDATE agent_roles
       SET display_name = ?, domain = ?, prompt_template_ref = ?, version = ?, updated_at = ?
       WHERE role_id = ? AND version = ?`,
      [displayName, domain, systemPrompt, nextVersion, now, id, baseVersion]
    );

    if (result.changes === 0) {
      const latest = queryOne<RoleRow>(
        `SELECT role_id, display_name, domain, prompt_template_ref, version
         FROM agent_roles
         WHERE role_id = ?`,
        [id]
      );
      return NextResponse.json(
        {
          error: 'Version conflict',
          code: 'ROLE_VERSION_CONFLICT',
          current: latest
            ? {
                role_id: latest.role_id,
                displayName: latest.display_name,
                domain: latest.domain,
                systemPrompt: latest.prompt_template_ref || '',
                version: Number(latest.version || 1),
              }
            : null,
        },
        { status: 409 }
      );
    }

    run(
      `INSERT INTO events (id, type, task_id, message, metadata, created_at)
       VALUES (?, 'system', NULL, ?, ?, ?)`,
      [
        uuidv4(),
        `[ROLE CONFIG UPDATED] ${id}`,
        JSON.stringify({ role_id: id, displayName, domain, version: nextVersion }),
        now,
      ]
    );

    broadcast({
      type: 'event_logged',
      payload: { taskId: id, sessionId: uuidv4(), summary: 'role_config_updated' },
    });

    return NextResponse.json({
      ok: true,
      role_id: id,
      displayName,
      domain,
      systemPrompt,
      version: nextVersion,
      updated_at: now,
    });
  } catch (error) {
    console.error('Failed to update role config:', error);
    return NextResponse.json({ error: 'Failed to update role config' }, { status: 500 });
  }
}
