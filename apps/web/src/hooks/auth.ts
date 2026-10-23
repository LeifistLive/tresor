import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@tresor/shared';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { setLanguage } from '@/i18n';
import { ApiError, api, forgetKeys } from '@/lib/api';
import { applyTheme } from '@/lib/theme';

export const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<MeDto | null> => {
      try {
        return (await api.me()).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Stores the signed-in user and applies their language and theme. */
export function useApplyUser() {
  const qc = useQueryClient();
  return useCallback(
    (user: MeDto) => {
      qc.setQueryData(ME_KEY, user);
      setLanguage(user.language);
      applyTheme(user.theme);
    },
    [qc],
  );
}

/** Signs out, forgets the keys, wipes every cached (decrypted) query and goes to the login page. */
export function useLock() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useCallback(
    async (reason: 'locked' | 'logout' = 'logout') => {
      try {
        await api.logout();
      } catch {
        /* session may already be gone */
      }
      forgetKeys();
      qc.clear();
      qc.setQueryData(ME_KEY, null);
      navigate(`/login?${reason}=1`, { replace: true });
    },
    [qc, navigate],
  );
}
