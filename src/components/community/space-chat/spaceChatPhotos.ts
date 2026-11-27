/**
 * SC-M4 (agent 203; owner #167-7 op 1, his 10-23 "photos only for v1", 203-D8 op 1, iPhone only by 203-D34 op 1): a photo
 * from the phone's photo library into a space chat. The pick, its checks, the rows in memory, the send and the sign-out.
 *   - The pick: expo-image-picker's own grid with m#992's MEAL_PHOTO_OPTIONS (quality 0.8, no EXIF, the Compatible
 *     representation), so on iPhone every photo is a fresh JPEG the picker wrote from the pixels: no location, device or
 *     author data leaves the phone (203-D8). The picker and the options are required at the pick, never at load: the
 *     options' file holds the food log's store and its sign-out listeners. No permission is asked (the grid needs none).
 *   - The checks are m#992's (mealPhoto.ts:131-147): the written file's real size 1 to 10,485,760 bytes, rounded sides
 *     1 to 10,000, image/jpeg (the server's limits, mealPhotoApi.ts:9-10). Anything else is deleted and told.
 *   - A good photo is a row at once (Sending…) and goes out one at a time, oldest first: an upload link, one upload and
 *     the photo message (spaceChatPhotoApi), under one Idempotency-Key for the row's whole life. A try runs only the
 *     steps the row still needs. A photo message already sent with a key is sent again with that same key first (the
 *     server answers a resend with the first message only for the same upload: community-messages.service.ts replay).
 *   - Sent now or told now (R5): no row ever waits. An answer that may change later reads Not sent (Try again, Delete);
 *     a refusal for good is one alert and the row goes; "not let in" takes the row and reads the space again, and the
 *     page closes by its own rule. A sent row leaves once the space's list carries it.
 *   - FIX-938 B3: a photo goes out only under the sign-in that picked it, or a later sign-in of the same account.
 *   - Nothing is saved: the rows live in memory for the signed-in person, and each picked file is deleted when its row
 *     leaves for any reason or after a pick that made no row. A sign-out wipes them all; it counts them first
 *     (services/signOutQueues, 'space-photos'). A send keeps going when the page or the space is left.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { deleteAsync, getInfoAsync } from 'expo-file-system/legacy';
import { MEAL_PHOTO_MAX_BYTES, MEAL_PHOTO_MAX_SIDE } from '../../../api/mealPhotoApi';
import { CommunityApiError } from '../../../api/apiCall';
import { describeCommunityFailure } from '../../../api/communityErrors';
import { communityErrorCode } from '../../../api/communitySafetyApi';
import { errorMessage } from '../../../types/common';
import { authEvents } from '../../../utils/authEvents';
import { generateIdempotencyKey, randomUuid } from '../../../utils/idempotency';
import { registerSignOutQueue } from '../../../services/signOutQueues';
import { isEffectivelyOnline } from '../../../hooks/useNetworkStatus';
import { AccountChangedError, bindingIsCurrent, captureAccountBinding, isAccountChangedError } from '../../../services/accountBinding';
import { sessionGeneration, sessionWritesSettled } from '../../../services/sessionFence';
import { spaceChatKey } from './useSpaceChat';
import { spaceChatPhotoApi, type SpacePhotoLink } from './spaceChatPhotoApi';
import type { SpaceMessage, SpacePublisher } from './spaceChatApi';

export type SpacePhotoState = 'sending' | 'failed' | 'sent';
/** What the screen draws (SpaceChatRow: the local file at its own shape, the head word from the state). */
export interface SpacePhotoRow {
  id: string; userId: string; cohortId: string; uri: string; width: number; height: number; createdAt: string;
  state: SpacePhotoState; serverId?: string;
}
/** What only the send reads, never drawn: the account, the Idempotency-Key and the link in hand. */
interface Wire {
  subject: string; idempotencyKey: string; size: number; by: SpacePublisher | null;
  link: SpacePhotoLink | null; uploaded: boolean; asked: boolean;
}

let rows: SpacePhotoRow[] = [];
const wires = new Map<string, Wire>();
// Each sign-out starts a new generation: a pick or a send still out for an earlier one never touches the rows.
let gen = 0;
let running = -1;
let flushing: Promise<void> = Promise.resolve();
let online = true;
let busy = false;
// The app's query client, from the last screen that held the hook: a send's answer reads the space's list again
// even after the page was left (the list is in front again on the next visit anyway).
let lists: QueryClient | null = null;
const subs = new Set<() => void>();

const OFFLINE = new CommunityApiError('network', 0, 'offline', { isAxiosError: true });
const UNUSABLE = { response: { status: 422, data: { code: 'community.image.not_jpeg' } } };
const tell = (err: unknown) => {
  const f = describeCommunityFailure(err, 'send_photo');
  Alert.alert(f.title, f.message);
};
const KEY_GONE = new Set(['community.image.key_invalid', 'community.image.missing']);
const KEY_FINAL = new Set([...KEY_GONE, 'community.image.key_used']);
const REFUSED = new Set(['PHOTO_NOT_ALLOWED', 'community.image.has_location', 'community.image.not_jpeg', 'community.image.too_large']);

function set(next: SpacePhotoRow[]): void {
  rows = next;
  subs.forEach((fn) => fn());
}
const patch = (id: string, change: Partial<SpacePhotoRow>) => set(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));

/** The picker's file goes with its row (or with a pick that made none). */
function forget(uri: string): void {
  void Promise.resolve().then(() => deleteAsync(uri, { idempotent: true })).catch(() => undefined);
}
function drop(ids: ReadonlySet<string>): void {
  const gone = rows.filter((r) => ids.has(r.id));
  if (!gone.length) return;
  gone.forEach((r) => { wires.delete(r.id); forget(r.uri); });
  set(rows.filter((r) => !ids.has(r.id)));
}
const reread = (r: SpacePhotoRow) => { void lists?.invalidateQueries({ queryKey: spaceChatKey(r.userId, r.cohortId) }); };

/** The sign-in a row goes out under: the one that picked it while it holds, else a later one of the same account. */
async function publisher(w: Wire, g: number): Promise<SpacePublisher | null> {
  if (w.by && bindingIsCurrent(w.by.binding) && w.by.session === sessionGeneration()) return w.by;
  await sessionWritesSettled();
  const session = sessionGeneration();
  const binding = await captureAccountBinding();
  if (gen !== g || !binding || session !== sessionGeneration() || binding.subject !== w.subject) return null;
  w.by = { binding, session };
  return w.by;
}

type Outcome = 'closed' | 'refused' | 'later';
/** Call 1's plain 404 is photos off on the server (Not sent), never a closed space (trap 1); call 3's 403 / 404 is. */
function outcomeOf(err: unknown, step: 1 | 3): Outcome {
  const status = (err as { status?: number } | null)?.status;
  const code = communityErrorCode(err);
  if (step === 1) return status === 404 && code === 'community.cohort.not_found' ? 'closed' : 'later';
  if (status === 403 || status === 404) return 'closed';
  return status === 422 && !!code && REFUSED.has(code) ? 'refused' : 'later';
}

/** One try of one row: the steps it still needs, under its account. Resolves when the row has settled. */
async function attempt(row: SpacePhotoRow, g: number): Promise<void> {
  const w = wires.get(row.id);
  if (!w || !online) { patch(row.id, { state: 'failed' }); return; }
  let step: 1 | 3 = 1;
  for (let round = 0; round < 2; round += 1) {
    const by = await publisher(w, g);
    if (gen !== g || !wires.has(row.id)) return;
    if (!by) { patch(row.id, { state: 'failed' }); return; }
    try {
      let renewed = false;
      for (;;) {
        // A link is used again only while it is live and its upload went through, or once its photo message went out.
        if (!w.link || !w.uploaded || (!w.asked && Date.now() >= w.link.expiresAt)) {
          step = 1;
          w.link = null;
          w.uploaded = false;
          w.asked = false;
          const link = await spaceChatPhotoApi.issueUploadLink(row.cohortId, w.size, by);
          if (gen !== g) return;
          if (!bindingIsCurrent(by.binding)) throw new AccountChangedError(false);
          const done = await spaceChatPhotoApi.uploadBytes(link, row.uri);
          if (gen !== g) return;
          if (!done) { patch(row.id, { state: 'failed' }); return; }
          w.link = link;
          w.uploaded = true;
        }
        step = 3;
        w.asked = true;
        try {
          const sent = await spaceChatPhotoApi.create(row.cohortId, { key: w.link.key, width: row.width, height: row.height }, w.idempotencyKey, by);
          if (gen !== g) return;
          wires.delete(row.id);
          patch(row.id, { state: 'sent', serverId: sent.id });
          reread(row);
          return;
        } catch (err) {
          const code = communityErrorCode(err);
          if (gen === g && !renewed && code && KEY_GONE.has(code)) {
            renewed = true;
            w.link = null;
            continue;
          }
          if (code && KEY_FINAL.has(code)) w.link = null;
          throw err;
        }
      }
    } catch (err) {
      if (gen !== g || !wires.has(row.id)) return;
      // Its sign-in ended on the way (a 'login' of the same account): once more under the next one.
      if (round === 0 && (!bindingIsCurrent(by.binding) || isAccountChangedError(err) || isAccountChangedError((err as { cause?: unknown })?.cause))) continue;
      const outcome = outcomeOf(err, step);
      if (outcome === 'later') { patch(row.id, { state: 'failed' }); return; }
      drop(new Set([row.id]));
      if (outcome === 'refused') tell(err);
      else reread(row);
      return;
    }
  }
  patch(row.id, { state: 'failed' });
}

/** One photo at a time, oldest first; resolves when none is left to send. */
function flush(): Promise<void> {
  if (running !== gen) flushing = drain();
  return flushing;
}
async function drain(): Promise<void> {
  if (running === gen) return;
  const g = gen;
  running = g;
  try {
    for (;;) {
      const next = rows.filter((r) => r.state === 'sending').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!next || gen !== g) break;
      await attempt(next, g);
    }
  } finally {
    if (running === g) running = -1;
  }
}

const sizeOf = async (uri: string): Promise<number> => {
  try {
    const info = await getInfoAsync(uri);
    return info.exists ? info.size : 0;
  } catch {
    return 0;
  }
};
const within = (n: number, max: number) => n >= 1 && n <= max;

/** True from Photo library to the end of the pick's checks: a second tap starts nothing (B.5). */
export const spacePhotoBusy = (): boolean => busy;

/** Photo library: the phone's grid, the checks, then a row that sends at once. Offline: told, the grid stays shut. */
export async function pickSpacePhoto(cohortId: string, userId: string | null, isOnline: boolean): Promise<void> {
  if (busy || !userId) return;
  busy = true;
  const g = gen;
  try {
    if (!isOnline) { tell(OFFLINE); return; }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MEAL_PHOTO_OPTIONS } = require('../../../utils/log/mealPhoto') as typeof import('../../../utils/log/mealPhoto');
    let result: Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>;
    try {
      result = await ImagePicker.launchImageLibraryAsync(MEAL_PHOTO_OPTIONS);
    } catch {
      Alert.alert(describeCommunityFailure(OFFLINE, 'send_photo').title, errorMessage(null));
      return;
    }
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    const size = await sizeOf(asset.uri);
    const width = Math.round(asset.width);
    const height = Math.round(asset.height);
    if (gen !== g) { forget(asset.uri); return; }
    if (asset.mimeType !== 'image/jpeg' || !within(size, MEAL_PHOTO_MAX_BYTES)
      || !within(width, MEAL_PHOTO_MAX_SIDE) || !within(height, MEAL_PHOTO_MAX_SIDE)) {
      forget(asset.uri);
      tell(UNUSABLE);
      return;
    }
    await sessionWritesSettled();
    const session = sessionGeneration();
    const binding = await captureAccountBinding();
    if (gen !== g || !binding || session !== sessionGeneration()) { forget(asset.uri); return; }
    const id = randomUuid();
    wires.set(id, { subject: binding.subject, idempotencyKey: generateIdempotencyKey(), size, by: { binding, session }, link: null, uploaded: false, asked: false });
    set([...rows, { id, userId, cohortId, uri: asset.uri, width, height, createdAt: new Date().toISOString(), state: 'sending' }]);
    void flush();
  } finally {
    busy = false;
  }
}

/** Try again: the same row, the same Idempotency-Key, from the step it still needs. */
export function retrySpacePhoto(id: string): void {
  if (!rows.some((r) => r.id === id && r.state === 'failed')) return;
  patch(id, { state: 'sending' });
  void flush();
}
/** Delete: only a photo not on its way and not taken by the server (SpaceChatRow draws no Delete for those). */
export function discardSpacePhoto(id: string): void {
  if (rows.some((r) => r.id === id && r.state === 'failed')) drop(new Set([id]));
}

// Only a sign-out wipes them ('login' is the same account reading its session again, LO-938R2 B1).
function wipe(): void {
  gen += 1;
  busy = false;
  lists = null;
  drop(new Set(rows.map((r) => r.id)));
  wires.clear();
}
try {
  authEvents.on('logout', wipe);
} catch {
  // A test double without named events.
}
// A queue that is wiped is a queue that is counted (signOutQueues.ts:1-7): this account's photos the server has not
// taken, and one try for those that can still go.
registerSignOutQueue('space-photos', {
  count: async (userId) => rows.filter((r) => r.userId === userId && r.state !== 'sent').length,
  send: async (userId) => {
    const s = await NetInfo.fetch();
    online = isEffectivelyOnline({ isOnline: !!s.isConnected, isInternetReachable: s.isInternetReachable ?? null });
    set(rows.map((r) => (r.userId === userId && r.state === 'failed' ? { ...r, state: 'sending' } : r)));
    await flush();
  },
});

const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
const snapshot = () => rows;

/** This space's photos for the signed-in person, the pick, and the screen's part in their life. */
export function useSpacePhotos(cohortId: string, userId: string | null, isOnline: boolean, messages: readonly SpaceMessage[], closed: boolean) {
  const qc = useQueryClient();
  useEffect(() => { lists = qc; }, [qc]);
  useEffect(() => { online = isOnline; }, [isOnline]);
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const here = useMemo(() => all.filter((r) => r.userId === userId && r.cohortId === cohortId), [all, userId, cohortId]);
  // A sent photo leaves once the list carries it; a closed space keeps none that is not on its way.
  useEffect(() => {
    const listed = new Set(messages.map((m) => m.id));
    drop(new Set(here.filter((r) => (r.state === 'sent' && !!r.serverId && listed.has(r.serverId)) || (closed && r.state === 'failed')).map((r) => r.id)));
  }, [messages, here, closed]);
  const pick = useCallback(() => { void pickSpacePhoto(cohortId, userId, isOnline); }, [cohortId, userId, isOnline]);
  return { rows: here, pick };
}
