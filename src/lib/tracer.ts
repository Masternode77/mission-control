import { createHash } from 'crypto';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

type SpanType = 'llm_call' | 'tool_call' | 'hitl_gate' | 'synthesis';

type TraceMeta = Record<string, unknown> & {
  token_source?: 'exact' | 'estimated' | string;
  token_estimated?: boolean;
};

type SpanLog = {
  span_type: SpanType;
  task_id: string;
  run_id: string;
  trace_id: string;
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
  meta: TraceMeta;
  logged_at: string;
};

interface TraceSpanInput {
  spanType: SpanType;
  spanName?: string;
  model?: string;
  toolName?: string;
  toolArguments?: unknown;
  approver?: string;
  success?: boolean;
  costTokens?: number;
  latencyMs?: number;
  startedAt?: string;
  endedAt?: string;
  hitlStartedAt?: string;
  hitlEndedAt?: string;
  metadata?: TraceMeta;
}

interface TraceLogger {
  readonly traceId: string;
  readonly taskId: string;
  readonly runId: string;
  logSpan(entry: TraceSpanInput): void;
}

function nowIso() {
  return new Date().toISOString();
}

function stableStringify(value: unknown): string {
  const seen = new Set<unknown>();

  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }

    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = walk(source[key]);
    }
    return out;
  };

  return JSON.stringify(walk(value));
}

function hashValue(value: unknown): string {
  const json = stableStringify(value ?? '');
  return createHash('sha256').update(json).digest('hex');
}

function normalizeModel(model?: string | null): string {
  return String(model || 'unknown').trim() || 'unknown';
}

function normalizeStartedAt(startedAt?: string, fallback?: string): string | undefined {
  if (startedAt) return startedAt;
  if (fallback) return fallback;
  return undefined;
}

function buildJsonlRow(entry: {
  taskId: string;
  runId: string;
  traceId: string;
  spanType: SpanType;
  spanName?: string;
  model?: string;
  toolName?: string;
  argsHash?: string;
  approver?: string;
  success?: boolean;
  latencyMs?: number;
  costTokens?: number;
  startedAt?: string;
  endedAt?: string;
  hitlStartedAt?: string;
  hitlEndedAt?: string;
  meta?: TraceMeta;
}): SpanLog {
  return {
    trace_id: entry.traceId,
    task_id: entry.taskId,
    run_id: entry.runId,
    span_type: entry.spanType,
    span_name: entry.spanName || null,
    model: entry.model || null,
    tool_name: entry.toolName || null,
    args_hash: entry.argsHash || null,
    approver: entry.approver || null,
    success: entry.success ?? null,
    latency_ms: entry.latencyMs ?? null,
    cost_tokens: entry.costTokens ?? null,
    started_at: entry.startedAt || null,
    ended_at: entry.endedAt || null,
    hitl_started_at: entry.hitlStartedAt || null,
    hitl_ended_at: entry.hitlEndedAt || null,
    meta: entry.meta || {},
    logged_at: nowIso(),
  };
}

export function createSwarmTracer(taskId: string, runId: string): TraceLogger {
  const traceId = createHash('sha256').update(`${taskId}|${runId}`).digest('hex');
  const logPath = 'logs/swarm-traces.jsonl';
  mkdirSync(dirname(logPath), { recursive: true });

  return {
    traceId,
    taskId,
    runId,
    logSpan({ spanType, spanName, model, toolName, toolArguments, approver, success, costTokens, latencyMs, startedAt, endedAt, hitlStartedAt, hitlEndedAt, metadata }) {
      const end = endedAt || nowIso();
      const started = normalizeStartedAt(startedAt, hitlStartedAt || undefined);
      const effectiveLatency = typeof latencyMs === 'number' ? latencyMs : (started ? Math.max(0, Date.parse(end) - Date.parse(started)) : null);

      const row = buildJsonlRow({
        taskId,
        runId,
        traceId,
        spanType,
        spanName,
        model: normalizeModel(model),
        toolName,
        argsHash: toolArguments !== undefined ? hashValue(toolArguments) : undefined,
        approver,
        success,
        latencyMs: effectiveLatency ?? undefined,
        costTokens,
        startedAt: started,
        endedAt: end,
        hitlStartedAt,
        hitlEndedAt,
        meta: {
          ...(metadata || {}),
          duration_ms: effectiveLatency,
        },
      });

      appendFileSync(logPath, `${JSON.stringify(row)}\n`, 'utf8');
    },
  };
}

export type { TraceLogger, SpanType, SpanLog };
