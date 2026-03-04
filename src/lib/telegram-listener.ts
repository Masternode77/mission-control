import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { run, queryAll } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { sendTelegramReply } from '@/lib/telegram';

const VECTOR_DB = '/Users/josh/.openclaw/workspace/vector_store.db';


const QUERY_ALIAS: Array<[RegExp, string]> = [
  [/차이점|비교/gi, 'difference'],
  [/최근|최신/gi, 'latest'],
  [/냉각/gi, 'cooling'],
  [/수전|전력/gi, 'power'],
  [/클러스터/gi, 'cluster'],
  [/마이크로소프트/gi, 'microsoft'],
  [/아마존/gi, 'amazon'],
];

function getConfig() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    allowedChatId: String(process.env.TELEGRAM_MASTER_CHAT_ID || '85990941'),
    workspaceId: process.env.TELEGRAM_SYNC_WORKSPACE || 'default',
    ownerRoleId: process.env.TELEGRAM_SYNC_OWNER_ROLE || 'MC-MAIN',
  };
}

function clipForTitle(text: string, max = 48) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function toSwarmPriority(text: string): 'P0' | 'P1' | 'P2' | 'P3' {
  const t = text.toLowerCase();
  if (/(긴급|urgent|asap|p0)/i.test(t)) return 'P0';
  if (/(높음|high|p1)/i.test(t)) return 'P1';
  if (/(낮음|low|p3)/i.test(t)) return 'P3';
  return 'P2';
}

function hasMetadataColumn(): boolean {
  return queryAll<{ name: string }>('PRAGMA table_info(swarm_tasks)').some((c) => c.name === 'metadata');
}

function isRagSearchIntent(text: string): boolean {
  const t = text.trim();
  return t.startsWith('?') || /검색\s*:/i.test(t);
}

function tokenizeKoreanEnglish(input: string): string[] {
  let normalized = input;
  for (const [rx, en] of QUERY_ALIAS) normalized = normalized.replace(rx, ` ${en} `);

  const base = normalized
    .toLowerCase()
    .replace(/[?.,:;()[\]{}"'`]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const expanded = new Set(base);
  if (base.some((t) => t.includes('aws') || t.includes('amazon'))) expanded.add('aws');
  if (base.some((t) => t.includes('azure') || t.includes('microsoft'))) expanded.add('azure');

  return Array.from(expanded);
}

function semanticSearchFromVectorStore(query: string, limit = 5): Array<{ title: string; content: string; score: number }> {
  const db = new Database(VECTOR_DB, { readonly: true });
  try {
    const rows = db.prepare('SELECT payload FROM vectors ORDER BY rowid DESC LIMIT 500').all() as Array<{ payload: string }>;
    const qTokens = tokenizeKoreanEnglish(query);

    const scored = rows
      .map((r) => {
        try {
          const p = JSON.parse(r.payload || '{}') as { title?: string; content?: string };
          const title = p.title || 'untitled';
          const content = String(p.content || '').slice(0, 4000);
          const hay = `${title}\n${content}`.toLowerCase();
          const score = qTokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
          return { title, content, score };
        } catch {
          return { title: 'invalid', content: '', score: 0 };
        }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  } finally {
    db.close();
  }
}

function synthesizeRagAnswer(query: string, chunks: Array<{ title: string; content: string; score: number }>): string {
  if (!chunks.length) {
    return [
      `질문: ${query}`,
      '',
      'RAG 검색 결과가 충분하지 않습니다. 키워드를 조금 더 구체화해 주세요.',
      '예: 검색: Azure liquid cooling MW CAPEX',
    ].join('\n');
  }

  const bullets = chunks.slice(0, 3).map((c, i) => {
    const preview = c.content
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' / ')
      .slice(0, 240);
    return `${i + 1}) ${c.title} — ${preview}`;
  });

  return [
    `질문: ${query}`,
    '',
    '[RAG 즉시 브리핑]',
    ...bullets,
    '',
    '요약: 상위 문서 기준으로 전력/냉각/클러스터 구조 관련 근거를 우선 반영했습니다.',
  ].join('\n');
}

async function handleRagSearch(chatId: string, messageId: number, text: string): Promise<void> {
  const normalized = text.replace(/^\?\s*/, '').replace(/검색\s*:\s*/i, '').trim();
  const chunks = semanticSearchFromVectorStore(normalized, 5);
  const answer = synthesizeRagAnswer(normalized, chunks);

  await sendTelegramReply({
    chatId,
    replyToMessageId: messageId,
    text: answer,
  });
}

function ingestTelegramText(
  updateId: number | undefined,
  chatId: string,
  messageId: number,
  text: string,
  cfg: { workspaceId: string; ownerRoleId: string }
) {
  const now = new Date().toISOString();
  const taskId = uuidv4();
  const title = `Telegram Sync: ${clipForTitle(text, 48)}`;
  const priority = toSwarmPriority(text);

  const sourceMeta = {
    source: 'telegram_polling_listener',
    chat_id: chatId,
    message_id: messageId,
    update_id: updateId,
    received_at: now,
    routing: 'auto_approve_to_in_execution',
  };

  const metadata = {
    telegram_chat_id: chatId,
    telegram_message_id: messageId,
    telegram_update_id: updateId ?? null,
    intake_source: 'telegram_polling_listener',
    auto_approved: true,
    sync_mode: 'polling',
  };

  if (hasMetadataColumn()) {
    run(
      `INSERT INTO swarm_tasks (
        task_id, ws, title, objective, owner_role_id, priority, status,
        origin_type, source_event, metadata, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        cfg.workspaceId,
        title,
        text,
        cfg.ownerRoleId,
        priority,
        'in_execution',
        'topdown',
        JSON.stringify(sourceMeta),
        JSON.stringify(metadata),
        'telegram-listener',
        now,
        now,
      ]
    );
  } else {
    run(
      `INSERT INTO swarm_tasks (
        task_id, ws, title, objective, owner_role_id, priority, status,
        origin_type, source_event, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        cfg.workspaceId,
        title,
        text,
        cfg.ownerRoleId,
        priority,
        'in_execution',
        'topdown',
        JSON.stringify({ ...sourceMeta, metadata }),
        'telegram-listener',
        now,
        now,
      ]
    );
  }

  broadcast({
    type: 'task_created',
    payload: {
      id: taskId,
      title,
      description: text,
      status: 'in_execution',
      swarm_status: 'in_execution',
      ws: cfg.workspaceId,
      owner_role_id: cfg.ownerRoleId,
      metadata,
      created_at: now,
      updated_at: now,
    } as any,
  });

  broadcast({
    type: 'event_logged',
    payload: {
      taskId,
      sessionId: String(updateId || taskId),
      summary: '[SYNC] Telegram -> Mission Control auto-approved to in_execution',
    },
  });

  return taskId;
}

export async function startTelegramPollingListener() {
  const cfg = getConfig();

  if (!cfg.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const bot = new TelegramBot(cfg.botToken, { polling: true });

  bot.on('message', async (msg) => {
    try {
      const chatId = String(msg.chat?.id ?? '');
      const messageId = Number(msg.message_id || 0);
      const text = String(msg.text || '').trim();

      if (!text || !messageId) return;
      if (chatId !== cfg.allowedChatId) return;

      if (isRagSearchIntent(text)) {
        await handleRagSearch(chatId, messageId, text);
        console.log(`[telegram-listener] rag_search message_id=${messageId}`);
        return;
      }

      const taskId = ingestTelegramText((msg as any).update_id as number | undefined, chatId, messageId, text, cfg);
      console.log(`[telegram-listener] synced message_id=${messageId} -> task_id=${taskId}`);
    } catch (error) {
      console.error('[telegram-listener] failed to ingest message:', error);
    }
  });

  bot.on('polling_error', (error: any) => {
    console.error('[telegram-listener] polling_error:', error?.message || error);
  });

  console.log(`[telegram-listener] started (chat allowlist: ${cfg.allowedChatId})`);
  return bot;
}

// cli_patch_marker_25chars
