'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { ProgressionData } from '../types';

interface UseProgressionDataProps {
  scalingSessionId?: string;
  expanded: boolean;
}

export function useProgressionData({ scalingSessionId, expanded }: UseProgressionDataProps) {
  const [data, setData] = useState<ProgressionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProgression = useCallback(async () => {
    if (!scalingSessionId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await authenticatedFetch(
        `/scaling-sessions/${scalingSessionId}/progression`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        setError('Failed to load progression data');
      }
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to load progression');
    } finally {
      setLoading(false);
    }
  }, [scalingSessionId]);

  // Fetch when expanded or sessionId changes
  useEffect(() => {
    if (expanded && scalingSessionId) {
      fetchProgression();
    }
  }, [expanded, scalingSessionId, fetchProgression]);

  // Also do initial fetch for collapsed summary
  useEffect(() => {
    if (scalingSessionId && !data) {
      fetchProgression();
    }
  }, [scalingSessionId, data, fetchProgression]);

  return { data, loading, error, refresh: fetchProgression };
}
