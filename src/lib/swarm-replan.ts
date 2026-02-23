import { randomUUID } from 'crypto';
import { run, queryAll, queryOne, transaction } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { sendEmergencyHITLRequest, sendTelegramMessage } from '@/lib/telegram';

export type InsightPayloadLike = {
  parent_task_id?: string;
  status?: string;
  severity?: 'S0' | 'S1' | 'S2' | 'S3';
  affected_tasks?: string[];
  claim?: string;
  suggested_next_tasks?: Array<{ task?: string; owner?: string; why?: string; [key: string]: unknown }>;
};

export async function handleInsightInterrupt(
  insightPayload: InsightPayloadLike,
  parentTaskId: string
): Promise<{ blocked: boolean; interrupted: boolean; reason?: string }> {
  const parentTask = queryOne<{
    task_id: string;
    status: string | null;
    interrupt_count: number | null;
    max_interrupts: number | null;
    title: string | null;
  }>(
    `SELECT task_id, status, interrupt_count, max_interrupts, title
     FROM swarm_tasks
     WHERE task_id = ?`,
    [parentTaskId]
  );

  if (!parentTask) {
    return { blocked: false, interrupted: false, reason: `Parent task not found: ${parentTaskId}` };
  }

  const interruptCount = Number(parentTask.interrupt_count ?? 0);
  const maxInterrupts = Number(parentTask.max_interrupts ?? 3);
  const now = new Date().toISOString();
  const severity = insightPayload?.severity || 'S2';

  const affectedFromPayload = Array.isArray(insightPayload?.affected_tasks)
    ? insightPayload.affected_tasks!.filter((taskId) => typeof taskId === 'string' && taskId.trim().length > 0)
    : [];

  let affectedTaskIds = affectedFromPayload;

  if (affectedTaskIds.length === 0) {
    const descendants = queryAll<{ task_id: string }>(
      `WITH RECURSIVE descendants(task_id) AS (
         SELECT task_id FROM swarm_tasks WHERE parent_task_id = ?
         UNION ALL
         SELECT st.task_id
         FROM swarm_tasks st
         JOIN descendants d ON st.parent_task_id = d.task_id
       )
       SELECT task_id FROM descendants`,
      [parentTaskId]
    );
    affectedTaskIds = descendants.map((r) => r.task_id);
  }

  if (interruptCount >= maxInterrupts) {
    run(`UPDATE swarm_tasks SET status = 'blocked', updated_at = ? WHERE task_id = ?`, [now, parentTaskId]);

    const reason = `Circuit breaker reached for parent task ${parentTaskId}. Interrputs: ${interruptCount}/${maxInterrupts}`;
    const baseMsg = `[URGENT REPLAN] Circuit Breaker reached for parent task ${parentTaskId}.\nSeverity=${severity}.\nClaim: ${insightPayload?.claim || '-'}\nMaster approval required.`;

    void sendTelegramMessage({
      text: baseMsg,
      chatId: process.env.TELEGRAM_MASTER_CHAT_ID || undefined,
    });

    void sendEmergencyHITLRequest(parentTaskId, reason, {
      agent_id: 'swarm-replan',
      claim: insightPayload?.claim || '',
      severity,
      raw_payload: insightPayload,
      triggered_at: now,
    });

    broadcast({
      type: 'task_updated',
      payload: {
        id: parentTaskId,
        status: 'blocked',
        summary: 'interrupt_circuit_breaker',
      } as any,
    });

    return { blocked: true, interrupted: false, reason: 'interrupt-limit-exceeded' };
  }

  return transaction(() => {
    const incremented = interruptCount + 1;
    run(`UPDATE swarm_tasks SET interrupt_count = ?, updated_at = ? WHERE task_id = ?`, [incremented, now, parentTaskId]);

    const affected = affectedTaskIds.length > 0 ? affectedTaskIds : [parentTaskId];
    const affectedState = severity === 'S3' ? 'blocked' : 'needs_update';

    for (const taskId of affected) {
      run(`UPDATE swarm_tasks SET status = ?, updated_at = ? WHERE task_id = ?`, [affectedState, now, taskId]);
    }

    const minOrderRow = queryOne<{ min_order: number | null }>(
      `SELECT MIN(COALESCE(execution_order, 0)) AS min_order FROM swarm_tasks WHERE parent_task_id = ?`,
      [parentTaskId]
    );
    const nextFrontOrder = (Number(minOrderRow?.min_order ?? 0) > 0 ? Number(minOrderRow?.min_order) : 0) - 1;

    const mitigationTaskId = randomUUID();
    const requiredFixes = Array.isArray(insightPayload?.suggested_next_tasks)
      ? JSON.stringify(insightPayload!.suggested_next_tasks)
      : JSON.stringify({
          claim: insightPayload?.claim,
          note: `Generated from incident ${Date.now()}`,
        });

    run(
      `INSERT INTO swarm_tasks (
         task_id,
         parent_task_id,
         ws,
         title,
         objective,
         owner_role_id,
         priority,
         status,
         execution_order,
         context_payload,
         created_by,
         created_at,
         updated_at,
         interrupt_count,
         max_interrupts
       )
       VALUES (?, ?, 'default', ?, ?, 'MC-MAIN', 'P2', 'ready', ?, ?, 'system', ?, ?, 0, 3)`,
      [
        mitigationTaskId,
        parentTaskId,
        '[URGENT REPLAN] Execute required fixes',
        requiredFixes,
        nextFrontOrder,
        requiredFixes,
        now,
        now,
      ]
    );

    const placeholders = affected.map(() => '?').join(',');
    if (affected.length > 0) {
      run(
        `UPDATE swarm_tasks
         SET execution_order = execution_order + 1
         WHERE parent_task_id = ? AND task_id NOT IN (${placeholders})`,
        [parentTaskId, ...affected]
      );
      run(
        `UPDATE swarm_tasks
         SET execution_order = ${nextFrontOrder}
         WHERE task_id IN (${placeholders})`,
        [...affected]
      );
    }

    run(
      `UPDATE swarm_tasks
       SET execution_order = ${nextFrontOrder - 1}
       WHERE task_id = ?`,
      [mitigationTaskId]
    );

    run(
      `INSERT INTO swarm_handoffs (
         handoff_id,
         from_role_id,
         to_role_id,
         task_id,
         handoff_type,
         created_at
       )
       VALUES (?, 'system', 'MC-MAIN', ?, 'urgent_replan', ?)`,
      [randomUUID(), parentTaskId, now]
    );

    broadcast({
      type: 'task_updated',
      payload: {
        id: parentTaskId,
        status: affectedState,
        summary: '[URGENT REPLAN] Replan task created and scheduled',
        urgency: 'high',
      } as any,
    });

    return { blocked: false, interrupted: true, reason: 'replan-routed' };
  });
}
