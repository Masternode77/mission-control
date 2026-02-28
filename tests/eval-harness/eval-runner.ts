import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { createSwarmTracer } from '../../src/lib/tracer';

type SpanType = 'llm_call' | 'tool_call' | 'hitl_gate' | 'synthesis';

type ScenarioExpectation = {
  expectLlm: boolean;
  requireToolCall: boolean;
  requireSynthesis: boolean;
  requireHitlGate: boolean;
  expectSynthesisSuccess?: boolean;
  maxLatencyMs?: number;
  toolMinCount?: number;
  mustBeMaster?: boolean;
};

type Scenario = {
  id: string;
  name: string;
  description: string;
  taskId: string;
  runId: string;
  expectation: ScenarioExpectation;
};

type ScenarioFile = {
  version: string;
  defaults: {
    traceFile: string;
    maxLatencyMs: number;
    requireHitlGate: boolean;
  };
  scenarios: Scenario[];
};

type TraceEntry = {
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
  meta: Record<string, unknown>;
  logged_at: string;
};

type ScenarioGrade = {
  id: string;
  name: string;
  pass: boolean;
  checks: { label: string; pass: boolean; detail: string }[];
  summary: {
    llmCount: number;
    toolCount: number;
    synthesisCount: number;
    hitlGateCount: number;
    maxObservedLatencyMs: number;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): { dryRun: boolean; traceFile: string } {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run') || !argv.includes('--no-dry-run');
  const fileIndex = argv.findIndex((arg) => arg === '--trace-file');
  const traceFile =
    fileIndex >= 0 && argv[fileIndex + 1]
      ? argv[fileIndex + 1]
      : 'logs/swarm-traces.jsonl';

  return { dryRun, traceFile };
}

async function readScenarios(filePath: string): Promise<ScenarioFile> {
  const raw = await import('fs/promises').then((m) => m.readFile(filePath, 'utf8'));
  const data = JSON.parse(raw) as ScenarioFile;
  return data;
}

async function readExistingTraces(traceFile: string): Promise<TraceEntry[]> {
  if (!existsSync(traceFile)) return [];

  return new Promise((resolve, reject) => {
    const readStream = createReadStream(traceFile, { encoding: 'utf8' });
    const rl = createInterface({ input: readStream, crlfDelay: Infinity });
    const entries: TraceEntry[] = [];

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        entries.push(JSON.parse(trimmed) as TraceEntry);
      } catch {
        // ignore malformed line
      }
    });

    rl.on('close', () => resolve(entries));
    rl.on('error', (err) => reject(err));
  });
}

async function runDryScenario(scenario: Scenario, defaults: ScenarioFile['defaults'], traceFile: string): Promise<void> {
  // Ensure folder exists.
  mkdirSync(path.dirname(traceFile), { recursive: true });

  const tracer = createSwarmTracer(scenario.taskId, scenario.runId);
  const now = Date.now();

  if (scenario.expectation.expectLlm) {
    const start = new Date().toISOString();
    await sleep(12 + Math.random() * 30);
    tracer.logSpan({
      spanType: 'llm_call',
      spanName: 'chat.send.initial',
      model: 'openai/gpt-4o-mini',
      success: true,
      startedAt: start,
      endedAt: new Date().toISOString(),
      latencyMs: Math.max(1, Date.now() - now),
      metadata: { mode: 'dry-run', scenario: scenario.id },
    });
  }

  if (scenario.expectation.requireToolCall) {
    const toolCalls = Math.max(1, scenario.expectation.toolMinCount || 1);
    for (let i = 0; i < toolCalls; i += 1) {
      const startAt = new Date().toISOString();
      await sleep(15);
      tracer.logSpan({
        spanType: 'tool_call',
        spanName: `dry-run-tool-${i + 1}`,
        toolName: `tool_${i + 1}`,
        toolArguments: { i, scenario: scenario.id },
        success: true,
        startedAt: startAt,
        endedAt: new Date().toISOString(),
        latencyMs: 15 + Math.floor(Math.random() * 20),
        metadata: { mode: 'dry-run', tool_index: i },
      });
    }
  }

  await sleep(20);

  const synthesisPass = scenario.expectation.expectSynthesisSuccess !== false;
  tracer.logSpan({
    spanType: 'synthesis',
    spanName: scenario.name,
    model: scenario.expectation.mustBeMaster ? 'master-model' : 'worker-model',
    success: synthesisPass,
    latencyMs: 40,
    startedAt: new Date(Date.now() - 120).toISOString(),
    endedAt: new Date().toISOString(),
    metadata: {
      mode: 'dry-run',
      must_be_master: scenario.expectation.mustBeMaster ?? false,
      scenario: scenario.id,
      failed: synthesisPass ? 0 : 1,
    },
  });

  if (scenario.expectation.requireHitlGate) {
    await sleep(5);
    tracer.logSpan({
      spanType: 'hitl_gate',
      spanName: 'execution_to_hitl_review',
      approver: 'pending',
      success: true,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      metadata: {
        mode: 'dry-run',
        scenario: scenario.id,
        gate: 'review_wait',
      },
    });
  }
}

function gradeScenario(scenario: Scenario, entries: TraceEntry[], defaults: ScenarioFile['defaults']): ScenarioGrade {
  const relevant = entries.filter((e) => e.task_id === scenario.taskId && e.run_id === scenario.runId);
  const maxLatencyMs = scenario.expectation.maxLatencyMs ?? defaults.maxLatencyMs;
  const checks: ScenarioGrade['checks'] = [];

  const llmCount = relevant.filter((entry) => entry.span_type === 'llm_call').length;
  const toolCount = relevant.filter((entry) => entry.span_type === 'tool_call').length;
  const synthesisEntries = relevant.filter((entry) => entry.span_type === 'synthesis');
  const hitlCount = relevant.filter((entry) => entry.span_type === 'hitl_gate').length;
  const maxObservedLatencyMs = relevant.reduce((acc, entry) => {
    const value = typeof entry.latency_ms === 'number' ? entry.latency_ms : Number.MAX_SAFE_INTEGER;
    return Math.max(acc, value);
  }, 0);

  const expectSynthesisSuccess = scenario.expectation.expectSynthesisSuccess;
  const lastSynthesis = synthesisEntries.at(-1);

  const check = (label: string, pass: boolean, detail: string) => {
    checks.push({ label, pass, detail });
  };

  check(
    'LLM span exists',
    !scenario.expectation.expectLlm || llmCount > 0,
    `llm_spans=${llmCount}`,
  );

  check(
    'Tool call count',
    !scenario.expectation.requireToolCall || toolCount >= (scenario.expectation.toolMinCount || 1),
    scenario.expectation.requireToolCall
      ? `tool_spans=${toolCount}, required=${scenario.expectation.toolMinCount || 1}`
      : `tool_spans=${toolCount}`,
  );

  check(
    'Synthesis span exists',
    !scenario.expectation.requireSynthesis || synthesisEntries.length > 0,
    `synthesis_spans=${synthesisEntries.length}`,
  );

  check(
    'Synthesis success',
    expectSynthesisSuccess === undefined ? true : expectSynthesisSuccess ? lastSynthesis?.success === true : lastSynthesis?.success === false,
    `last_synthesis_success=${String(lastSynthesis?.success ?? null)}`,
  );

  check(
    'HITL gate exists',
    !scenario.expectation.requireHitlGate || hitlCount > 0,
    `hitl_gate_spans=${hitlCount}`,
  );

  check(
    `Latency <= ${maxLatencyMs}ms`,
    relevant.every((span) => typeof span.latency_ms === 'number' && span.latency_ms <= maxLatencyMs),
    `max_observed_latency_ms=${maxObservedLatencyMs}`,
  );

  const pass = checks.every((c) => c.pass);

  return {
    id: scenario.id,
    name: scenario.name,
    pass,
    checks,
    summary: {
      llmCount,
      toolCount,
      synthesisCount: synthesisEntries.length,
      hitlGateCount: hitlCount,
      maxObservedLatencyMs,
    },
  };
}

function printReport(grades: ScenarioGrade[]): void {
  const passCount = grades.filter((g) => g.pass).length;
  console.log('\n=== Eval Harness Report ===');
  console.log(`총 시나리오: ${grades.length}, 통과: ${passCount}, 실패: ${grades.length - passCount}`);
  for (const grade of grades) {
    console.log(`\n[${grade.pass ? 'PASS' : 'FAIL'}] ${grade.name} (${grade.id})`);
    for (const check of grade.checks) {
      console.log(`  - ${check.pass ? '✓' : '✗'} ${check.label}: ${check.detail}`);
    }
    console.log(
      `  - Summary: llm=${grade.summary.llmCount}, tool=${grade.summary.toolCount}, synthesis=${grade.summary.synthesisCount}, hitl=${grade.summary.hitlGateCount}, maxLatency=${grade.summary.maxObservedLatencyMs}`,
    );
  }
  console.log('\n=== End Report ===');
}

(async function main() {
  const args = parseArgs();
  const scenariosPath = path.join(process.cwd(), 'tests/eval-harness/scenarios.json');
  const cfg = await readScenarios(scenariosPath);

  const traceFile = args.traceFile || cfg.defaults.traceFile;

  if (args.dryRun) {
    await import('fs/promises').then((m) => m.mkdir(path.dirname(traceFile), { recursive: true }));

    if (process.env.EVAL_HARNESS_RESET_LOGS === '1') {
      if (existsSync(traceFile)) {
        unlinkSync(traceFile);
      }
      writeFileSync(traceFile, '', 'utf8');
    }

    await Promise.all(cfg.scenarios.map((scenario) => runDryScenario(scenario, cfg.defaults, traceFile)));
  }

  const entries = await readExistingTraces(traceFile);
  const grades = cfg.scenarios.map((scenario) => gradeScenario(scenario, entries, cfg.defaults));

  printReport(grades);

  const hasFailure = grades.some((grade) => !grade.pass);
  if (hasFailure) {
    console.error('Eval Harness Result: FAIL');
  } else {
    console.log('Eval Harness Result: PASS');
  }
})()
  .catch((err) => {
    console.error('Eval harness crashed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    process.exit(process.exitCode ?? 0);
  });
