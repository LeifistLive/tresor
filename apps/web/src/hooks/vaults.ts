import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, vault } from '@/lib/api';

export function useVaults() {
  return useQuery({
    queryKey: ['vaults'],
    queryFn: () => api.vaults.list(),
    staleTime: 30_000,
  });
}

/**
 * When a member left a shared vault, an owner has to replace its key. This runs it in the background for
 * vaults the signed-in user owns (it needs their browser – the server cannot do it).
 */
export function useVaultMaintenance() {
  const qc = useQueryClient();
  const vaults = useVaults();
  const running = useRef(false);
  useEffect(() => {
    const pending = vaults.data?.filter((v) => v.rotationPending && v.role === 'owner') ?? [];
    if (pending.length === 0 || running.current) return;
    running.current = true;
    void vault
      .rotatePending(pending)
      .then((n) => {
        if (n > 0) {
          void qc.invalidateQueries({ queryKey: ['vaults'] });
          void qc.invalidateQueries({ queryKey: ['notes'] });
        }
      })
      .finally(() => {
        running.current = false;
      });
  }, [vaults.data, qc]);
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => api.templates.list(),
    staleTime: 60_000,
  });
}
