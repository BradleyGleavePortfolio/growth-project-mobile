/**
 * Local resume draft for the consultation, per user (Sol A-04 fix round).
 *
 * The draft holds health, body and screening answers, so:
 *   - it lives in the platform's encrypted store (expo-secure-store: iOS
 *     Keychain / Android Keystore, this-device-only, not backed up), split
 *     into small chunks because SecureStore values should stay under 2 KB;
 *     raw AsyncStorage is never used for it (a legacy plaintext key from the
 *     first build of this PR is deleted on read and on sign-out);
 *   - on web (no secure store) nothing is persisted: the draft is memory only;
 *   - retention is bounded: a draft untouched for DRAFT_RETENTION_MS is
 *     deleted on the next read, and the draft is deleted when onboarding
 *     finishes, on sign-out and on an account-deletion request;
 *   - writes are fenced per user: `purgeConsultationDraft(userId)` bumps the
 *     user's epoch, drains the serialized write chain and then deletes, so a
 *     write that was already pending (or arrives late from a screen that is
 *     unmounting) can never resurrect the draft after the purge;
 *   - reinstall (Opus C-7): iOS Keychain items survive app deletion, so each
 *     draft write also sets a per-user install marker in AsyncStorage (which
 *     is removed with the app). A draft found without its marker belongs to
 *     an earlier install and is deleted on read instead of resumed.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { Answers } from './types';

export const DRAFT_VERSION = 'consult-v2' as const;
/** A draft nobody has touched for 30 days is deleted on the next read. */
export const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Characters per SecureStore value (UTF-8 worst case stays under 2 KB). */
export const DRAFT_CHUNK_CHARS = 600;
/** Upper bound on chunks (about 24 KB of draft); larger drafts are not stored. */
export const DRAFT_MAX_CHUNKS = 40;
/** Legacy plaintext AsyncStorage prefix (first build of PR #310). */
export const LEGACY_DRAFT_PREFIX = 'consultation_v1:';

export interface SyncedMarker {
  /** Server `saved_at` of the last save this device saw acknowledged. */
  saved_at: string | null;
  revision: number | null;
}

export interface LocalConsultationState {
  version: typeof DRAFT_VERSION;
  answers: Answers;
  screenId: string;
  /** Last write of this record (retention clock). */
  updatedAt: string;
  /** Last time an answer changed on this device. */
  editedAt: string;
  /** True while this device holds answer edits the server has not acknowledged. */
  dirty: boolean;
  /** What the server had when this device last synced. */
  synced: SyncedMarker | null;
  /**
   * Box 2 (Roman and AI) as last CONFIRMED by the AI consent ledger on this
   * device: true after a confirmed grant, false after a confirmed withdrawal,
   * absent when unknown (Opus B-310-2). A yes/no flag, not health data.
   */
  aiRoman?: boolean;
}

export type DraftWrite = Omit<LocalConsultationState, 'version' | 'updatedAt'>;

/** The confirmed box 2 flag of a stored draft (unknown unless a real boolean). */
export function aiRomanOf(state: LocalConsultationState | null | undefined): boolean | null {
  return typeof state?.aiRoman === 'boolean' ? state.aiRoman : null;
}

const persistAvailable = () => Platform.OS !== 'web';
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function safeId(userId: string | null | undefined): string {
  return (userId || 'anon').replace(/[^A-Za-z0-9._-]/g, '_');
}
export function manifestKey(userId: string | null | undefined): string {
  return `consult_draft.${safeId(userId)}.m`;
}
function chunkKey(userId: string | null | undefined, gen: 'a' | 'b', i: number): string {
  return `consult_draft.${safeId(userId)}.${gen}${i}`;
}
/** AsyncStorage marker (no answer data) proving the draft was written by this install. */
export function installMarkerKey(userId: string | null | undefined): string {
  return `consult_draft_install:${safeId(userId)}`;
}
export function legacyStorageKey(userId: string | null | undefined): string {
  return `${LEGACY_DRAFT_PREFIX}${userId || 'anon'}`;
}

interface Manifest {
  v: 1;
  gen: 'a' | 'b';
  n: number;
  /** Highest chunk count ever written for this user, so purge removes every chunk. */
  peak: number;
}

// ── Write fence ────────────────────────────────────────────────────────────

const epochs = new Map<string, number>();
const chains = new Map<string, Promise<void>>();

function epochOf(userId: string | null | undefined): number {
  return epochs.get(safeId(userId)) ?? 0;
}

/** A write handle bound to the user's current epoch. */
export interface DraftHandle {
  readonly userId: string | null | undefined;
  readonly epoch: number;
}

/** Open a handle for a newly mounted flow. Purges invalidate older handles. */
export function openDraft(userId: string | null | undefined): DraftHandle {
  return { userId, epoch: epochOf(userId) };
}

export function isHandleLive(h: DraftHandle): boolean {
  return epochOf(h.userId) === h.epoch;
}

function enqueue(userId: string | null | undefined, task: () => Promise<void>): Promise<void> {
  const id = safeId(userId);
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.then(task, task).catch(() => undefined);
  chains.set(id, next);
  return next;
}

// ── Low-level secure read/write ────────────────────────────────────────────

async function readManifest(userId: string | null | undefined): Promise<Manifest | null> {
  try {
    const raw = await SecureStore.getItemAsync(manifestKey(userId), SECURE_OPTS);
    if (!raw) return null;
    const m = JSON.parse(raw) as Manifest;
    if (m?.v !== 1 || (m.gen !== 'a' && m.gen !== 'b') || !Number.isInteger(m.n) || m.n < 1 || m.n > DRAFT_MAX_CHUNKS) {
      return null;
    }
    return { ...m, peak: Math.min(DRAFT_MAX_CHUNKS, Math.max(m.n, Number(m.peak) || m.n)) };
  } catch {
    return null;
  }
}

async function deleteAll(userId: string | null | undefined, m: Manifest | null): Promise<void> {
  const peak = m?.peak ?? DRAFT_MAX_CHUNKS;
  const keys: string[] = [manifestKey(userId)];
  for (const gen of ['a', 'b'] as const) for (let i = 0; i < peak; i += 1) keys.push(chunkKey(userId, gen, i));
  await Promise.all(keys.map((k) => SecureStore.deleteItemAsync(k, SECURE_OPTS).catch(() => undefined)));
}

async function writeSecure(userId: string | null | undefined, json: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += DRAFT_CHUNK_CHARS) chunks.push(json.slice(i, i + DRAFT_CHUNK_CHARS));
  if (chunks.length > DRAFT_MAX_CHUNKS) return; // Bounded: an oversized draft is not stored.
  const prev = await readManifest(userId);
  const gen: 'a' | 'b' = prev?.gen === 'a' ? 'b' : 'a';
  // Raise the recorded peak BEFORE writing more chunks than ever before, so a
  // crash mid-write cannot leave chunks a later purge does not know about.
  if (prev && chunks.length > prev.peak) {
    await SecureStore.setItemAsync(manifestKey(userId), JSON.stringify({ ...prev, peak: chunks.length }), SECURE_OPTS);
  }
  for (let i = 0; i < chunks.length; i += 1) {
    await SecureStore.setItemAsync(chunkKey(userId, gen, i), chunks[i], SECURE_OPTS);
  }
  const peak = Math.max(chunks.length, prev?.peak ?? 0);
  const manifest: Manifest = { v: 1, gen, n: chunks.length, peak };
  await SecureStore.setItemAsync(manifestKey(userId), JSON.stringify(manifest), SECURE_OPTS);
  if (prev) {
    await Promise.all(
      Array.from({ length: prev.n }, (_, i) =>
        SecureStore.deleteItemAsync(chunkKey(userId, prev.gen, i), SECURE_OPTS).catch(() => undefined),
      ),
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function readLocalState(
  userId: string | null | undefined,
  now: Date = new Date(),
): Promise<LocalConsultationState | null> {
  // The first build of this PR wrote plaintext JSON to AsyncStorage: delete it.
  await AsyncStorage.removeItem(legacyStorageKey(userId)).catch(() => undefined);
  if (!persistAvailable()) return null;
  await (chains.get(safeId(userId)) ?? Promise.resolve());
  const m = await readManifest(userId);
  if (!m) return null;
  const marked = await AsyncStorage.getItem(installMarkerKey(userId)).catch(() => null);
  if (marked !== '1') {
    // Left in the Keychain by an earlier install of the app: delete, never resume.
    await enqueue(userId, () => deleteAll(userId, m));
    return null;
  }
  try {
    const parts: string[] = [];
    for (let i = 0; i < m.n; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(userId, m.gen, i), SECURE_OPTS);
      if (part == null) throw new Error('missing chunk');
      parts.push(part);
    }
    const parsed = JSON.parse(parts.join('')) as LocalConsultationState;
    if (parsed?.version !== DRAFT_VERSION || typeof parsed.answers !== 'object' || !parsed.answers || Array.isArray(parsed.answers)) {
      throw new Error('bad draft');
    }
    const touched = Date.parse(parsed.updatedAt);
    if (!Number.isFinite(touched) || now.getTime() - touched > DRAFT_RETENTION_MS) {
      throw new Error('expired draft');
    }
    return parsed;
  } catch {
    // Corrupt, partial or expired: delete it rather than keep health data around.
    await enqueue(userId, () => deleteAll(userId, m));
    return null;
  }
}

/**
 * Write the draft through a handle. Dropped (no-op) once the handle's epoch
 * has been retired by a purge, including writes that were queued before it.
 */
export function writeDraft(handle: DraftHandle, state: DraftWrite, now: Date = new Date()): Promise<void> {
  if (!persistAvailable() || !isHandleLive(handle)) return Promise.resolve();
  const full: LocalConsultationState = { version: DRAFT_VERSION, ...state, updatedAt: now.toISOString() };
  const json = JSON.stringify(full);
  return enqueue(handle.userId, async () => {
    if (!isHandleLive(handle)) return; // Fenced while waiting in the chain.
    try {
      await AsyncStorage.setItem(installMarkerKey(handle.userId), '1');
      await writeSecure(handle.userId, json);
    } catch {
      // Storage failure is non-fatal: the server copy is saved per chapter.
    }
  });
}

/** Convenience for tests and one-off writers: write with the current epoch. */
export function writeLocalState(
  userId: string | null | undefined,
  state: Partial<DraftWrite> & Pick<DraftWrite, 'answers' | 'screenId'>,
  now: Date = new Date(),
): Promise<void> {
  return writeDraft(
    openDraft(userId),
    { editedAt: now.toISOString(), dirty: true, synced: null, ...state },
    now,
  );
}

/**
 * Delete the user's draft and fence every outstanding handle. Used on
 * completion, sign-out and account deletion. Safe to call with no draft.
 */
export async function purgeConsultationDraft(userId: string | null | undefined): Promise<void> {
  const id = safeId(userId);
  epochs.set(id, epochOf(userId) + 1);
  await AsyncStorage.removeItem(legacyStorageKey(userId)).catch(() => undefined);
  if (!persistAvailable()) return;
  await enqueue(userId, async () => {
    await AsyncStorage.removeItem(installMarkerKey(userId)).catch(() => undefined);
    const m = await readManifest(userId);
    await deleteAll(userId, m);
  });
}
