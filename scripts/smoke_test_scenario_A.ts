import { randomUUID } from 'crypto';
import path from 'path';
import Database from 'better-sqlite3';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const endpoint = `${baseUrl}/api/swarm/insights`;
const createTaskEndpoint = `${baseUrl}/api/swarm/tasks`;
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');

type TaskCreateResponse = {
  id?: string;
  task_id?: string;
  status?: string;
};

type InsighPostResponse = {
  success: boolean;
  insight_id?: string;
};

async function createParentTask(): Promise<string> {
  const uniqueTag = randomUUID();
  const res = await fetch(createTaskEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `Smoke Task - Scenario A ${new Date().toISOString()} ${uniqueTag}`,
      description: 'Dry-run task for GRO smoke test',
      ws: 'default',
      priority: 'normal',
      assigned_agent_id: 'MC-MAIN',
      execution_order: 0,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to create task: HTTP ${res.status} ${text}`);
  }

  const json = JSON.parse(text) as TaskCreateResponse;
  const taskId = json.id || json.task_id;
  if (!taskId) {
    throw new Error(`Task response missing id; payload=${text}`);
  }
  return taskId;
}

async function postInsight(parentTaskId: string): Promise<string> {
  const payload = {
    version: 'v2',
    task_id: parentTaskId,
    parent_task_id: parentTaskId,
    agent_id: 'dc_deep_researcher',
    status: 'blocked',
    claim: 'Grid capacity delayed by 18 months',
    evidence_refs: [
      {
        type: 'file',
        ref: 'tests/fixtures/finance-grid-delay-mock.md',
        snippet: 'Assumed mock evidence for smoke test scenario A',
        timestamp: new Date().toISOString(),
      },
    ],
    impact: 'CapEx schedule risk increases due infrastructure timing shift.',
    suggested_next_tasks: [
      {
        owner: 'shared_planner_architect',
        task: 'Create revised CapEx timeline mitigation options',
        why: 'Need revised schedule and fallback options under 18-month delay scenario',
      },
    ],
    affected_tasks: [parentTaskId],
    severity: 'S2',
    deliverables: ['outcomes/scenario-A/mock-insight.json'],
    open_questions: ['Which downstream regions are affected by permit delay assumptions?'],
    generated_at: new Date().toISOString(),
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log(`insights endpoint status=${res.status}`);
  console.log(`insights response=${text}`);

  if (!res.ok) {
    throw new Error(`Insight post failed: HTTP ${res.status} ${text}`);
  }

  const json = JSON.parse(text) as InsighPostResponse;
  if (!json.success || !json.insight_id) {
    throw new Error(`Malformed response: ${text}`);
  }
  return json.insight_id;
}

function queryInterruptCount(taskId: string): number {
  const db = new Database(dbPath);
  try {
    const row = (db.prepare('SELECT task_id, interrupt_count FROM swarm_tasks WHERE task_id = ?') as any).get(taskId);
    if (!row || row.interrupt_count == null) return 0;
    return Number(row.interrupt_count);
  } finally {
    db.close();
  }
}

function queryLatestInsightForTask(taskId: string, claim: string): string | null {
  const db = new Database(dbPath);
  try {
    const row = (db.prepare(
      `SELECT insight_id
       FROM swarm_insights
       WHERE parent_task_id = ? AND claim = ?
       ORDER BY rowid DESC
       LIMIT 1`
    ) as any).get(taskId, claim);
    return row?.insight_id || null;
  } finally {
    db.close();
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const parentTaskId = await createParentTask();
    const before = queryInterruptCount(parentTaskId);
    console.log(`interrupt_count before=${before}`);

    const insightId = await postInsight(parentTaskId);
    const recorded = queryLatestInsightForTask(parentTaskId, 'Grid capacity delayed by 18 months');
    console.log(`SMOKE_POST_OK insight_id=${insightId}, db_insight=${recorded}`);

    if (!recorded || recorded !== insightId) {
      throw new Error('Insight insertion verification failed');
    }

    await sleep(3000);

    const after = queryInterruptCount(parentTaskId);
    console.log(`interrupt_count after=${after}`);

    if (after !== before + 1) {
      throw new Error(`Replan counter mismatch: expected ${before + 1}, got ${after}`);
    }

    console.log('SMOKE_A_VERIFY_OK interrupt_count incremented');
    console.log('Scenario A completed successfully');
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error('Smoke test failed:', err.message);
      if (err.name === 'AbortError') {
        console.error('Request timed out after 30s');
      }
    } else {
      console.error('Smoke test failed with unknown error');
    }
    process.exitCode = 1;
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
}

void main();
