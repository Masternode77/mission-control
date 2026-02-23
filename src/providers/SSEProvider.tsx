'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SSEEvent } from '@/lib/types';

type SSEContextValue = {
  connected: boolean;
  sequence: number;
  lastEvent: SSEEvent | null;
};

const SSEContext = createContext<SSEContextValue>({
  connected: false,
  sequence: 0,
  lastEvent: null,
});

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [sequence, setSequence] = useState(0);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);

  useEffect(() => {
    let unmounted = false;

    const clearReconnect = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      if (unmounted || sourceRef.current) return;

      const es = new EventSource('/api/events/stream');
      sourceRef.current = es;

      es.onopen = () => {
        if (unmounted) return;
        setConnected(true);
      };

      es.onmessage = (event) => {
        if (unmounted) return;
        if (!event.data || event.data.startsWith(':')) return;
        try {
          const parsed: SSEEvent = JSON.parse(event.data);
          setLastEvent(parsed);
          setSequence((s) => s + 1);
        } catch {
          // ignore malformed SSE payloads
        }
      };

      es.onerror = () => {
        if (unmounted) return;
        setConnected(false);
        es.close();
        sourceRef.current = null;
        clearReconnect();
        reconnectTimerRef.current = setTimeout(connect, 1500);
      };
    };

    connect();

    return () => {
      unmounted = true;
      clearReconnect();
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, []);

  const value = useMemo(() => ({ connected, sequence, lastEvent }), [connected, sequence, lastEvent]);

  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}

export function useGlobalSSE() {
  return useContext(SSEContext);
}
