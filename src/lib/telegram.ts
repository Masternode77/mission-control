export async function sendTelegramMessage(params: {
  text: string;
  chatId?: string | number;
  parseMode?: 'MarkdownV2' | 'HTML';
}): Promise<Response | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const fallbackChatId = process.env.TELEGRAM_CHAT_ID;
  const chatId = params.chatId ?? fallbackChatId;
  if (!token || !chatId) return null;

  const payload: any = {
    chat_id: chatId,
    text: params.text,
    disable_web_page_preview: true,
  };

  if (params.parseMode) payload.parse_mode = params.parseMode;

  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function sendTelegramReply(params: {
  chatId: string | number;
  text: string;
  replyToMessageId?: number;
  parseMode?: 'MarkdownV2' | 'HTML';
}): Promise<Response | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const payload: any = {
    chat_id: params.chatId,
    text: params.text,
    disable_web_page_preview: true,
  };

  if (params.replyToMessageId) {
    payload.reply_parameters = { message_id: params.replyToMessageId };
  }

  if (params.parseMode) payload.parse_mode = params.parseMode;

  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function buildHitlTelegramSummary(taskId: string, title: string, draft: string) {
  const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
  const core = lines.slice(0, 3).map((l) => `• ${l}`).join('\n') || '• 요약 없음';

  const riskLine = lines.find((l) => /risk|리스크/i.test(l)) || '리스크: 확인 필요';
  const altLine = lines.find((l) => /alternative|대안/i.test(l)) || '대안: 추가 검토 필요';

  return [
    `🟠 HITL 승인 대기`,
    `Task: ${taskId}`,
    `제목: ${title}`,
    '',
    '[핵심 3줄 요약]',
    core,
    '',
    '[리스크/대안]',
    `${riskLine}`,
    `${altLine}`,
  ].join('\n');
}

export async function sendEmergencyHITLRequest(
  parentTaskId: string,
  reason: string,
  payload: { agent_id?: string; [key: string]: unknown }
): Promise<Response | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const masterChatId = process.env.TELEGRAM_MASTER_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  if (!token || !masterChatId) return null;

  const payloadLine = JSON.stringify(payload);
  const text = [
    '🚨 [시스템 긴급 중지: HITL 승인 필요]',
    `🔹 Task ID: ${parentTaskId}`,
    `🔹 차단 사유: ${reason}`,
    `🔹 발신 에이전트: ${payload.agent_id || 'unknown'}`,
    '⚠️ 조치: 즉각적인 수동 개입 및 DAG 재배선 승인 요망',
    '',
    '📌 Audit Bundle:',
    payloadLine.slice(0, 1200),
  ].join('\n');

  return sendTelegramMessage({
    chatId: masterChatId,
    text,
    parseMode: 'HTML',
  });
}
