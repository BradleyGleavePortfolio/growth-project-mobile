/**
 * useVoiceOutbox — Style B: Send closes the sheet and the note waits here, on
 * the feed, until the server has it. sending (spinner, "Sending…") · waiting (offline: spinner + wifi-off, sends when the
 * signal is back) · failed (online failure: Try again / Delete, recording
 * kept). In memory for the app session, per signed-in author, emptied on
 * sign-out.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { HapticService } from '../ui/haptics/haptics.service';
import { authEvents } from '../utils/authEvents';
import { isEffectivelyOnline, useNetworkStatus } from './useNetworkStatus';
import { publishVoiceNote, type VoiceUploadInput } from './useVoiceUpload';
import { voiceKeys } from './voiceQueryKeys';
import type { VoiceRecordingResult } from './voiceRecorderPort';

export type VoiceOutboxStatus = 'sending' | 'waiting' | 'failed';

export interface VoiceOutboxItem {
  id: string;
  authorId: string;
  workspaceId: string;
  input: VoiceUploadInput;
  /** Peaks drawn on the row (sent only when the server takes them). */
  peaks: number[];
  status: VoiceOutboxStatus;
}

let items: VoiceOutboxItem[] = [];
let online = true;
let seq = 0;
const listeners = new Set<() => void>();

function commit(next: VoiceOutboxItem[]): void {
  items = next;
  listeners.forEach((l) => l());
}
function patch(id: string, p: Partial<VoiceOutboxItem>): void {
  commit(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}
authEvents.on('logout', () => commit([]));

/** Test seam: an empty store, online. */
export function resetVoiceOutbox(): void {
  online = true;
  commit([]);
}

async function run(id: string, qc: QueryClient): Promise<void> {
  const item = items.find((i) => i.id === id);
  if (!item || item.status === 'sending') return;
  if (!online) {
    patch(id, { status: 'waiting' });
    return;
  }
  patch(id, { status: 'sending' });
  try {
    await publishVoiceNote(item.workspaceId, item.input);
    // Keep the row until the feed holds the real note, so nothing blinks out.
    await qc.invalidateQueries({ queryKey: voiceKeys.feedRoot(item.workspaceId) });
    commit(items.filter((i) => i.id !== id));
  } catch {
    // Offline by now: wait for the signal. Online: say it did not send.
    patch(id, { status: online ? 'failed' : 'waiting' });
    if (online) void HapticService.error();
  }
}

export interface VoiceOutbox {
  items: VoiceOutboxItem[];
  online: boolean;
  send: (
    recording: VoiceRecordingResult,
    opts: { cohortId?: string; conversationId?: string; sendPeaks: boolean },
  ) => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
}

export function useVoiceOutbox(workspaceId: string | null, authorId: string | null): VoiceOutbox {
  const qc = useQueryClient();
  const isOnline = isEffectivelyOnline(useNetworkStatus());
  const all = useSyncExternalStore(subscribe, () => items);

  // The signal is back: send what was waiting for this author.
  useEffect(() => {
    online = isOnline;
    if (!isOnline || !authorId) return;
    items
      .filter((i) => i.authorId === authorId && i.status === 'waiting')
      .forEach((i) => void run(i.id, qc));
  }, [authorId, isOnline, qc]);

  const send = useCallback<VoiceOutbox['send']>(
    (recording, opts) => {
      if (!workspaceId || !authorId) return;
      const id = `local-${Date.now()}-${(seq += 1)}`;
      const { uri, durationMs, bytes, mimeType, peaks } = recording;
      const input: VoiceUploadInput = { uri, durationMs, bytes, mimeType };
      if (opts.cohortId) input.cohortId = opts.cohortId;
      if (opts.conversationId) input.conversationId = opts.conversationId;
      if (opts.sendPeaks && peaks.length > 0) input.waveformPeaks = peaks;
      commit([...items, { id, authorId, workspaceId, input, peaks, status: 'waiting' }]);
      void run(id, qc);
    },
    [authorId, qc, workspaceId],
  );
  const retry = useCallback((id: string) => void run(id, qc), [qc]);
  const discard = useCallback((id: string) => commit(items.filter((i) => i.id !== id)), []);

  const mine = all.filter((i) => i.authorId === authorId && i.workspaceId === workspaceId);
  return { items: mine, online: isOnline, send, retry, discard };
}
