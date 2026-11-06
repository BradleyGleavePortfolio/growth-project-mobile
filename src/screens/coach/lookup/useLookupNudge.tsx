/**
 * UI-4: the bell and Nudge buttons open today's nudge form (client-detail NudgeModal) over the list.
 * LS-933R3 B1: a nudge is messaging, so its form takes the peek's pair gate. `pairOf` is the lookup's settled answer
 * for a client (the one the peek's gate reads): the form opens, and stays, only while it is 'open' and no closed
 * refusal is remembered for that client (closedRefusals, the store the peek's and the chat's gates read). A send the
 * server refuses as closed (isClosedRefusal, e.g. 403 messaging.blocked) is remembered for the session, handed to the
 * lookup (`onRefused`) and takes the form and its Send away at once; the words stay with that client, as a refused
 * chat send keeps its draft. A plain network error keeps the form, its words and Send, with the error shown.
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { closedRefusals, isClosedRefusal } from '../../../components/messaging/closedRefusal';
import { coachApi } from '../../../services/api';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { errorMessage } from '../../../types/common';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { rosterDisplayName, type RosterClient } from '../../../utils/coach/clientRoster';
import { NudgeModal } from '../client-detail/NudgeModal';
import { makeStyles } from '../client-detail/styles';
import type { PeekPair } from './ClientPeekSheet';

export function useLookupNudge(colors: ThemeColors, pairOf: (c: RosterClient) => PeekPair, onRefused: (id: string) => void) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [client, setClient] = useState<RosterClient | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const draftFor = useRef<string | null>(null); // the draft belongs to one client: Cancel keeps it for that client only
  const remembered = useSyncExternalStore(closedRefusals.subscribe, () => closedRefusals.has(client?.id));
  const live = client != null && pairOf(client) === 'open' && !remembered;
  useEffect(() => {
    if (client && !live) { setClient(null); setError(''); } // the pair closed (or went unread) under an open form
  }, [client, live]);

  const close = () => { setClient(null); setError(''); };
  const send = async () => {
    if (!client || !live) return;
    setError('');
    if (!title.trim() || !body.trim()) {
      setError('Title and message are both required.');
      void HapticService.warning();
      return;
    }
    setSending(true);
    try {
      await coachApi.sendNudge(client.id, { title: title.trim(), body: body.trim() });
      void HapticService.success();
      setTitle(''); setBody(''); close();
    } catch (err) {
      if (isClosedRefusal(err)) {
        closedRefusals.add(client.id); // the peek's gate closes on it and draws the chat's closed line
        onRefused(client.id);
        void HapticService.warning();
        close();
        return;
      }
      void HapticService.error();
      setError(errorMessage(err, 'Failed to send nudge.'));
    } finally {
      setSending(false);
    }
  };

  const modal = (
    <NudgeModal
      visible={live}
      onClose={close}
      clientName={client ? rosterDisplayName(client) : ''}
      nudgeTitle={title}
      setNudgeTitle={setTitle}
      nudgeBody={body}
      setNudgeBody={setBody}
      nudgeError={error}
      nudgeSending={sending}
      onSend={send}
      colors={colors}
      styles={styles}
    />
  );
  /** Opens the form only for a pair known open; false otherwise, so the caller can show why instead. */
  const open = (c: RosterClient): boolean => {
    if (pairOf(c) !== 'open' || closedRefusals.has(c.id)) return false;
    if (draftFor.current !== c.id) { draftFor.current = c.id; setTitle(''); setBody(''); }
    setError('');
    setClient(c);
    return true;
  };
  return { open, modal };
}
