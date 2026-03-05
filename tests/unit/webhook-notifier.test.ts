import test from 'node:test';
import assert from 'node:assert/strict';

import { sendTaskStatusWebhooks } from '../../src/lib/webhook-notifier';

test('sends notifications to both telegram/slack webhooks when configured', async () => {
  const oldFetch = global.fetch;
  const oldTelegram = process.env.TELEGRAM_NOTIFICATIONS_WEBHOOK_URL;
  const oldSlack = process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL;
  const oldBase = process.env.MISSION_CONTROL_BASE_URL;

  const calls: Array<{ url: string; body: any }> = [];
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;

  process.env.TELEGRAM_NOTIFICATIONS_WEBHOOK_URL = 'https://telegram.local/webhook';
  process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL = 'https://hooks.slack.com/services/test/path';
  process.env.MISSION_CONTROL_BASE_URL = 'https://mission.local';

  try {
    await sendTaskStatusWebhooks({
      taskId: 'task-1',
      title: 'Demo task',
      status: 'hitl_review',
      previousStatus: 'in_execution',
      approvalId: 'approval-1',
      source: 'simulate_complete',
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://telegram.local/webhook');
    assert.equal(calls[1]?.url, 'https://hooks.slack.com/services/test/path');
    assert.match(calls[0]?.body?.text, /Approve: https:\/\/mission.local\/api\/swarm\/approvals\/approval-1\/approve/);
    assert.equal(calls[1]?.body?.metadata?.event_payload?.taskId, 'task-1');
  } finally {
    global.fetch = oldFetch;
    process.env.TELEGRAM_NOTIFICATIONS_WEBHOOK_URL = oldTelegram;
    process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL = oldSlack;
    process.env.MISSION_CONTROL_BASE_URL = oldBase;
  }
});

test('no webhook calls when URLs are not configured', async () => {
  const oldFetch = global.fetch;
  const oldTelegram = process.env.TELEGRAM_NOTIFICATIONS_WEBHOOK_URL;
  const oldSlack = process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL;

  let callCount = 0;
  global.fetch = (async () => {
    callCount += 1;
    return new Response('ok', { status: 200 });
  }) as typeof fetch;

  delete process.env.TELEGRAM_NOTIFICATIONS_WEBHOOK_URL;
  delete process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL;

  try {
    await sendTaskStatusWebhooks({
      taskId: 'task-2',
      title: 'No-op',
      status: 'completed',
      source: 'hitl_approve',
    });

    assert.equal(callCount, 0);
  } finally {
    global.fetch = oldFetch;
    process.env.TELEGRAM_NOTIFICATIONS_WEBHOOK_URL = oldTelegram;
    process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL = oldSlack;
  }
});
