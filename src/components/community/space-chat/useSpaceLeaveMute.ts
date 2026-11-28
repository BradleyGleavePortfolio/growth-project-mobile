/**
 * LEAVE-MUTE-M (agent 203; owner D2; LEAVE-MUTE-MOCK Style 1): one space's leave and mute state for the space chat, and
 * the one Join the chat, Home's toast and the tree share.
 *   - Reads (b#1168, SC-BE2): the notification setting, who left (the "{name} left" lines) and her thread states, each
 *     only while the server lets her read the space (`admitted`), kept in memory only (meta persist: false) under keys
 *     holding her user id, so a cold start, a sign-out or another account never shows them. A membership ping re-reads
 *     the left lists (useCommunity onCommunityPing); so does a change of the space's member count in the list.
 *   - Actions (R3): never optimistic. Each waits for the server; while one runs `busy` names it and a second tap does
 *     nothing; the answer is written into the cache (the screen changes only then); a failure leaves everything as it was
 *     and hands the screen one line (describeCommunityFailure) with Try again. Unmute clears a running silence and, on
 *     Mute all, sets the default mode, never a mode she did not pick (R4).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { communityKeys } from '../../../hooks/useCommunity';
import { describeCommunityFailure } from '../../../api/communityErrors';
import type { CommunityCohortListResponse } from '../../../api/communityApi';
import { spaceOutbox } from './spaceChatOutbox';
import {
  spaceLeaveMuteApi, type NotifyMode, type SilenceHours, type SpaceLeave, type SpaceNotify, type SpaceThreadState, type ThreadStateName,
} from './spaceLeaveMuteApi';

export const spaceNotifyKey = (userId: string, cohortId: string) => ['community', 'space-notify', userId, cohortId] as const;
export const spaceLeftKey = (userId: string, cohortId: string) => ['community', 'space-left', userId, cohortId] as const;
export const spaceThreadsKey = (userId: string, cohortId: string) => ['community', 'space-threads', userId, cohortId] as const;
/** Every left list on the phone (the membership ping re-reads them). */
export const SPACE_LEFT_ALL = ['community', 'space-left'] as const;

/** What a failed action says, for the toast (the app's community words: offline, 404, 409 and the rest). */
export const failureLine = (err: unknown): string => describeCommunityFailure(err, 'moderate').message;

export interface SpaceFailure { message: string; retry: () => void }

/** Writes the server's answer to a leave or a join into the one space list (no second list, no guess). */
export function writeLeave(qc: QueryClient, answer: SpaceLeave): void {
  qc.setQueryData<CommunityCohortListResponse>(communityKeys.cohorts(), (list) => list && {
    ...list,
    cohorts: list.cohorts.map((c) => (c.id === answer.cohort_id ? { ...c, left_at: answer.left_at } : c)),
  });
  void qc.invalidateQueries({ queryKey: communityKeys.cohorts() });
  void qc.invalidateQueries({ queryKey: SPACE_LEFT_ALL });
}

/** Join a space again (Join again, Undo, the tree's Join): one call per space at a time, the list changes on the answer. */
export function useJoinSpace(onJoined?: (cohortId: string) => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const running = useRef(new Set<string>());
  const [failed, setFailed] = useState<Record<string, string>>({});
  const joined = useRef(onJoined);
  joined.current = onJoined;
  const join = useCallback((cohortId: string) => {
    if (running.current.has(cohortId)) return;
    running.current.add(cohortId);
    setBusy(new Set(running.current));
    setFailed(({ [cohortId]: _gone, ...rest }) => rest);
    spaceLeaveMuteApi.join(cohortId).then((answer) => {
      writeLeave(qc, answer);
      joined.current?.(cohortId);
    }, (err: unknown) => {
      setFailed((f) => ({ ...f, [cohortId]: failureLine(err) }));
    }).finally(() => {
      running.current.delete(cohortId);
      setBusy(new Set(running.current));
    });
  }, [qc]);
  return { join, busy, failed };
}

export type BellAction = { kind: 'mode'; mode: NotifyMode } | { kind: 'silence'; hours: SilenceHours } | { kind: 'unmute' };

export function useSpaceLeaveMute(cohortId: string, userId: string | null, opts: { admitted: boolean; left: boolean; memberCount?: number }) {
  const qc = useQueryClient();
  const uid = userId ?? '';
  const on = !!userId && !!cohortId && opts.admitted;
  const notify = useQuery({
    queryKey: spaceNotifyKey(uid, cohortId),
    enabled: on && !opts.left,
    queryFn: () => spaceLeaveMuteApi.getNotify(cohortId),
    retry: false,
    meta: { persist: false },
  });
  const left = useQuery({
    queryKey: spaceLeftKey(uid, cohortId),
    enabled: on,
    queryFn: () => spaceLeaveMuteApi.listLeft(cohortId),
    retry: false,
    meta: { persist: false },
  });
  const threads = useQuery({
    queryKey: spaceThreadsKey(uid, cohortId),
    enabled: on && !opts.left,
    queryFn: () => spaceLeaveMuteApi.listThreads(cohortId),
    retry: false,
    meta: { persist: false },
  });
  // A leave or a rejoin changes the space's count in the list: read who left again (the ping may be off on the server).
  const count = useRef(opts.memberCount);
  useEffect(() => {
    if (opts.memberCount === undefined || opts.memberCount === count.current) return;
    const first = count.current === undefined;
    count.current = opts.memberCount;
    if (!first) void qc.invalidateQueries({ queryKey: spaceLeftKey(uid, cohortId) });
  }, [opts.memberCount, qc, uid, cohortId]);
  // Her own reply follows a left thread again on the server (b#1168): read the states again once it is sent.
  useEffect(() => spaceOutbox.onSent((id) => {
    if (id === cohortId) void qc.invalidateQueries({ queryKey: spaceThreadsKey(uid, cohortId) });
  }), [qc, uid, cohortId]);

  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef<string | null>(null);
  const [failure, setFailure] = useState<SpaceFailure | null>(null);
  /** One action at a time: `name` shows where it runs; the answer is applied only when it comes. */
  const run = useCallback(<T,>(name: string, work: () => Promise<T>, done: (answer: T) => void) => {
    if (running.current) return;
    running.current = name;
    setBusy(name);
    setFailure(null);
    const again = () => { setFailure(null); run(name, work, done); };
    work().then(done, (err: unknown) => setFailure({ message: failureLine(err), retry: again })).finally(() => {
      running.current = null;
      setBusy(null);
    });
  }, []);

  const clearFailure = useCallback(() => setFailure(null), []);
  const setNotify = useCallback((answer: SpaceNotify) => qc.setQueryData(spaceNotifyKey(uid, cohortId), answer), [qc, uid, cohortId]);
  const bell = useCallback((action: BellAction) => {
    if (action.kind === 'mode') run('bell', () => spaceLeaveMuteApi.setMode(cohortId, action.mode), setNotify);
    else if (action.kind === 'silence') run('bell', () => spaceLeaveMuteApi.silence(cohortId, action.hours), setNotify);
    else {
      const was = notify.data;
      run('bell', async () => {
        let now = was?.silenced_until ? await spaceLeaveMuteApi.unsilence(cohortId) : was;
        if (now?.mode === 'mute_all') now = await spaceLeaveMuteApi.setMode(cohortId, now.default_mode);
        return now ?? spaceLeaveMuteApi.getNotify(cohortId);
      }, setNotify);
    }
  }, [run, cohortId, setNotify, notify.data]);

  const leave = useCallback((onLeft: (answer: SpaceLeave) => void) => {
    run('leave', () => spaceLeaveMuteApi.leave(cohortId), (answer) => { writeLeave(qc, answer); onLeft(answer); });
  }, [run, cohortId, qc]);
  const join = useCallback(() => {
    run('join', () => spaceLeaveMuteApi.join(cohortId), (answer) => writeLeave(qc, answer));
  }, [run, cohortId, qc]);

  const writeThread = useCallback((id: string, state: SpaceThreadState | null) => {
    qc.setQueryData<SpaceThreadState[]>(spaceThreadsKey(uid, cohortId), (list) => [
      ...(list ?? []).filter((t) => t.thread_message_id !== id),
      ...(state ? [state] : []),
    ]);
  }, [qc, uid, cohortId]);
  /** Set (Mute thread, Leave thread) or clear (Unmute thread, Follow thread) a thread's state; `then` runs on the answer. */
  const thread = useCallback((threadId: string, state: ThreadStateName, on: boolean, then?: () => void) => {
    run(`thread-${threadId}`, () => (on ? spaceLeaveMuteApi.setThread(cohortId, threadId, state) : spaceLeaveMuteApi.clearThread(cohortId, threadId, state).then(() => null)),
      (answer) => { writeThread(threadId, answer); then?.(); });
  }, [run, cohortId, writeThread]);

  const threadStates = threads.data;
  const stateOf = useMemo(() => {
    const m = new Map((threadStates ?? []).map((t) => [t.thread_message_id, t.state]));
    return (id: string) => m.get(id);
  }, [threadStates]);

  return {
    notify: notify.data ?? null,
    lefts: left.data ?? EMPTY_LEFT,
    threads: threadStates ?? EMPTY_THREADS,
    stateOf,
    busy,
    failure,
    clearFailure,
    bell,
    leave,
    join,
    thread,
  };
}

const EMPTY_LEFT: never[] = [];
const EMPTY_THREADS: SpaceThreadState[] = [];
