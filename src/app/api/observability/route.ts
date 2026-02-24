import { NextResponse } from 'next/server';
import { createReadStream, promises as fs } from 'fs';
import { createInterface } from 'readline';
import path from 'path';

export const dynamic = 'force-dynamic';

type SpanType = 'llm_call' | 'tool_call' | 'hitl_gate' | 'synthesis';

type TraceRow = {
  trace_id: string;
  task_id: string;
  run_id: string;
  span_type: SpanType;
  span_name: string | null;
  model: string | null;
  tool_name: string | null;
  args_hash: string | null;
  approver: string | null;
  success: boolean | null;
  latency_ms: number | null;
  cost_tokens: number | null;
  started_at: string | null;
  ended_at: string | null;
  hitl_started_at: string | null;
  hitl_ended_at: string | null;
  logged_at: string;
  meta?: Record<string, unknown>;
};

type TokenAgg = {
  key: string;
  label: string;
  cost_tokens: number;
  entry_count: number;
  by_span_type: Record<SpanType, number>;
  meta: {
    sample_models: Record<string, number>;
    sample_span_names: Record<string, number>;
  };
};

type ErrorRatePoint = {
  bucket: string;
  period: 'hour' | 'day';
  total: number;
  failed: number;
  failureRate: number;
  failRate: number;
  successRate: number;
  successCount: number;
};

function isTraceRow(value: unknown): value is TraceRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trace_id === 'string' &&
    typeof row.task_id === 'string' &&
    typeof row.run_id === 'string' &&
    typeof row.span_type === 'string' &&
    typeof row.logged_at === 'string'
  );
}

function parseTimestamp(row: TraceRow): string | null {
  const candidates = [row.logged_at, row.ended_at, row.started_at, row.hitl_ended_at, row.hitl_started_at];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    const time = Date.parse(candidate);
    if (!Number.isNaN(time)) return new Date(time).toISOString();
  }
  return null;
}

function hourBucket(ts: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${dd} ${h}:00`;
}

function dayBucket(ts: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function normalizeLabel(row: TraceRow): string {
  if (row.span_name && row.span_name.trim()) return row.span_name.trim();
  if (row.model && row.model.trim()) return row.model.trim();
  if (row.tool_name && row.tool_name.trim()) return row.tool_name.trim();
  return 'unknown';
}

function incTokenAgg(map: Map<string, TokenAgg>, row: TraceRow) {
  const key = normalizeLabel(row);
  const existing = map.get(key);
  const cost = Number(row.cost_tokens ?? 0);

  if (!existing) {
    map.set(key, {
      key,
      label: key,
      cost_tokens: 0,
      entry_count: 0,
      by_span_type: {
        llm_call: 0,
        tool_call: 0,
        hitl_gate: 0,
        synthesis: 0,
      },
      meta: {
        sample_models: {},
        sample_span_names: {},
      },
    });
  }

  const item = map.get(key);
  if (!item) return;

  item.entry_count += 1;
  item.cost_tokens += Number.isFinite(cost) ? cost : 0;
  item.by_span_type[row.span_type] += 1;
  if (row.model && row.model.trim()) {
    item.meta.sample_models[row.model.trim()] = (item.meta.sample_models[row.model.trim()] || 0) + 1;
  }
  if (row.span_name && row.span_name.trim()) {
    item.meta.sample_span_names[row.span_name.trim()] = (item.meta.sample_span_names[row.span_name.trim()] || 0) + 1;
  }
}

async function readTraceRows(tracePath: string): Promise<TraceRow[]> {
  try {
    await fs.access(tracePath);
  } catch {
    return [];
  }

  return new Promise((resolve, reject) => {
    const rows: TraceRow[] = [];
    const rs = createReadStream(tracePath, { encoding: 'utf8' });
    const rl = createInterface({ input: rs, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const text = String(line || '').trim();
      if (!text) return;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (isTraceRow(parsed)) rows.push(parsed);
      } catch {
        // ignore malformed lines
      }
    });

    rl.on('close', () => resolve(rows));
    rl.on('error', reject);
  });
}

function buildMetrics(rows: TraceRow[]) {
  const tokenBuckets = new Map<string, TokenAgg>();
  const hourly = new Map<string, { total: number; failed: number }>();
  const daily = new Map<string, { total: number; failed: number }>();

  for (const row of rows) {
    incTokenAgg(tokenBuckets, row);

    const ts = parseTimestamp(row);
    if (!ts) continue;

    const isFailure = row.success === false;
    const hour = hourBucket(ts);
    const day = dayBucket(ts);

    const hourState = hourly.get(hour) || { total: 0, failed: 0 };
    const dayState = daily.get(day) || { total: 0, failed: 0 };

    hourState.total += 1;
    dayState.total += 1;
    if (isFailure) {
      hourState.failed += 1;
      dayState.failed += 1;
    }

    hourly.set(hour, hourState);
    daily.set(day, dayState);
  }

  const tokenRows = Array.from(tokenBuckets.values()).sort((a, b) => b.cost_tokens - a.cost_tokens);

  const toErrorSeries = (entries: [string, { total: number; failed: number }][], period: 'hour' | 'day'): ErrorRatePoint[] =>
    entries
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, value]) => {
        const failRate = value.total > 0 ? value.failed / value.total : 0;
        return {
          bucket,
          period,
          total: value.total,
          failed: value.failed,
          failureRate: failRate,
          failRate,
          successRate: 1 - failRate,
          successCount: value.total - value.failed,
        };
      });

  const totalSpans = rows.length || 1;
  const failed = rows.reduce((acc, row) => acc + (row.success === false ? 1 : 0), 0);

  return {
    aggregate: {
      tokenUsageByEntity: tokenRows,
      totalSpanCount: rows.length,
      totalFailedSpanCount: failed,
      globalErrorRate: failed / totalSpans,
    },
    timelines: {
      hourly: toErrorSeries(Array.from(hourly.entries()), 'hour'),
      day: toErrorSeries(Array.from(daily.entries()), 'day'),
    },
  };
}

export async function GET() {
  const tracePath = path.join(process.cwd(), 'logs', 'swarm-traces.jsonl');
  const rows = await readTraceRows(tracePath);
  return NextResponse.json(buildMetrics(rows));
}
