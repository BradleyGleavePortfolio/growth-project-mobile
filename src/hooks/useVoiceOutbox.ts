/**
 * useVoiceOutbox — Style B: Send closes the sheet and the note waits here, on
 * the feed, until the server has it. sending (spinner, "Sending…") · waiting (offline: spinner + wifi-off, sends when the
 * signal is back) · failed (online failure: Try again / Delete, recording
 * kept). Kept on the phone until sent or deleted: the queue is saved to
 * AsyncStorage and the audio is moved into the app's documents folder, so a
 * restart picks it up again. Per signed-in author, emptied on sign-out.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
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
  /** Peaks drawn on the row. */
  peaks: number[];
  status: VoiceOutboxStatus;
}

const STORE_KEY = 'tgp.voiceOutbox.v1';
let items: VoiceOutboxItem[] = [];
let online = true;
let seq = 0;
let restored: Promise<void> | null = null;
const listeners = new Set<() => void>();

function commit(next: VoiceOutboxItem[]): void {
  items = next;
  listeners.forEach((l) => l());
  void AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => undefined);
}
/** Move the recording out of the cache into documents; the cache can be wiped. */
async function keepFile(uri: string): Promise<string> {
  try {
    const dir = new Directory(Paths.document, 'voice-outbox');
    dir.create({ intermediates: true, idempotent: true });
    const src = new File(uri);
    const dest = new File(dir, src.name);
    await src.move(dest);
    return dest.exists ? dest.uri : uri;
  } catch {
    return uri;
  }
}
/** Delete the files this outbox moved (one already gone is fine). */
function dropFiles(gone: VoiceOutboxItem[]): void {
  for (const i of gone) {
    try { if (i.input.uri.includes('/voice-outbox/')) new File(i.input.uri).delete(); } catch { /* gone */ }
  }
}
function remove(id: string): void {
  dropFiles(items.filter((i) => i.id === id));
  commit(items.filter((i) => i.id !== id));
}
/** After a restart: load the saved queue once; a send cut off mid-way waits again. */
function restore(): Promise<void> {
  restored ??= AsyncStorage.getItem(STORE_KEY)
    .then((raw) => {
      const saved = (raw ? JSON.parse(raw) : []) as VoiceOutboxItem[];
      const back = saved
        .filter((s) => !items.some((i) => i.id === s.id))
        .map((s) => ({ ...s, status: s.status === 'failed' ? s.status : ('waiting' as const) }));
      if (back.length > 0) commit([...back, ...items]);
    })
    .catch(() => undefined);
  return restored;
}
function patch(id: string, p: Partial<VoiceOutboxItem>): void {
  commit(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}
authEvents.on('logout', () => {
  dropFiles(items);
  commit([]);
});

/** Test seam: an empty store, online; nothing saved unless it is a cold start. */
export function resetVoiceOutbox(coldStart = false): void {
  online = true;
  restored = null;
  items = [];
  if (!coldStart) void AsyncStorage.removeItem(STORE_KEY);
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
    remove(id);
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
    opts?: { cohortId?: string; conversationId?: string; parentMessageId?: string },
  ) => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
}

export function useVoiceOutbox(workspaceId: string | null, authorId: string | null): VoiceOutbox {
  const qc = useQueryClient();
  const isOnline = isEffectivelyOnline(useNetworkStatus());
  const all = useSyncExternalStore(subscribe, () => items);

  // Restored, or the signal is back: send what was waiting for this author.
  useEffect(() => {
    online = isOnline;
    if (!authorId) return;
    void restore().then(() => {
      if (!online) return;
      items
        .filter((i) => i.authorId === authorId && i.status === 'waiting')
        .forEach((i) => void run(i.id, qc));
    });
  }, [authorId, isOnline, qc]);

  const send = useCallback<VoiceOutbox['send']>(
    (recording, opts) => {
      if (!workspaceId || !authorId) return;
      const id = `local-${Date.now()}-${(seq += 1)}`;
      const { uri, durationMs, bytes, mimeType, peaks } = recording;
      const input: VoiceUploadInput = { uri, durationMs, bytes, mimeType };
      if (opts?.cohortId) input.cohortId = opts.cohortId;
      if (opts?.conversationId) input.conversationId = opts.conversationId;
      if (opts?.parentMessageId) input.parentMessageId = opts.parentMessageId;
      if (peaks.length > 0) input.waveformPeaks = peaks;
      commit([...items, { id, authorId, workspaceId, input, peaks, status: 'sending' }]);
      void keepFile(uri).then((kept) => {
        patch(id, { input: { ...input, uri: kept }, status: 'waiting' });
        return run(id, qc);
      });
    },
    [authorId, qc, workspaceId],
  );
  const retry = useCallback((id: string) => void run(id, qc), [qc]);
  const discard = useCallback((id: string) => remove(id), []);

  const mine = all.filter((i) => i.authorId === authorId && i.workspaceId === workspaceId);
  return { items: mine, online: isOnline, send, retry, discard };
}
