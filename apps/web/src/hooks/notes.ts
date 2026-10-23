import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoteDto, NoteInput, NoteUpdate } from '@tresor/shared';
import { api } from '@/lib/api';

export const notesKey = (status: 'active' | 'trash') => ['notes', status] as const;

export function useNotes(status: 'active' | 'trash' = 'active') {
  return useQuery({
    queryKey: notesKey(status),
    queryFn: () => api.notes.list(status),
    staleTime: 15_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['notes'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  };
}

export function useCreateNote() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: NoteInput) => api.notes.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NoteUpdate }) => api.notes.update(id, patch),
    onMutate: async ({ id, patch }) => {
      // Optimistic update for quick toggles like "pin".
      if (Object.keys(patch).length === 1 && 'pinned' in patch) {
        qc.setQueryData<NoteDto[]>(notesKey('active'), (old) =>
          old?.map((n) => (n.id === id ? { ...n, pinned: Boolean(patch.pinned) } : n)),
        );
      }
    },
    onSettled: invalidate,
  });
}

export function useTrashNote() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.notes.trash(id), onSuccess: invalidate });
}

export function useRestoreNote() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.notes.restore(id), onSuccess: invalidate });
}

export function usePurgeNote() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.notes.purge(id), onSuccess: invalidate });
}

export function useEmptyTrash() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => api.notes.emptyTrash(), onSuccess: invalidate });
}
