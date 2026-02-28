'use client';

import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, LineChart, Line, BarChart, Bar, Legend } from 'recharts';

type SpanType = 'llm_call' | 'tool_call' | 'hitl_gate' | 'synthesis';

type TokenUsageRow = {
  key: string;
  label: string;
  cost_tokens: number;
  entry_count: number;
  by_span_type: Record<SpanType, number>;
};

type ErrorPoint = {
  bucket: string;
  total: number;
  failed: number;
  failureRate: number;
};

type ObservabilityPayload = {
  aggregate: {
    tokenUsageByEntity: TokenUsageRow[];
    totalSpanCount: number;
    totalFailedSpanCount: number;
    globalErrorRate: number;
  };
  timelines: {
    hourly: ErrorPoint[];
    day: ErrorPoint[];
  };
};

export function ObservabilityDashboard() {
  const [data, setData] = useState<ObservabilityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch('/api/observability', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as ObservabilityPayload;
        if (mounted) setData(payload);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const barData = useMemo(() => {
    if (!data?.aggregate?.tokenUsageByEntity) return [];
    return data.aggregate.tokenUsageByEntity
      .slice(0, 12)
      .map((row) => ({
        label: row.label,
        costTokens: Number(row.cost_tokens || 0),
        spanCount: row.entry_count || 0,
      }));
  }, [data]);

  const hourlyLine = useMemo(() => (data?.timelines?.hourly || []).map((item) => ({
    time: item.bucket,
    errorRate: Number((item.failureRate * 100).toFixed(2)),
    failureRate: item.failureRate,
    total: item.total,
    failed: item.failed,
  })), [data]);

  const dayLine = useMemo(() => (data?.timelines?.day || []).map((item) => ({
    time: item.bucket,
    errorRate: Number((item.failureRate * 100).toFixed(2)),
    failureRate: item.failureRate,
    total: item.total,
    failed: item.failed,
  })), [data]);

  if (loading) {
    return <div className="p-6 text-mc-text-secondary">Observability 데이터를 불러오는 중...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-300">Observability 데이터를 불러오지 못했습니다: {error}</div>;
  }

  const globalErrorRatePct = ((data?.aggregate.globalErrorRate || 0) * 100).toFixed(2);

  return (
    <div className="h-full p-6 space-y-6 overflow-auto bg-mc-bg text-mc-text">
      <div className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">1-Page Observability Dashboard</h2>
            <p className="text-sm text-mc-text-secondary mt-1">실행 스팬 기반 토큰 소모량 및 오류율 요약</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-cyan-300">{globalErrorRatePct}%</div>
            <div className="text-xs text-mc-text-secondary">Global Error Rate</div>
            <div className="text-xs text-mc-text-muted mt-1">
              총 스팬 {data?.aggregate.totalSpanCount ?? 0} / 실패 {data?.aggregate.totalFailedSpanCount ?? 0}
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-mc-text mb-3">에이전트별 토큰 사용량</h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 5, right: 20, left: 10, bottom: 35 }}>
              <CartesianGrid stroke="#2a2f45" />
              <XAxis dataKey="label" tick={{ fill: '#a3a9c7', fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tick={{ fill: '#a3a9c7', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#e5e7eb' }}
                labelStyle={{ color: '#a3a9c7' }}
                itemStyle={{ color: '#e5e7eb' }}
                formatter={(value: number | undefined) => `${value ?? 0} tokens`}
              />
              <Legend wrapperStyle={{ color: '#e5e7eb' }} />
              <Bar dataKey="costTokens" name="Cost Tokens" radius={[6, 6, 0, 0]} fill="#06b6d4" />
              <Bar dataKey="spanCount" name="Span Count" radius={[6, 6, 0, 0]} fill="#22c55e" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4 space-y-4">
        <h3 className="text-sm font-semibold text-mc-text">오류 발생률 추이 (Line Chart)</h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="h-72">
            <div className="text-xs text-mc-text-secondary mb-2">Hour 기준</div>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyLine}>
                <CartesianGrid stroke="#2a2f45" />
                <XAxis dataKey="time" tick={{ fill: '#a3a9c7', fontSize: 11 }} />
                <YAxis tick={{ fill: '#a3a9c7', fontSize: 12 }} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#e5e7eb' }}
                  formatter={(value: number | undefined) => `${value ?? 0}%`}
                />
                <Legend wrapperStyle={{ color: '#e5e7eb' }} />
                <Line type="monotone" dataKey="errorRate" name="Error Rate" stroke="#06b6d4" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-72">
            <div className="text-xs text-mc-text-secondary mb-2">Day 기준</div>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dayLine}>
                <CartesianGrid stroke="#2a2f45" />
                <XAxis dataKey="time" tick={{ fill: '#a3a9c7', fontSize: 11 }} />
                <YAxis tick={{ fill: '#a3a9c7', fontSize: 12 }} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#e5e7eb' }}
                  formatter={(value: number | undefined) => `${value ?? 0}%`}
                />
                <Line type="monotone" dataKey="errorRate" name="Error Rate" stroke="#8b5cf6" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-4">
        <div className="text-xs text-mc-text-secondary">현재 데이터 소스: <span className="text-mc-text">logs/swarm-traces.jsonl</span></div>
        <div className="text-[11px] text-mc-text-muted mt-1">Line chart는 실패율(success=false) 비율을 100배수(%)로 표시합니다.</div>
      </section>
    </div>
  );
}
