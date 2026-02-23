'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useGlobalSSE } from '@/providers/SSEProvider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Settings, ChevronLeft, LayoutGrid, Search } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { format } from 'date-fns';
import type { Workspace } from '@/lib/types';
import { SearchPalette } from './SearchPalette';

interface HeaderProps {
  workspace?: Workspace;
}

export function Header({ workspace }: HeaderProps) {
  const router = useRouter();
  const { tasks, isOnline } = useMissionControl();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeSubAgents, setActiveSubAgents] = useState(0);
  const [realtimeQueueCount, setRealtimeQueueCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sequence, lastEvent } = useGlobalSSE();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadHeaderStats = useCallback(async () => {
    try {
      const ws = workspace?.id || 'default';
      const summaryRes = await fetch(`/api/swarm/summary?workspace_id=${ws}`);
      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        setActiveSubAgents(Number(summary.active_roles || 0));
        setRealtimeQueueCount(Number(summary.queue_visible || 0));
        return;
      }

      const [rolesRes, tasksRes] = await Promise.all([
        fetch(`/api/swarm/roles?workspace_id=${ws}`),
        fetch(`/api/swarm/tasks?workspace_id=${ws}`),
      ]);

      if (rolesRes.ok) {
        const roles = await rolesRes.json();
        const active = Array.isArray(roles)
          ? roles.filter((r) => Number(r.running_runs || 0) > 0).length
          : 0;
        setActiveSubAgents(active);
      }

      if (tasksRes.ok) {
        const queue = await tasksRes.json();
        const count = Array.isArray(queue) ? queue.length : 0;
        setRealtimeQueueCount(count);
      }
    } catch (error) {
      console.error('Failed to load header stats:', error);
    }
  }, [workspace?.id]);

  useEffect(() => {
    void loadHeaderStats();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [loadHeaderStats]);

  useEffect(() => {
    if (!lastEvent) return;

    const summary = lastEvent.type === 'event_logged' ? String((lastEvent.payload as { summary?: string })?.summary || '') : '';
    const shouldRefresh =
      lastEvent.type === 'task_created' ||
      lastEvent.type === 'task_updated' ||
      lastEvent.type === 'task_deleted' ||
      lastEvent.type === 'agent_spawned' ||
      lastEvent.type === 'agent_completed' ||
      (lastEvent.type === 'event_logged' && /task_|role_|run_|hitl_|REWORK|DELIVERABLE|EXECUTOR/.test(summary));

    if (!shouldRefresh) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadHeaderStats();
    }, 500);
  }, [sequence, lastEvent, loadHeaderStats]);

  const activeAgents = activeSubAgents;
  const fallbackQueueCount = tasks.length;
  const tasksInQueue = realtimeQueueCount || fallbackQueueCount;

  return (
    <>
      <header className="h-14 bg-mc-bg-secondary border-b border-mc-border flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-mc-accent-cyan" />
            <span className="font-semibold text-mc-text uppercase tracking-wider text-sm">Mission Control</span>
          </div>

          {workspace ? (
            <div className="flex items-center gap-2">
              <Link href="/" className="flex items-center gap-1 text-mc-text-secondary hover:text-mc-accent transition-colors">
                <ChevronLeft className="w-4 h-4" />
                <LayoutGrid className="w-4 h-4" />
              </Link>
              <span className="text-mc-text-secondary">/</span>
              <div className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded">
                <span className="text-lg">{workspace.icon}</span>
                <span className="font-medium">{workspace.name}</span>
              </div>
            </div>
          ) : (
            <Link href="/" className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors">
              <LayoutGrid className="w-4 h-4" />
              <span className="text-sm">All Workspaces</span>
            </Link>
          )}
        </div>

        {workspace && (
          <div className="flex items-center gap-4">
            <button onClick={() => setSearchOpen(true)} className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded border border-mc-border bg-mc-bg hover:bg-mc-bg-tertiary text-sm text-mc-text-secondary">
              <Search className="w-4 h-4" />
              Search
              <span className="text-[11px] border border-mc-border rounded px-1">⌘K</span>
            </button>
            <div className="text-center">
              <div className="text-2xl font-bold text-mc-accent-cyan">{activeAgents}</div>
              <div className="text-xs text-mc-text-secondary uppercase">Agents Active</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-mc-accent-purple">{tasksInQueue}</div>
              <div className="text-xs text-mc-text-secondary uppercase">Tasks in Queue</div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <span className="text-mc-text-secondary text-sm font-mono">{format(currentTime, 'HH:mm:ss')}</span>
          <div className={`flex items-center gap-2 px-3 py-1 rounded border text-sm font-medium ${isOnline ? 'bg-mc-accent-green/20 border-mc-accent-green text-mc-accent-green' : 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'}`}>
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'}`} />
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </div>
          <button onClick={() => router.push('/settings')} className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary" title="Settings">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} workspaceId={workspace?.id || 'default'} />
    </>
  );
}
