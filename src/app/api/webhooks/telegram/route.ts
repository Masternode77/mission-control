import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { run, queryAll, queryOne } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { sendTelegramReply } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

function clipForTitle(text: string, max = 20) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function normalizePriority(priority: string): 'low' | 'normal' | 'high' | 'urgent' {
  const p = String(priority || '').toLowerCase();
  if (p === 'urgent') return 'urgent';
  if (p === 'high') return 'high';
  if (p === 'low') return 'low';
  return 'normal';
}

function toSwarmPriority(priority: 'low' | 'normal' | 'high' | 'urgent') {
  if (priority === 'urgent') return 'P0';
  if (priority === 'high') return 'P1';
  if (priority === 'low') return 'P3';
  return 'P2';
}

function isStatusQuery(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes('/status') ||
    t.includes('대기 업무') ||
    t.includes('몇 개') ||
    t.includes('상태 알려줘')
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const msg = body?.message || body?.edited_message || body?.channel_post;
    const text = String(msg?.text || msg?.caption || '').trim();
    const chatId = msg?.chat?.id;
    const messageId = msg?.message_id;

    if (!text || !chatId || !messageId) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'no_message_text' });
    }

    // Interceptor: status briefing query, do NOT create task
    if (isStatusQuery(text)) {
      const intake = queryOne<{ c: number }>("SELECT COUNT(*) as c FROM swarm_tasks WHERE status = 'intake'")?.c || 0;
      const inExecution = queryOne<{ c: number }>("SELECT COUNT(*) as c FROM swarm_tasks WHERE status = 'in_execution'")?.c || 0;

      const briefing = `현재 INTAKE 대기 큐: ${intake}개, IN_EXECUTION 진행 큐: ${inExecution}개`;
      const resp = await sendTelegramReply({
        chatId: String(chatId),
        text: briefing,
        replyToMessageId: Number(messageId),
      });

      if (!resp?.ok) {
        const errBody = resp ? await resp.text().catch(() => '') : 'no_response';
        console.error('[telegram-webhook] status interceptor reply failed:', errBody);
      }

      return NextResponse.json({ ok: true, intercepted: true, type: 'status_briefing', intake, in_execution: inExecution });
    }

    const now = new Date().toISOString();
    const taskId = uuidv4();
    const title = `Telegram Input: ${clipForTitle(text, 20)}`;
    const priority = normalizePriority(body?.priority || 'normal');
    const swarmPriority = toSwarmPriority(priority);

    const sourceMeta = {
      source: 'telegram',
      chat_id: String(chatId),
      message_id: Number(messageId),
      update_id: body?.update_id,
      received_at: now,
    };

    const metadata = {
      telegram_chat_id: String(chatId),
      telegram_message_id: Number(messageId),
      telegram_update_id: body?.update_id ?? null,
      intake_source: 'telegram',
    };

    const hasMetadataColumn = queryAll<{ name: string }>("PRAGMA table_info(swarm_tasks)").some((c) => c.name === 'metadata');

    if (hasMetadataColumn) {
      run(
        `INSERT INTO swarm_tasks (task_id, ws, title, objective, owner_role_id, priority, status, origin_type, source_event, metadata, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          taskId,
          'default',
          title,
          text,
          'MC-MAIN',
          swarmPriority,
          'intake',
          'topdown',
          JSON.stringify(sourceMeta),
          JSON.stringify(metadata),
          'telegram-bot',
          now,
          now,
        ]
      );
    } else {
      run(
        `INSERT INTO swarm_tasks (task_id, ws, title, objective, owner_role_id, priority, status, origin_type, source_event, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          taskId,
          'default',
          title,
          text,
          'MC-MAIN',
          swarmPriority,
          'intake',
          'topdown',
          JSON.stringify({ ...sourceMeta, metadata }),
          'telegram-bot',
          now,
          now,
        ]
      );
    }

    const newTask = {
      id: taskId,
      title,
      description: text,
      status: 'intake',
      priority,
      created_at: now,
      updated_at: now,
      swarm_status: 'intake',
      ws: 'default',
      owner_role_id: 'MC-MAIN',
      assigned_agent: { id: 'MC-MAIN', name: 'Monica · Chief of Staff', avatar_emoji: '🧠' },
      metadata,
    };

    broadcast({ type: 'task_created', payload: newTask as any });
    broadcast({ type: 'event_logged', payload: { taskId, sessionId: taskId, summary: '[THINKING] Telegram task ingested into swarm intake' } });

    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '127.0.0.1:3005';
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = process.env.MISSION_CONTROL_BASE_URL || `${proto}://${host}`;

    fetch(`${baseUrl}/api/swarm/tasks/${taskId}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'telegram_auto_ignition' }),
    }).catch((err) => {
      console.error('[telegram-webhook] auto-orchestrate failed:', err);
      broadcast({
        type: 'event_logged',
        payload: { taskId, sessionId: taskId, summary: '[EXECUTOR_ERROR] telegram auto-orchestration failed; manual dispatch required' },
      });
    });

    return NextResponse.json({ ok: true, task_id: taskId, status: 'intake', auto_ignition: true });
  } catch (error) {
    console.error('Failed telegram webhook ingestion:', error);
    return NextResponse.json({ error: 'Failed telegram webhook ingestion' }, { status: 500 });
  }
}
