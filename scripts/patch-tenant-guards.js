#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const execPath = path.join(process.cwd(), 'src/lib/swarm-executor.ts');
const taskRoutePath = path.join(process.cwd(), 'src/app/api/swarm/tasks/route.ts');

function patchExecutor(src){
  let s=src;
  if(!s.includes('function enforceTenantIsolationForTask(')){
    const anchor = 'function classifyToolAction(toolName: string, argsRaw: unknown, ctx: PolicyContext): { decision: PolicyDecision; reason: string } {';
    const insert = `function enforceTenantIsolationForTask(taskId: string): {ok: boolean; reason?: string; taskTenant?: string; requesterTenant?: string} {\n  try {\n    const row = queryOne<{ tenant_id: string | null; source_event: string | null; metadata: string | null }>('SELECT tenant_id, source_event, metadata FROM swarm_tasks WHERE task_id = ?', [taskId]);\n    const taskTenant = String(row?.tenant_id || 'default').trim() || 'default';\n    const source = toRecordSafe(row?.source_event || null);\n    const metadata = toRecordSafe(row?.metadata || null);\n    const sourceMeta = toRecord(source['metadata']);\n    const requesterTenant = String(\n      source['tenant_id'] ||\n      sourceMeta['tenant_id'] ||\n      metadata['tenant_id'] ||\n      process.env.REQUEST_TENANT_ID ||\n      'default'\n    ).trim() || 'default';\n    if (requesterTenant !== taskTenant) {\n      return { ok: false, reason: 'TENANT_ISOLATION_BLOCK', taskTenant, requesterTenant };\n    }\n    return { ok: true, taskTenant, requesterTenant };\n  } catch {\n    return { ok: false, reason: 'TENANT_ISOLATION_CHECK_FAILED' };\n  }\n}\n\n`;
    if(!s.includes(anchor)) throw new Error('executor anchor missing');
    s=s.replace(anchor, insert+anchor);
  }

  if(!s.includes('tenantGuard = enforceTenantIsolationForTask(params.taskId)')){
    const anchor = "        const toolStartedAt = new Date().toISOString();";
    const insert = `        const toolStartedAt = new Date().toISOString();\n        const tenantGuard = enforceTenantIsolationForTask(params.taskId);\n        if (!tenantGuard.ok) {\n          tracer.logSpan({\n            spanType: 'tool_call',\n            spanName: next.name,\n            toolName: next.name,\n            toolArguments: next.arguments,\n            success: false,\n            latencyMs: Date.now() - Date.parse(toolStartedAt),\n            startedAt: toolStartedAt,\n            endedAt: new Date().toISOString(),\n            metadata: {\n              tool_call_id: next.id,\n              policy_decision: 'banned',\n              policy_reason: tenantGuard.reason || 'TENANT_ISOLATION_BLOCK',\n              tenant_task: tenantGuard.taskTenant,\n              tenant_requester: tenantGuard.requesterTenant,\n            },\n          });\n          throw new Error('POLICY_BLOCKED: TENANT_ISOLATION_BLOCK');\n        }`;
    s=s.replace(anchor,insert);
  }
  return s;
}

function patchTaskRoute(src){
  let s=src;
  if(!s.includes('function resolveRequesterTenantId(')){
    const anchor = 'function mapPriority(priority: string):';
    const insert = `function resolveRequesterTenantId(request: NextRequest, body?: any): string {\n  const headerTenant = String(request.headers.get('x-tenant-id') || '').trim();\n  const queryTenant = String(request.nextUrl.searchParams.get('tenant_id') || '').trim();\n  const bodyTenant = String(body?.tenant_id || '').trim();\n  return headerTenant || queryTenant || bodyTenant || 'default';\n}\n\n`;
    s=s.replace(anchor,insert+anchor);
  }

  s=s.replace(
    "type SwarmTaskRow = {",
    "type SwarmTaskRow = {\n  tenant_id: string | null;"
  );

  s=s.replace(
    "    const workspaceId = request.nextUrl.searchParams.get('workspace_id') || 'default';",
    "    const workspaceId = request.nextUrl.searchParams.get('workspace_id') || 'default';\n    const requesterTenantId = resolveRequesterTenantId(request);\n    const targetTaskId = request.nextUrl.searchParams.get('task_id');"
  );

  s=s.replace(
    "        st.task_id,",
    "        st.task_id,\n        st.tenant_id,"
  );

  if(!s.includes('tenantFilteredRows')){
    s=s.replace(
      "    const filteredRows =\n      workspaceId && workspaceId !== 'default' && workspaceId !== 'all'\n        ? rows.filter((row) => row.ws === workspaceId)\n        : rows;",
      "    const tenantFilteredRows = rows.filter((row) => String(row.tenant_id || 'default') === requesterTenantId);\n\n    if (targetTaskId) {\n      const existsAny = rows.find((row) => row.task_id === targetTaskId);\n      if (existsAny && String(existsAny.tenant_id || 'default') !== requesterTenantId) {\n        return NextResponse.json({ error: 'Forbidden: tenant isolation' }, { status: 403 });\n      }\n    }\n\n    const filteredRows =\n      workspaceId && workspaceId !== 'default' && workspaceId !== 'all'\n        ? tenantFilteredRows.filter((row) => row.ws === workspaceId)\n        : tenantFilteredRows;"
    );
  }

  s=s.replace(
    "      return {\n        id: row.task_id,",
    "      return {\n        id: row.task_id,\n        tenant_id: row.tenant_id || 'default',"
  );

  s=s.replace(
    "    const body = await request.json();",
    "    const body = await request.json();\n    const requesterTenantId = resolveRequesterTenantId(request, body);"
  );

  s=s.replace(
    "      `INSERT INTO swarm_tasks (task_id, parent_task_id, ws, title, objective, owner_role_id, priority, status, execution_order, context_payload, created_by, created_at, updated_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n      [taskId, parentTaskId, ws, title, objective, ownerRoleId, priority, status, executionOrder, contextPayload, ownerRoleId, now, now]",
    "      `INSERT INTO swarm_tasks (task_id, parent_task_id, ws, title, objective, owner_role_id, priority, status, execution_order, context_payload, tenant_id, created_by, created_at, updated_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n      [taskId, parentTaskId, ws, title, objective, ownerRoleId, priority, status, executionOrder, contextPayload, requesterTenantId, ownerRoleId, now, now]"
  );

  s=s.replace(
    "      id: taskId,",
    "      id: taskId,\n      tenant_id: requesterTenantId,"
  );

  return s;
}

function main(){
  const e=fs.readFileSync(execPath,'utf8');
  const t=fs.readFileSync(taskRoutePath,'utf8');
  fs.writeFileSync(execPath, patchExecutor(e),'utf8');
  fs.writeFileSync(taskRoutePath, patchTaskRoute(t),'utf8');
  console.log('tenant guards patched');
  process.exit(0);
}

main();
