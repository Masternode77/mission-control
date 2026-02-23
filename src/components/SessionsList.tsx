'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bot, CheckCircle, Circle, XCircle } from 'lucide-react';

interface SessionWithAgent {
  id: string;
  agent_id: string | null;
  openclaw_session_id: string;
  channel: string | null;
  status: string;
  session_type: string;
  task_id: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  agent_avatar_emoji?: string;
}

interface SessionsListProps {
  taskId: string;
}

export function SessionsList({ taskId }: SessionsListProps) {
  const [sessions, setSessions] = useState<SessionWithAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/swarm/tasks/${taskId}/sessions`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
      case 'running':
        return <Circle className="w-4 h-4 text-green-500 fill-current animate-pulse" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-mc-accent" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Circle className="w-4 h-4 text-mc-text-secondary" />;
    }
  };

  const formatDuration = (start: string, end?: string | null) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const duration = endTime - startTime;

    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-mc-text-secondary">Loading sessions...</div>;
  }

  if (sessions.length === 0) {
    return <div className="flex flex-col items-center justify-center py-8 text-mc-text-secondary"><div className="text-4xl mb-2">🤖</div><p>No swarm runs yet</p></div>;
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <div key={session.id} className="flex gap-3 p-3 bg-mc-bg rounded-lg border border-mc-border">
          <div className="flex-shrink-0">
            {session.agent_avatar_emoji ? <span className="text-2xl">{session.agent_avatar_emoji}</span> : <Bot className="w-8 h-8 text-mc-accent" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {getStatusIcon(session.status)}
              <span className="font-medium text-mc-text">{session.agent_name || session.agent_id || 'Sub-Agent'}</span>
              <span className="text-xs text-mc-text-secondary capitalize">{session.status}</span>
            </div>

            <div className="text-xs text-mc-text-secondary font-mono mb-2 truncate">Session: {session.openclaw_session_id}</div>
            <div className="flex items-center gap-3 text-xs text-mc-text-secondary">
              <span>Duration: {formatDuration(session.created_at, session.ended_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
