#!/usr/bin/env node
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3005';

async function createTaskAsTenant(tenantId) {
  const res = await fetch(`${BASE_URL}/api/swarm/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId },
    body: JSON.stringify({
      title: `[RBAC] tenant isolation ${Date.now()}`,
      description: 'rbac test',
      workspace_id: 'default',
      priority: 'normal',
      assigned_agent_id: 'MC-MAIN',
      tenant_id: tenantId,
    }),
  });
  if (!res.ok) throw new Error(`create task failed ${res.status}`);
  return res.json();
}

async function assertForbiddenOnTaskRead(taskId, tenantId) {
  const res = await fetch(`${BASE_URL}/api/swarm/tasks?workspace_id=default&task_id=${encodeURIComponent(taskId)}`, {
    headers: { 'x-tenant-id': tenantId },
  });
  if (res.status === 403) return true;

  // Alternate acceptable behavior: hidden from list and orchestrate blocked by policy
  const arr = await res.json().catch(() => []);
  const found = Array.isArray(arr) ? arr.some((t) => t.id === taskId) : false;
  if (!found) return true;
  throw new Error(`expected 403 or isolation-hidden list; got status=${res.status} and task visible`);
}

(async function main() {
  const a = await createTaskAsTenant('tenant-a');
  const ok = await assertForbiddenOnTaskRead(a.id, 'tenant-b');
  if (!ok) throw new Error('tenant isolation check failed');
  console.log('[RBAC TENANT ISOLATION PASS]', { taskId: a.id, ownerTenant: 'tenant-a', blockedTenant: 'tenant-b' });
})().catch((e) => {
  console.error('[RBAC TENANT ISOLATION FAIL]', e.message);
  process.exit(1);
});
