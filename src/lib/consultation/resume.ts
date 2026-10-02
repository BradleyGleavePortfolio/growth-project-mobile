/**
 * Resume reconciliation between this device's draft and the server copy
 * (Sol B-03). Pure, so every case is unit-tested.
 *
 * Rules:
 *   1. No local draft (or an empty one): the server copy wins.
 *   2. No server answers: the local draft wins.
 *   3. Local draft has no unsynced edits: the server copy is canonical (it may
 *      hold newer answers from another device); the local screen is kept.
 *   4. Local draft has unsynced edits:
 *      - the server has not changed since this device last synced (same
 *        revision, or a saved_at no newer than the one we saw): local wins and
 *        stays dirty, so the next save sends it;
 *      - the server changed since (another device saved): the newer of the
 *        two by timestamp wins (local `editedAt` vs server `saved_at`). A
 *        losing local draft is discarded, never sent over the newer server copy.
 *
 * Revision numbers are compared when both sides have them; timestamps are the
 * fallback. Clock skew between devices can only decide a genuine conflict,
 * never overwrite a server copy that has not changed.
 */
import type { LocalConsultationState, SyncedMarker } from './storage';
import type { Answers } from './types';

export interface ServerDraft {
  answers: Answers | null;
  saved_at?: string | null;
  revision?: number | null;
}

export interface ResumeDecision {
  answers: Answers;
  screenId: string | null;
  dirty: boolean;
  synced: SyncedMarker | null;
  source: 'local' | 'server' | 'empty';
}

function ts(v: string | null | undefined): number {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function nonEmpty(a: Answers | null | undefined): a is Answers {
  return !!a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length > 0;
}

export function serverChangedSince(local: SyncedMarker | null, server: ServerDraft): boolean {
  const sr = server.revision;
  const lr = local?.revision;
  if (typeof sr === 'number' && typeof lr === 'number') return sr > lr;
  const st = ts(server.saved_at);
  if (Number.isNaN(st)) return false; // Server cannot tell us when: treat as unchanged.
  const lt = ts(local?.saved_at);
  if (Number.isNaN(lt)) return true; // We never synced, the server has a copy.
  return st > lt;
}

export function reconcileResume(local: LocalConsultationState | null, server: ServerDraft | null): ResumeDecision {
  const serverMarker: SyncedMarker | null = server
    ? { saved_at: server.saved_at ?? null, revision: typeof server.revision === 'number' ? server.revision : null }
    : null;
  const localAnswers = local && nonEmpty(local.answers) ? local.answers : null;
  const serverAnswers = server && nonEmpty(server.answers) ? server.answers : null;

  if (!localAnswers && !serverAnswers) {
    return { answers: {}, screenId: local?.screenId ?? null, dirty: false, synced: serverMarker, source: 'empty' };
  }
  if (!localAnswers) {
    return { answers: serverAnswers!, screenId: local?.screenId ?? null, dirty: false, synced: serverMarker, source: 'server' };
  }
  if (!serverAnswers || !server) {
    return { answers: localAnswers, screenId: local!.screenId, dirty: local!.dirty !== false, synced: local!.synced ?? null, source: 'local' };
  }
  if (!local!.dirty) {
    return { answers: serverAnswers, screenId: local!.screenId, dirty: false, synced: serverMarker, source: 'server' };
  }
  if (!serverChangedSince(local!.synced ?? null, server)) {
    return { answers: localAnswers, screenId: local!.screenId, dirty: true, synced: local!.synced ?? serverMarker, source: 'local' };
  }
  const localTs = ts(local!.editedAt ?? local!.updatedAt);
  const serverTs = ts(server.saved_at);
  if (!Number.isNaN(localTs) && (Number.isNaN(serverTs) || localTs > serverTs)) {
    // Newer unsynced local edits: keep them; the next save is based on the server's revision.
    return { answers: localAnswers, screenId: local!.screenId, dirty: true, synced: serverMarker, source: 'local' };
  }
  return { answers: serverAnswers, screenId: local!.screenId, dirty: false, synced: serverMarker, source: 'server' };
}
