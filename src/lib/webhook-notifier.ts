type WebhookChannel = 'telegram' | 'slack';

type Status = 'completed' | 'hitl_review' | 'in_execution' | string;

type FailureTag = 'auth' | 'rate-limit' | 'schema' | 'tool' | 'runtime' | 'delivery';

type CircuitState = {
  workflowName: string;
  consecutiveFailures: number;
  recent: Array<{ ok: boolean; atMs: number; tag?: FailureTag }>;
  openedAtMs?: number;
  halfOpen: boolean;
};

export type TaskWebhookNotification = {
  taskId: string;
  title: string;
  status: Status;
  previousStatus?: Status;
  approvalId?: string;
  reviewerNote?: string;
  source: 'task_patch' | 'simulate_complete' | 'hitl_approve' | 'hitl_reject';
};

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;
const CIRCUIT_OPEN_MS = 10 * 60 * 1000;
const CIRCUIT_WINDOW_SIZE = 8;
const CIRCUIT_ERROR_RATE_THRESHOLD = 0.25;
const CIRCUIT_CONSECUTIVE_THRESHOLD = 2;

const circuitStates = new Map<string, CircuitState>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitterDelay(attempt: number): number {
  const exp = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp * 0.3)));
  return Math.min(RETRY_MAX_DELAY_MS, exp + jitter);
}

function readWebhookUrl(channel: WebhookChannel): string | null {
  const url = channel === 'telegram'
    ? process.env.TELEGRAM_NOTIFICATIONS_WEBHOOK_URL
    : process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function buildActionUrls(approvalId?: string) {
  const base = process.env.MISSION_CONTROL_BASE_URL;
  if (!approvalId || !base) return null;
  const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
  return {
    approve: `${normalized}/api/swarm/approvals/${approvalId}/approve`,
    reject: `${normalized}/api/swarm/approvals/${approvalId}/reject`,
  };
}

function isTelegramSendMessageEndpoint(url: string): boolean {
  return /api\.telegram\.org\/bot[^/]+\/sendMessage$/i.test(url.trim());
}

function resolveTelegramChatId(): string | null {
  const candidates = [
    process.env.TELEGRAM_NOTIFICATIONS_CHAT_ID,
    process.env.DEFAULT_TELEGRAM_CHAT_ID,
    process.env.TELEGRAM_MASTER_CHAT_ID,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function buildPayload(channel: WebhookChannel, payload: TaskWebhookNotification, targetUrl?: string) {
  const actions = buildActionUrls(payload.approvalId);

  if (channel === 'slack') {
    return {
      text: `Mission Control task update: ${payload.taskId} → ${payload.status}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Mission Control Update*\n• *Task:* ${payload.taskId}\n• *Title:* ${payload.title}\n• *Status:* ${payload.status}${payload.previousStatus ? ` (from ${payload.previousStatus})` : ''}`,
          },
        },
        ...(payload.reviewerNote ? [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Reviewer note:* ${payload.reviewerNote}`,
          },
        }] : []),
        ...(actions ? [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*HITL Actions*\nApprove: ${actions.approve}\nReject: ${actions.reject}`,
          },
        }] : []),
      ],
      metadata: {
        event_type: 'mission_control.task.status_changed',
        event_payload: payload,
      },
    };
  }

  const text = [
    '🔔 Mission Control Update',
    `Task: ${payload.taskId}`,
    `Title: ${payload.title}`,
    `Status: ${payload.status}${payload.previousStatus ? ` (from ${payload.previousStatus})` : ''}`,
    ...(payload.reviewerNote ? [`Reviewer note: ${payload.reviewerNote}`] : []),
    ...(actions ? [`Approve: ${actions.approve}`, `Reject: ${actions.reject}`] : []),
  ].join('\n');

  if (channel === 'telegram' && targetUrl && isTelegramSendMessageEndpoint(targetUrl)) {
    const chatId = resolveTelegramChatId();
    if (!chatId) {
      throw new Error('telegram_webhook_failed missing_chat_id (set TELEGRAM_NOTIFICATIONS_CHAT_ID or DEFAULT_TELEGRAM_CHAT_ID)');
    }
    return {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
  }

  return {
    event: 'mission_control.task.status_changed',
    payload: {
      ...payload,
      actions,
    },
    text,
  };
}

function classifyFailureTag(errorLike: unknown): FailureTag {
  const text = String(errorLike || '').toLowerCase();
  if (/(401|403|unauthorized|forbidden|auth|token|permission)/i.test(text)) return 'auth';
  if (/(429|rate limit|too many requests|throttle)/i.test(text)) return 'rate-limit';
  if (/(schema|validation|invalid json|parse|payload)/i.test(text)) return 'schema';
  if (/(tool|executor|dependency|module not found)/i.test(text)) return 'tool';
  if (/(timeout|econn|enotfound|network|fetch failed|socket)/i.test(text)) return 'runtime';
  return 'delivery';
}

function getCircuitState(workflowName: string): CircuitState {
  const key = workflowName || 'unknown-workflow';
  const existing = circuitStates.get(key);
  if (existing) return existing;
  const created: CircuitState = {
    workflowName: key,
    consecutiveFailures: 0,
    recent: [],
    halfOpen: false,
  };
  circuitStates.set(key, created);
  return created;
}

function shouldOpenCircuit(state: CircuitState): boolean {
  if (state.consecutiveFailures >= CIRCUIT_CONSECUTIVE_THRESHOLD) return true;
  const total = state.recent.length;
  if (total < 4) return false;
  const failures = state.recent.filter((r) => !r.ok).length;
  return failures / total > CIRCUIT_ERROR_RATE_THRESHOLD;
}

function markAttempt(state: CircuitState, ok: boolean, tag?: FailureTag) {
  state.recent.push({ ok, atMs: Date.now(), tag });
  if (state.recent.length > CIRCUIT_WINDOW_SIZE) {
    state.recent.splice(0, state.recent.length - CIRCUIT_WINDOW_SIZE);
  }
  if (ok) {
    state.consecutiveFailures = 0;
    if (state.halfOpen) {
      state.halfOpen = false;
      state.openedAtMs = undefined;
    }
    return;
  }
  state.consecutiveFailures += 1;
}

async function sendCircuitAlertToTelegram(workflowName: string, tag: FailureTag) {
  const url = readWebhookUrl('telegram');
  if (!url) return;
  const message = `[경보] 잡 이름: ${workflowName} 연속 에러 발생. 분류: ${tag}. 서킷 브레이커 작동으로 10분 후 재시도 예정.`;

  let body: Record<string, unknown>;
  if (isTelegramSendMessageEndpoint(url)) {
    const chatId = resolveTelegramChatId();
    if (!chatId) {
      throw new Error('telegram_webhook_failed missing_chat_id for circuit alert');
    }
    body = {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    };
  } else {
    body = {
      event: 'mission_control.workflow.circuit_open',
      text: message,
      payload: {
        workflowName,
        failureTag: tag,
        halfOpenInMs: CIRCUIT_OPEN_MS,
      },
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const details = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`telegram_circuit_alert_failed status=${response.status} body=${details.slice(0, 400)}`);
  }
}

function evaluateCircuitForWorkflow(workflowName: string) {
  const state = getCircuitState(workflowName);
  if (!state.openedAtMs) return { allowed: true, state };

  const elapsed = Date.now() - state.openedAtMs;
  if (elapsed >= CIRCUIT_OPEN_MS) {
    state.halfOpen = true;
    return { allowed: true, state };
  }

  return { allowed: false, state };
}

async function postWebhook(channel: WebhookChannel, payload: TaskWebhookNotification): Promise<void> {
  const url = readWebhookUrl(channel);
  if (!url) return;

  const workflowName = payload.title || payload.taskId || 'unknown-workflow';
  const gate = evaluateCircuitForWorkflow(workflowName);
  if (!gate.allowed) {
    throw new Error(`circuit_open workflow=${workflowName}`);
  }

  const body = buildPayload(channel, payload, url);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const details = await response.text().catch(() => '');

      if (!response.ok) {
        throw new Error(`${channel}_webhook_failed status=${response.status} body=${details.slice(0, 400)}`);
      }

      if (channel === 'telegram' && isTelegramSendMessageEndpoint(url)) {
        try {
          const parsed = details ? JSON.parse(details) : null;
          if (parsed && (parsed as Record<string, unknown>).ok === false) {
            throw new Error(`${channel}_webhook_failed telegram_ok_false body=${details.slice(0, 400)}`);
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new Error(`${channel}_webhook_failed invalid_telegram_json body=${details.slice(0, 400)}`);
          }
          throw error;
        }
      }

      markAttempt(gate.state, true);
      return;
    } catch (error) {
      lastError = error;
      const tag = classifyFailureTag(error);
      markAttempt(gate.state, false, tag);

      const criticalTag = tag === 'auth' || tag === 'schema';
      const openNow = shouldOpenCircuit(gate.state);
      if (openNow && !gate.state.openedAtMs) {
        gate.state.openedAtMs = Date.now();
        gate.state.halfOpen = false;
      }

      if (criticalTag || openNow) {
        try {
          await sendCircuitAlertToTelegram(workflowName, tag);
        } catch (alertError) {
          console.error('[webhook-notifier] telegram RCA delivery failed:', alertError);
        }
      }

      if (attempt < RETRY_MAX_ATTEMPTS) {
        await sleep(withJitterDelay(attempt));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'webhook_failed'));
}

export async function sendTaskStatusWebhooks(payload: TaskWebhookNotification): Promise<void> {
  const results = await Promise.allSettled([
    postWebhook('telegram', payload),
    postWebhook('slack', payload),
  ]);

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const channel = index === 0 ? 'telegram' : 'slack';
      console.error(`[webhook-notifier] ${channel} delivery failed:`, result.reason);
    }
  });
}
