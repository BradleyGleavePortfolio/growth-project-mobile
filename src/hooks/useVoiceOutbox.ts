/**
 * useVoiceOutbox — Style B: Send closes the sheet and the note waits here, on the feed, until the server
 * has it: sending (spinner, "Sending…") · waiting (offline: spinner + wifi-off, sends when the signal is
 * back, from any screen) · failed (online: Try again / Delete, recording kept). The queue is saved to
 * AsyncStorage and the audio moved into documents, so a restart picks it up. Per author, emptied on sign-out.
 * Cold start (LS-848 B2): with the flag on, this module drives the queue from app start — the signed-in
 * author from the user cache, the signal from NetInfo — so a restart on Home sends what waits with no
 * voice screen open.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { HapticService } from '../ui/haptics/haptics.service';
import { authEvents } from '../utils/authEvents';
import { featureFlags } from '../config/featureFlags';
import { readUserCache } from '../lib/userCache';
import { queryClient } from '../services/queryClient';
import { isEffectivelyOnline, useNetworkStatus } from './useNetworkStatus';
import { CommunityApiError } from '../api/apiCall';
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
  /** Upload share in [0,1] while sending — the GOAL 03 line under the row. */
  progress?: number;
  /** C-4: the bytes are up under this key; a resend only posts it again, so a lost reply never makes two notes. */
  uploadedKey?: string;
}

const STORE_KEY = 'tgp.voiceOutbox.v1';
let items: VoiceOutboxItem[] = [];
let online = true;
let seq = 0;
let restored: Promise<void> | null = null;
// Who sends the queue once every voice screen has closed (B2), and the one signal listener.
let session: { authorId: string; qc: QueryClient } | null = null;
let unwatch: (() => void) | null = null;
let driverEpoch = 0; // bumped on sign-out: a user-cache read still in flight belongs to the last account
let driverStarted = false;
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
/** Upload progress: drawn, not saved (a restart starts the line again). */
function setProgress(id: string, f: number): void {
  const cur = items.find((i) => i.id === id);
  if (!cur || cur.status !== 'sending' || (f < 1 && Math.abs(f - (cur.progress ?? 0)) < 0.04)) return;
  items = items.map((i) => (i.id === id ? { ...i, progress: Math.min(1, Math.max(0, f)) } : i));
  listeners.forEach((l) => l());
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}
/** Send what waits for the signed-in author: restored, or the signal is back. */
function flush(): void {
  const s = session;
  if (!s) return;
  void restore().then(() => {
    if (online) items.filter((i) => i.authorId === s.authorId && i.status === 'waiting').forEach((i) => void run(i.id, s.qc));
  });
}
authEvents.on('logout', () => {
  driverEpoch += 1;
  session = null;
  dropFiles(items);
  commit([]);
});

function watchSignal(): void {
  unwatch ??= NetInfo.addEventListener((s) => {
    online = isEffectivelyOnline({ isOnline: !!s.isConnected, isInternetReachable: s.isInternetReachable });
    flush();
  });
}
/** Adopt whoever is signed in (cache), read the signal once, then send what waits for them. */
async function adoptSignedIn(): Promise<void> {
  const epoch = driverEpoch;
  const [user, net] = await Promise.all([
    readUserCache().catch(() => null),
    NetInfo.fetch().catch(() => null),
  ]);
  if (epoch !== driverEpoch || !user?.id) return;
  if (net) online = isEffectivelyOnline({ isOnline: !!net.isConnected, isInternetReachable: net.isInternetReachable });
  if (session?.authorId !== user.id) session = { authorId: user.id, qc: session?.qc ?? queryClient };
  watchSignal();
  flush();
}
/** Started once at import (flag on): no root mount needed. Sign-in and sign-out re-read the author. */
export function startVoiceOutboxDriver(): void {
  // Flags can be unset while modules load (test mocks); the hook below starts it again on mount.
  if (driverStarted || !featureFlags?.communityVoiceNotes) return;
  driverStarted = true;
  authEvents.onAuthChange(() => void adoptSignedIn());
  void adoptSignedIn();
}

/** Test seam: an empty store, online; nothing saved unless it is a cold start. */
export function resetVoiceOutbox(coldStart = false): void {
  online = true;
  restored = null;
  session = null;
  unwatch?.();
  unwatch = null;
  driverEpoch += 1;
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
  patch(id, { status: 'sending', progress: 0 });
  try {
    await publishVoiceNote(item.workspaceId, item.input, {
      onProgress: (f) => setProgress(id, f),
      uploadedKey: item.uploadedKey,
      onUploaded: (key) => patch(id, { uploadedKey: key }),
    });
    // Keep the row until the feed holds the real note, so nothing blinks out.
    await qc.invalidateQueries({ queryKey: voiceKeys.feedRoot(item.workspaceId) });
    remove(id);
    void HapticService.success(); // GOAL: the note is in; a soft success, not silence
  } catch (err) {
    // C-4: the server turned that key down (too old, or the bytes are gone): the next try uploads again.
    if (err instanceof CommunityApiError && err.status === 400) patch(id, { uploadedKey: undefined });
    // Offline by now: wait for the signal. Online: say it did not send.
    patch(id, { status: online ? 'failed' : 'waiting' });
    if (online) void HapticService.error();
  }
}

export interface VoiceOutbox {
  items: VoiceOutboxItem[];
  online: boolean;
  send: (recording: VoiceRecordingResult, opts?: { cohortId?: string; conversationId?: string }) => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
}

export function useVoiceOutbox(workspaceId: string | null, authorId: string | null): VoiceOutbox {
  const qc = useQueryClient();
  const isOnline = isEffectivelyOnline(useNetworkStatus());
  const all = useSyncExternalStore(subscribe, () => items);

  // Session scope (B2): the listener outlives this screen, so a waiting note sends from any screen.
  useEffect(() => {
    startVoiceOutboxDriver(); // no-op once started at import
    online = isOnline;
    if (authorId) session = { authorId, qc };
    watchSignal();
    flush();
  }, [authorId, isOnline, qc]);

  const send = useCallback<VoiceOutbox['send']>(
    (recording, opts) => {
      if (!workspaceId || !authorId) return;
      const id = `local-${Date.now()}-${(seq += 1)}`;
      const { uri, durationMs, bytes, mimeType, peaks } = recording;
      const input: VoiceUploadInput = { uri, durationMs, bytes, mimeType };
      if (opts?.cohortId) input.cohortId = opts.cohortId;
      if (opts?.conversationId) input.conversationId = opts.conversationId;
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

startVoiceOutboxDriver();
