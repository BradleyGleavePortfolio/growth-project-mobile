/**
 * Voice notes (backend #1122): the once-only first-use card. If the server
 * cannot say whether it was seen (offline, an error), the card shows.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { communityVoiceApi, type VoiceConsent } from '../api/communityVoiceApi';
import { voiceKeys } from './voiceQueryKeys';

export interface VoiceConsentState {
  loading: boolean;
  /** Show the first-use card before recording. */
  needsCard: boolean;
  /** The card was shown and the person chose Record. */
  record: () => void;
}

export function useVoiceConsent(): VoiceConsentState {
  const qc = useQueryClient();
  const q = useQuery<VoiceConsent>({
    queryKey: voiceKeys.consent(),
    queryFn: () => communityVoiceApi.getConsent(),
    retry: false,
    staleTime: Infinity,
  });
  const record = useCallback(() => {
    qc.setQueryData<VoiceConsent>(voiceKeys.consent(), { seen: true, seen_at: new Date().toISOString() });
    // A failed write only means the card shows once more next time.
    void communityVoiceApi.recordConsent().catch(() => undefined);
  }, [qc]);
  return {
    loading: q.isLoading,
    needsCard: !q.isLoading && q.data?.seen !== true,
    record,
  };
}
