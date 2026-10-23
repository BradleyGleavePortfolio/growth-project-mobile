/**
 * SC-M2 (FX-871 PR 2, agent 170): the space chat's voice notes on m#848's outbox (useVoiceOutbox, FX-848). Sending
 * passes the space (`cohortId`): the server makes the note a chat message in that space (same id) and pings the
 * stream. This hook keeps the outbox items for this space (and this person), with the time each was first seen so
 * they sit at the newest end of the stream in a stable order, and refreshes the space's messages when an item leaves
 * the outbox (sent: the server row takes its place; discarded: nothing changes).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useVoiceOutbox, type VoiceOutboxItem } from '../../../hooks/useVoiceOutbox';
import type { VoiceRecordingResult } from '../../../hooks/voiceRecorderPort';
import { spaceChatKey } from './useSpaceChat';

export interface SpaceVoiceRow { v: VoiceOutboxItem; at: string }

export function useSpaceVoiceOutbox(workspaceId: string | null, userId: string | null, cohortId: string) {
  const qc = useQueryClient();
  const outbox = useVoiceOutbox(workspaceId, userId);
  const seen = useRef(new Map<string, string>());
  const mine = outbox.items.filter((v) => v.input.cohortId === cohortId && v.authorId === userId);
  const ids = mine.map((v) => v.id).join(',');
  // A new array only when an item comes, goes or changes state (the outbox hands back a fresh list each render).
  const sig = mine.map((v) => `${v.id}:${v.status}`).join(',');
  const rows: SpaceVoiceRow[] = useMemo(() => mine.map((v) => {
    if (!seen.current.has(v.id)) seen.current.set(v.id, new Date().toISOString());
    return { v, at: seen.current.get(v.id) as string };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sig]);

  const prev = useRef<string>('');
  useEffect(() => {
    const before = prev.current ? prev.current.split(',') : [];
    prev.current = ids;
    const now = new Set(ids ? ids.split(',') : []);
    if (before.some((id) => !now.has(id)) && userId) {
      for (const id of before) if (!now.has(id)) seen.current.delete(id);
      void qc.invalidateQueries({ queryKey: spaceChatKey(userId, cohortId) });
    }
  }, [ids, qc, userId, cohortId]);

  const { send, retry, discard } = outbox;
  return useMemo(() => ({
    rows,
    send: (recording: VoiceRecordingResult) => send(recording, { cohortId }),
    retry,
    discard,
  }), [rows, send, retry, discard, cohortId]);
}
