type WebhookChannel = 'telegram' | 'slack';

type Status = 'completed' | 'hitl_review' | 'in_execution' | string;

export type TaskWebhookNotification = {
  taskId: string;
  title: string;
  status: Status;
  previousStatus?: Status;
  approvalId?: string;
  reviewerNote?: string;
  source: 'task_patch' | 'simulate_complete' | 'hitl_approve' | 'hitl_reject';
};

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

function buildPayload(channel: WebhookChannel, payload: TaskWebhookNotification) {
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

  return {
    event: 'mission_control.task.status_changed',
    payload: {
      ...payload,
      actions,
    },
    text: [
      '🔔 Mission Control Update',
      `Task: ${payload.taskId}`,
      `Title: ${payload.title}`,
      `Status: ${payload.status}${payload.previousStatus ? ` (from ${payload.previousStatus})` : ''}`,
      ...(payload.reviewerNote ? [`Reviewer note: ${payload.reviewerNote}`] : []),
      ...(actions ? [`Approve: ${actions.approve}`, `Reject: ${actions.reject}`] : []),
    ].join('\n'),
  };
}

async function postWebhook(channel: WebhookChannel, payload: TaskWebhookNotification): Promise<void> {
  const url = readWebhookUrl(channel);
  if (!url) return;

  const body = buildPayload(channel, payload);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`${channel}_webhook_failed status=${response.status} body=${details.slice(0, 400)}`);
  }
}

export async function sendTaskStatusWebhooks(payload: TaskWebhookNotification): Promise<void> {
  await Promise.allSettled([
    postWebhook('telegram', payload),
    postWebhook('slack', payload),
  ]);
}
