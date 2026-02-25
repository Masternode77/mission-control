#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const execPath = path.join(process.cwd(), 'src/lib/swarm-executor.ts');
const tracerPath = path.join(process.cwd(), 'src/lib/tracer.ts');
const obsPath = path.join(process.cwd(), 'src/app/api/observability/route.ts');

function patchExecutor(content) {
  let next = content;

  next = next.replace(
    "    const finalizedTotalTokens =\n      (typeof streamUsageTotalTokens === 'number' && Number.isFinite(streamUsageTotalTokens))\n        ? streamUsageTotalTokens\n        : (estimateTokensFromText(payload) + estimateTokensFromText(finalMarkdown));\n",
    "    const tokenSource = (typeof streamUsageTotalTokens === 'number' && Number.isFinite(streamUsageTotalTokens))\n      ? 'exact'\n      : 'estimated';\n    const tokenEstimated = tokenSource !== 'exact';\n    const finalizedTotalTokens = tokenEstimated\n      ? (estimateTokensFromText(payload) + estimateTokensFromText(finalMarkdown))\n      : (streamUsageTotalTokens as number);\n"
  );

  next = next.replace(
    "      metadata: {\n        method: 'llm',\n        source: (typeof streamUsageTotalTokens === 'number' && Number.isFinite(streamUsageTotalTokens)) ? 'gateway_event_or_final_payload' : 'estimated_from_prompt_and_final_text',\n        run_id: streamRunId || undefined,\n      },",
    "      metadata: {\n        method: 'llm',\n        source: tokenEstimated ? 'estimated_from_prompt_and_final_text' : 'gateway_event_or_final_payload',\n        token_source: tokenSource,\n        token_estimated: tokenEstimated,\n        run_id: streamRunId || undefined,\n      },"
  );

  return next;
}

function patchTracer(content) {
  let next = content;
  if (!next.includes('type TraceMeta')) {
    next = next.replace(
      "type SpanLog = {",
      "type TraceMeta = Record<string, unknown> & {\n  token_source?: 'exact' | 'estimated' | string;\n  token_estimated?: boolean;\n};\n\ntype SpanLog = {"
    );
    next = next.replace('  meta: Record<string, unknown>;', '  meta: TraceMeta;');
    next = next.replace('  meta?: Record<string, unknown>;', '  meta?: TraceMeta;');
    next = next.replace('  metadata?: Record<string, unknown>;', '  metadata?: TraceMeta;');
  }
  return next;
}

function patchObservability(content) {
  let next = content;

  if (!next.includes('type TokenCoverageAgg =')) {
    next = next.replace(
      "type ErrorRatePoint = {",
      "type TokenCoverageAgg = {\n  totalTokens: number;\n  exactTokens: number;\n  estimatedTokens: number;\n  exactCoveragePct: number;\n};\n\ntype ErrorRatePoint = {"
    );
  }

  next = next.replace(
    "  const hourlyKst = new Map<string, { total: number; failed: number; tokenSum: number }>();",
    "  const hourlyKst = new Map<string, { total: number; failed: number; tokenSum: number; exactTokens: number; estimatedTokens: number }>();"
  );

  next = next.replace(
    "    const hourState = hourlyKst.get(hour) || { total: 0, failed: 0, tokenSum: 0 };",
    "    const hourState = hourlyKst.get(hour) || { total: 0, failed: 0, tokenSum: 0, exactTokens: 0, estimatedTokens: 0 };"
  );

  if (!next.includes("row.meta?.token_source")) {
    next = next.replace(
      "    hourState.total += 1;\n    hourState.tokenSum += tokenCost;\n    dayState.total += 1;",
      "    hourState.total += 1;\n    hourState.tokenSum += tokenCost;\n    const tokenSource = String(((row.meta || {}) as Record<string, unknown>).token_source || '').toLowerCase();\n    const tokenEstimated = Boolean(((row.meta || {}) as Record<string, unknown>).token_estimated === true) || tokenSource === 'estimated';\n    if (tokenCost > 0) {\n      if (tokenEstimated) hourState.estimatedTokens += tokenCost;\n      else hourState.exactTokens += tokenCost;\n    }\n    dayState.total += 1;"
    );
  }

  if (!next.includes('const tokenCoverage: TokenCoverageAgg')) {
    next = next.replace(
      "  const totalSpans = rows.length || 1;\n  const failed = rows.reduce((acc, row) => acc + (row.success === false ? 1 : 0), 0);",
      "  const totalSpans = rows.length || 1;\n  const failed = rows.reduce((acc, row) => acc + (row.success === false ? 1 : 0), 0);\n  const tokenCoverage: TokenCoverageAgg = (() => {\n    let totalTokens = 0;\n    let exactTokens = 0;\n    let estimatedTokens = 0;\n    for (const state of hourlyKst.values()) {\n      totalTokens += state.tokenSum;\n      exactTokens += state.exactTokens;\n      estimatedTokens += state.estimatedTokens;\n    }\n    const exactCoveragePct = totalTokens > 0 ? Number(((exactTokens / totalTokens) * 100).toFixed(2)) : 0;\n    return { totalTokens, exactTokens, estimatedTokens, exactCoveragePct };\n  })();"
    );
  }

  next = next.replace(
    "    aggregate: {\n      tokenUsageByEntity: tokenRows,\n      totalSpanCount: rows.length,\n      totalFailedSpanCount: failed,\n      globalErrorRate: failed / totalSpans,\n    },",
    "    aggregate: {\n      tokenUsageByEntity: tokenRows,\n      totalSpanCount: rows.length,\n      totalFailedSpanCount: failed,\n      globalErrorRate: failed / totalSpans,\n      tokenCoverage,\n    },"
  );

  next = next.replace(
    "    hourlyKst: hourlySeries.map((point) => {\n      const state = hourlyKst.get(point.bucket) || { total: 0, failed: 0, tokenSum: 0 };\n      return {\n        bucket: point.bucket,\n        totalAttempts: state.total,\n        failedAttempts: state.failed,\n        errorRatePct: state.total > 0 ? Number(((state.failed / state.total) * 100).toFixed(2)) : 0,\n        totalTokens: state.tokenSum,\n      };\n    }),",
    "    hourlyKst: hourlySeries.map((point) => {\n      const state = hourlyKst.get(point.bucket) || { total: 0, failed: 0, tokenSum: 0, exactTokens: 0, estimatedTokens: 0 };\n      const exactCoveragePct = state.tokenSum > 0 ? Number(((state.exactTokens / state.tokenSum) * 100).toFixed(2)) : 0;\n      return {\n        bucket: point.bucket,\n        totalAttempts: state.total,\n        failedAttempts: state.failed,\n        errorRatePct: state.total > 0 ? Number(((state.failed / state.total) * 100).toFixed(2)) : 0,\n        totalTokens: state.tokenSum,\n        exactTokens: state.exactTokens,\n        estimatedTokens: state.estimatedTokens,\n        exactCoveragePct,\n      };\n    }),"
  );

  return next;
}

function main(){
  const execSrc = fs.readFileSync(execPath,'utf8');
  const tracerSrc = fs.readFileSync(tracerPath,'utf8');
  const obsSrc = fs.readFileSync(obsPath,'utf8');

  const execPatched = patchExecutor(execSrc);
  const tracerPatched = patchTracer(tracerSrc);
  const obsPatched = patchObservability(obsSrc);

  fs.writeFileSync(execPath, execPatched, 'utf8');
  fs.writeFileSync(tracerPath, tracerPatched, 'utf8');
  fs.writeFileSync(obsPath, obsPatched, 'utf8');
  console.log('patched token accuracy across executor/tracer/observability');
  process.exit(0);
}

main();
