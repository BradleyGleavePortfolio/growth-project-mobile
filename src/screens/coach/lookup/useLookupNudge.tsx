/**
 * UI-4: the bell and Nudge buttons open today's nudge form (client-detail NudgeModal) over the list.
 * LS-933R3 B1: a nudge is messaging, so its form takes the peek's pair gate. `pairOf` is the lookup's settled answer
 * for a client (the one the peek's gate reads): the form opens, and stays, only while it is 'open' and no closed
 * refusal is remembered for that client (closedRefusals, the store the peek's and the chat's gates read). A send the
 * server refuses as closed (isClosedRefusal, e.g. 403 messaging.blocked) is remembered for the session, handed to the
 * lookup (`onRefused`) and takes the form and its Send away at once; the words stay with that client, as a refused
 * chat send keeps its draft. A plain network error keeps the form, its words and Send, with the error shown.
 * FIX-933R4 (LS-933R4 B1, owner 199-D11 op 1): a form the pair closes under (a send refused as closed, or a block
 * either way landing while it is up) says why at once: the chat's closed line where its words and Send were, until
 * Cancel; the words stay. Over the peek (`overPeek`) the form goes and the peek's own line says it, so iOS never has
 * to present one modal while another fades out. The refusal goes through the chat gate's close(err), so the line is
 * also announced (LS-933R4 N2). A send's answer only acts on the form it was sent from, and a second Send while one
 * is in flight sends nothing.
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { closedRefusals } from '../../../components/messaging/closedRefusal';
import {
  BLOCKED_BY_ME_LINE,
  ConversationClosedLine,
  useClosedBy,
  useConversationClosed,
} from '../../../components/messaging/ConversationClosed';
import { coachApi } from '../../../services/api';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { errorMessage } from '../../../types/common';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { rosterDisplayName, type RosterClient } from '../../../utils/coach/clientRoster';
import { NudgeModal } from '../client-detail/NudgeModal';
import { makeStyles } from '../client-detail/styles';
import type { PeekPair } from './ClientPeekSheet';

export function useLookupNudge(
  colors: ThemeColors,
  pairOf: (c: RosterClient) => PeekPair,
  onRefused: (id: string) => void,
  overPeek: boolean,
) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [client, setClient] = useState<RosterClient | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const draftFor = useRef<string | null>(null); // the draft belongs to one client: Cancel keeps it for that client only
  const shown = useRef<string | null>(null); // whose form is up now: a send's answer acts on that form only
  const inFlight = useRef(false); // one send at a time
  const remembered = useSyncExternalStore(closedRefusals.subscribe, () => closedRefusals.has(client?.id));
  const pair = client ? pairOf(client) : null;
  const live = client != null && pair === 'open' && !remembered;
  // The pair closed under the open form (a refusal remembered, or a block either way), not merely unread.
  const shut = client != null && !live && (remembered || pair === 'me' || pair === 'them');
  const saysWhy = shut && !overPeek;
  const gate = useConversationClosed(client?.id, [], true);
  const by = useClosedBy(client?.id, shut, { pair: true, mine: pair === 'me' });
  useEffect(() => {
    // the pair went unread under an open form, or closed under one over the peek (whose line says it): the form goes
    if (client && !live && !saysWhy) { shown.current = null; setClient(null); setError(''); }
  }, [client, live, saysWhy]);

  const close = () => { shown.current = null; setClient(null); setError(''); };
  const send = async () => {
    if (!client || !live || inFlight.current) return;
    setError('');
    if (!title.trim() || !body.trim()) {
      setError('Title and message are both required.');
      void HapticService.warning();
      return;
    }
    const to = client;
    inFlight.current = true;
    setSending(true);
    try {
      await coachApi.sendNudge(to.id, { title: title.trim(), body: body.trim() });
      void HapticService.success();
      if (draftFor.current === to.id) { setTitle(''); setBody(''); } // sent: these words are gone, another client's stay
      if (shown.current === to.id) close();
    } catch (err) {
      // Remembered (the peek's and the chat's gates read it), warned and announced; the form it was sent from says why.
      if (gate.close(err)) {
        onRefused(to.id);
        return;
      }
      void HapticService.error();
      if (shown.current === to.id) setError(errorMessage(err, 'Failed to send nudge.')); // on its own form, not another's
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const name = client ? rosterDisplayName(client) : '';
  const modal = (
    <NudgeModal
      visible={live || saysWhy}
      onClose={close}
      clientName={name}
      nudgeTitle={title}
      setNudgeTitle={setTitle}
      nudgeBody={body}
      setNudgeBody={setBody}
      nudgeError={error}
      nudgeSending={sending}
      onSend={send}
      colors={colors}
      styles={styles}
      closed={
        saysWhy ? (
          // The coach's own block reads as plain words here: its Settings link would open under this form.
          <ConversationClosedLine
            testID="lookup-nudge-closed"
            style={styles.nudgeClosedLine}
            line={by === 'me' ? BLOCKED_BY_ME_LINE : undefined}
            by={by}
            name={name}
          />
        ) : undefined
      }
    />
  );
  /** Opens the form only for a pair known open; false otherwise, so the caller can show why instead. */
  const open = (c: RosterClient): boolean => {
    if (pairOf(c) !== 'open' || closedRefusals.has(c.id)) return false;
    if (draftFor.current !== c.id) { draftFor.current = c.id; setTitle(''); setBody(''); }
    setError('');
    shown.current = c.id;
    setClient(c);
    return true;
  };
  return { open, modal };
}
