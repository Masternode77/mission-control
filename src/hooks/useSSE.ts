'use client';

import { useEffect } from 'react';
import { useGlobalSSE } from '@/providers/SSEProvider';
import { useMissionControl } from '@/lib/store';

/**
 * Backward-compatible hook.
 * SSE connection is now owned by the global SSEProvider singleton.
 */
export function useSSE() {
  const { connected } = useGlobalSSE();
  const { setIsOnline } = useMissionControl();

  useEffect(() => {
    setIsOnline(connected);
  }, [connected, setIsOnline]);
}
