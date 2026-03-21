'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchProfile, Profile } from '@/lib/profiles';

interface UseProfileDataProps {
  profileId: string;
}

interface UseProfileDataReturn {
  profile: Profile | null;
  loading: boolean;
  error: string;
  loadProfile: () => Promise<void>;
}

/**
 * Hook for managing profile data loading
 */
export function useProfileData({ profileId }: UseProfileDataProps): UseProfileDataReturn {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchProfile(profileId);
      setProfile(data);
      setError('');
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load profile'
      );
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  return {
    profile,
    loading,
    error,
    loadProfile,
  };
}
