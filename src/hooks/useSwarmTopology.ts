'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useGlobalSSE } from '@/providers/SSEProvider';

export type SwarmTopologyNode = {
  id: string;
  type: 'orchestrator' | 'subagent-role';
  label: string;
  domain?: string;
  enabled?: boolean;
  metrics?: {
    total_runs: number;
    running_runs: number;
    completed_runs: number;
    failed_runs: number;
  };
};

export type SwarmTopologyLink = {
  id: string;
  source: string;
  target: string;
  handoff_type: string;
  handoff_count: number;
  last_handoff_at?: string;
};

export type TaskGraphNode = {
  id: string;
  task_id: string;
  title: string;
  status: string;
  parent_task_id?: string | null;
  owner_role_id?: string | null;
};

export type TaskGraphEdge = {
  id: string;
  source_task_id: string;
  target_task_id: string;
};

export type RoleSignal = {
  progress?: number;
  risk?: string;
  rework?: boolean;
  updated_at?: string;
};

export type CommandStreamItem = {
  id: string;
  message: string;
  type: string;
  created_at: string;
};

export type SwarmTopologyPayload = {
  generated_at: string;
  nodes: SwarmTopologyNode[];
  links: SwarmTopologyLink[];
  task_nodes?: TaskGraphNode[];
  task_edges?: TaskGraphEdge[];
  role_signals?: Record<string, RoleSignal>;
  command_stream?: CommandStreamItem[];
  hitl: { pending_approvals: number };
  stats: { active_runs: number; proactive_open_tasks: number; total_open_tasks: number };
};

export function useSwarmTopology(pollMs = 5000) {
  const [data, setData] = useState<SwarmTopologyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sequence, lastEvent } = useGlobalSSE();

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch('/api/swarm/topology');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load topology');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load, pollMs]);

  useEffect(() => {
    if (!lastEvent) return;

    const summary = lastEvent.type === 'event_logged' ? String((lastEvent.payload as { summary?: string })?.summary || '') : '';
    const shouldReload =
      lastEvent.type === 'task_created' ||
      lastEvent.type === 'task_updated' ||
      lastEvent.type === 'task_deleted' ||
      (lastEvent.type === 'event_logged' && /role_config_updated|task_|run_|hitl_|REWORK|EXECUTOR|DELIVERABLE|synthesis_task_auto_created/.test(summary));

    if (!shouldReload) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void load();
    }, 500);
  }, [sequence, lastEvent, load]);

  return { data, loading, error, reload: load };
}
