'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';

type SwarmActivity = {
  id: string;
  activity_type: string;
  message: string;
  metadata?: string | null;
  created_at: string;
};

interface ActivityLogProps {
  taskId: string;
}

function rowStyle(message: string) {
  if (message.startsWith('[EXECUTOR_ERROR]')) return 'border-red-500/50 bg-red-500/10';
  if (message.startsWith('[DELIVERABLE_SAVED]')) return 'border-emerald-500/50 bg-emerald-500/10';
  if (message.startsWith('[DISPATCH_DETAIL]')) return 'border-cyan-500/50 bg-cyan-500/10';
  if (message.startsWith('[TOOL_USE')) return 'border-violet-500/50 bg-violet-500/10';
  if (message.startsWith('[THINKING]')) return 'border-amber-500/50 bg-amber-500/10';
  return 'border-mc-border bg-mc-bg';
}

function iconFor(message: string, type: string) {
  if (message.startsWith('[EXECUTOR_ERROR]')) return '❌';
  if (message.startsWith('[DELIVERABLE_SAVED]')) return '💾';
  if (message.startsWith('[DISPATCH_DETAIL]')) return '📡';
  if (message.startsWith('[TOOL_USE')) return '🛠️';
  if (message.startsWith('[THINKING]')) return '🧠';
  if (type === 'completed') return '✅';
  if (type === 'spawned') return '🚀';
  return '📝';
}

export function ActivityLog({ taskId }: ActivityLogProps) {
  const [activities, setActivities] = useState<SwarmActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/swarm/tasks/${taskId}/activities`);
      if (res.ok) {
        const data = await res.json();
        setActivities(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load swarm activities:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  if (loading) return <div className="py-8 text-center text-mc-text-secondary">Loading activities...</div>;
  if (!activities.length) return <div className="py-8 text-center text-mc-text-secondary">No activity yet</div>;

  return (
    <div className="space-y-3">
      {activities.map((a) => (
        <div key={a.id} className={`flex gap-3 p-3 rounded-lg border ${rowStyle(a.message)}`}>
          <div className="text-xl">{iconFor(a.message, a.activity_type)}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-mc-text break-words whitespace-pre-wrap">{a.message}</p>
            {a.metadata && (
              <pre className="mt-2 p-2 bg-mc-bg-tertiary rounded text-xs text-mc-text-secondary overflow-x-auto">{a.metadata}</pre>
            )}
            <div className="text-xs text-mc-text-secondary mt-2">
              {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
