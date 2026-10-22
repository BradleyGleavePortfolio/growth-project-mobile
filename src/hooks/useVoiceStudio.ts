/**
 * Voice notes Studio (backend #1122): the once-only first-use card. A server
 * without the route (404 / 503) means today's behaviour: no card, no peaks.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { communityVoiceApi, type VoiceConsent } from '../api/communityVoiceApi';
import { voiceKeys } from './voiceQueryKeys';

export interface VoiceConsentState {
  loading: boolean;
  /** The server has the Studio routes, so it also takes waveform peaks. */
  studio: boolean;
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
    studio: q.isSuccess,
    needsCard: q.isSuccess && !q.data.seen,
    record,
  };
}
