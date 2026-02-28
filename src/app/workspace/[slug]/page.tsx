'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Header } from '@/components/Header';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { MissionQueue } from '@/components/MissionQueue';
import { LiveFeed } from '@/components/LiveFeed';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { useMissionControl } from '@/lib/store';
import { debug } from '@/lib/debug';
import { useGlobalSSE } from '@/providers/SSEProvider';
import { SwarmControlRoom } from '@/components/SwarmControlRoom';
import { ObservabilityDashboard } from '@/components/ObservabilityDashboard';
import type { Workspace } from '@/lib/types';

export default function WorkspacePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const taskIdFromUrl = String(searchParams.get('taskId') || '').trim();
  
  const {
    setAgents,
    setTasks,
    setEvents,
    setIsOnline,
    setIsLoading,
    isLoading,
  } = useMissionControl();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [activeView, setActiveView] = useState<'swarm' | 'queue' | 'analytics'>('swarm');
  const [notFound, setNotFound] = useState(false);
  const { connected, sequence, lastEvent } = useGlobalSSE();
  const sseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepLinkOpenedRef = useRef(false);

  useEffect(() => {
    setIsOnline(connected);
  }, [connected, setIsOnline]);

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch(`/api/workspaces/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setWorkspace(data);
        } else if (res.status === 404) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }
      } catch (error) {
        console.error('Failed to load workspace:', error);
        setNotFound(true);
        setIsLoading(false);
        return;
      }
    }

    loadWorkspace();
  }, [slug, setIsLoading]);

  useEffect(() => {
    if (!workspace) return;
    
    const workspaceId = workspace.id;

    async function loadData() {
      try {
        debug.api('Loading workspace data...', { workspaceId });
        
        const [agentsRes, tasksRes, eventsRes] = await Promise.all([
          fetch(`/api/agents?workspace_id=${workspaceId}`),
          fetch(`/api/swarm/tasks?workspace_id=${workspaceId}`),
          fetch('/api/events'),
        ]);

        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          debug.api('Loaded tasks', { count: tasksData.length });
          setTasks(tasksData);
        }
        if (eventsRes.ok) setEvents(await eventsRes.json());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    async function checkOpenClaw() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const openclawRes = await fetch('/api/openclaw/status', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (openclawRes.ok) {
          const status = await openclawRes.json();
          setIsOnline(status.connected);
        }
      } catch {
        setIsOnline(false);
      }
    }

    loadData();
    checkOpenClaw();
  }, [workspace, setAgents, setTasks, setEvents, setIsOnline, setIsLoading]);

  useEffect(() => {
    if (!workspace || !lastEvent) return;

    const shouldRefresh =
      lastEvent.type === 'task_created' ||
      lastEvent.type === 'task_updated' ||
      lastEvent.type === 'task_deleted' ||
      lastEvent.type === 'event_logged';

    if (!shouldRefresh) return;

    if (sseDebounceRef.current) clearTimeout(sseDebounceRef.current);
    sseDebounceRef.current = setTimeout(async () => {
      try {
        const [tasksRes, eventsRes] = await Promise.all([
          fetch(`/api/swarm/tasks?workspace_id=${workspace.id}`),
          fetch('/api/events?limit=20'),
        ]);
        if (tasksRes.ok) setTasks(await tasksRes.json());
        if (eventsRes.ok) setEvents(await eventsRes.json());
      } catch (error) {
        console.error('Failed to refresh workspace data from SSE:', error);
      }
    }, 700);

    return () => {
      if (sseDebounceRef.current) clearTimeout(sseDebounceRef.current);
    };
  }, [sequence, lastEvent, workspace, setEvents, setTasks]);

  useEffect(() => {
    if (!workspace || !taskIdFromUrl || deepLinkOpenedRef.current) return;
    deepLinkOpenedRef.current = true;
    setActiveView('queue');

    const t = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('mc:open-task', { detail: { taskId: taskIdFromUrl } }));
    }, 350);

    return () => clearTimeout(t);
  }, [workspace, taskIdFromUrl]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold mb-2">Workspace Not Found</h1>
          <p className="text-mc-text-secondary mb-6">
            The workspace &ldquo;{slug}&rdquo; doesn&apos;t exist.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !workspace) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading {slug}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-mc-bg overflow-hidden">
      <Header workspace={workspace} />

      <div className="flex-1 flex overflow-hidden">
        <AgentsSidebar workspaceId={workspace.id} />

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">
          <button
            onClick={() => setActiveView('swarm')}
            className={`px-3 py-1.5 rounded text-xs ${activeView === 'swarm' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border'}`
            }
            >
              Swarm Topology
            </button>
            <button
            onClick={() => setActiveView('queue')}
            className={`px-3 py-1.5 rounded text-xs ${activeView === 'queue' ? 'bg-mc-accent/20 text-mc-accent border border-mc-accent/50' : 'bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border'}`
            }
            >
              Queue View
            </button>
            <button
            onClick={() => setActiveView('analytics')}
            className={`px-3 py-1.5 rounded text-xs ${activeView === 'analytics' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50' : 'bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border'}`
            }
            >
              Analytics (Metrics)
            </button>
          </div>
{activeView === 'swarm' ? <SwarmControlRoom /> : activeView === 'queue' ? <MissionQueue workspaceId={workspace.id} /> : <ObservabilityDashboard />}
        </div>

        <LiveFeed />
      </div>

      <SSEDebugPanel />
    </div>
  );
}
