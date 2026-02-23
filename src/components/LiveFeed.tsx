'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, Clock } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { useGlobalSSE } from '@/providers/SSEProvider';
import type { Event } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

type FeedFilter = 'all' | 'tasks' | 'agents';

function getBadge(message: string) {
  if (message.startsWith('[EXECUTOR_ERROR]')) return 'text-red-300';
  if (message.startsWith('[DELIVERABLE_SAVED]')) return 'text-emerald-300';
  if (message.startsWith('[DISPATCH_DETAIL]')) return 'text-cyan-300';
  if (message.startsWith('[TOOL_USE')) return 'text-violet-300';
  if (message.startsWith('[THINKING]')) return 'text-amber-300';
  if (message.startsWith('[DRAFTING]')) return 'text-sky-300';
  return 'text-mc-text-secondary';
}

function isAgentMessage(message: string) {
  return (
    message.startsWith('[TOOL_USE]') ||
    message.startsWith('[THINKING]') ||
    message.startsWith('[DRAFTING]') ||
    message.startsWith('[DISPATCH_DETAIL]') ||
    message.startsWith('[DELIVERABLE_SAVED]') ||
    message.startsWith('[EXECUTOR_ERROR]')
  );
}

function isTaskMessage(message: string) {
  return (
    message.startsWith('task_status_changed:') ||
    message.startsWith('[HITL]') ||
    message.startsWith('[HITL REJECT]') ||
    message.startsWith('task_')
  );
}

export function LiveFeed() {
  const { events, setEvents } = useMissionControl();
  const { sequence, lastEvent } = useGlobalSSE();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [isMinimized, setIsMinimized] = useState(false);
  const [realtimeMessages, setRealtimeMessages] = useState<Event[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleMinimize = () => setIsMinimized(!isMinimized);

  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === 'event_logged') {
      const summary = String((lastEvent.payload as { summary?: string })?.summary || 'event_logged');
      const taskId = String((lastEvent.payload as { taskId?: string })?.taskId || '');
      const sessionId = String((lastEvent.payload as { sessionId?: string })?.sessionId || '');
      setRealtimeMessages((prev) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          type: 'system',
          task_id: taskId,
          agent_id: sessionId || undefined,
          message: summary,
          metadata: JSON.stringify({ taskId, sessionId }),
          created_at: new Date().toISOString(),
        } as Event,
        ...prev,
      ].slice(0, 40));
    }

    const shouldReload = lastEvent.type === 'task_created' || lastEvent.type === 'task_updated' || lastEvent.type === 'task_deleted';
    if (shouldReload) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch('/api/events?limit=50');
          if (res.ok) setEvents(await res.json());
        } catch {
          // ignore
        }
      }, 500);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sequence, lastEvent, setEvents]);

  const mergedEvents = [...realtimeMessages, ...events].slice(0, 100);

  const filteredEvents = mergedEvents.filter((event) => {
    const message = String(event.message || '');

    if (filter === 'all') return true;

    if (filter === 'tasks') {
      return (
        ['task_created', 'task_assigned', 'task_status_changed', 'task_completed'].includes(event.type) ||
        isTaskMessage(message)
      );
    }

    if (filter === 'agents') {
      return (
        ['agent_joined', 'agent_status_changed', 'message_sent'].includes(event.type) ||
        !!event.agent_id ||
        isAgentMessage(message)
      );
    }

    return true;
  });

  return (
    <aside className={`bg-mc-bg-secondary border-l border-mc-border flex flex-col transition-all duration-300 ease-in-out ${isMinimized ? 'w-12' : 'w-80'}`}>
      <div className="p-3 border-b border-mc-border">
        <div className="flex items-center">
          <button onClick={toggleMinimize} className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors" aria-label={isMinimized ? 'Expand feed' : 'Minimize feed'}>
            {isMinimized ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {!isMinimized && <span className="text-sm font-medium uppercase tracking-wider">Live Feed</span>}
        </div>

        {!isMinimized && (
          <div className="flex gap-1 mt-3">
            {(['all', 'tasks', 'agents'] as FeedFilter[]).map((tab) => (
              <button key={tab} onClick={() => setFilter(tab)} className={`px-3 py-1 text-xs rounded uppercase ${filter === tab ? 'bg-mc-accent text-mc-bg font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}>
                {tab}
              </button>
            ))}
          </div>
        )}
      </div>

      {!isMinimized && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-mc-text-secondary text-sm">No events yet</div>
          ) : (
            filteredEvents.map((event) => (
              <div key={event.id} className="p-2 rounded border-l-2 border-mc-border bg-transparent hover:bg-mc-bg-tertiary">
                <p className={`text-sm whitespace-pre-wrap ${getBadge(String(event.message || ''))}`}>{event.message}</p>
                <div className="flex items-center gap-1 mt-1 text-xs text-mc-text-secondary">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
