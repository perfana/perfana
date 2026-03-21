'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchEventsByTestRun, PerfanaEvent } from '@/lib/events';

interface UseEventsDataReturn {
  events: PerfanaEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEventsData(testRunId: string): UseEventsDataReturn {
  const [events, setEvents] = useState<PerfanaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    if (!testRunId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await fetchEventsByTestRun(testRunId);
      setEvents(data);
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to load events';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [testRunId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  return { events, loading, error, refetch: loadEvents };
}
