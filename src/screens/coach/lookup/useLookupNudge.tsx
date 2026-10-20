/** UI-4: the bell and Nudge buttons open today's nudge form (client-detail NudgeModal) over the list. */
import React, { useMemo, useRef, useState } from 'react';
import { coachApi } from '../../../services/api';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { errorMessage } from '../../../types/common';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { rosterDisplayName, type RosterClient } from '../../../utils/coach/clientRoster';
import { NudgeModal } from '../client-detail/NudgeModal';
import { makeStyles } from '../client-detail/styles';

export function useLookupNudge(colors: ThemeColors) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [client, setClient] = useState<RosterClient | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const draftFor = useRef<string | null>(null); // the draft belongs to one client: Cancel keeps it for that client only

  const close = () => { setClient(null); setError(''); };
  const send = async () => {
    if (!client) return;
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
      void HapticService.error();
      setError(errorMessage(err, 'Failed to send nudge.'));
    } finally {
      setSending(false);
    }
  };

  const modal = (
    <NudgeModal
      visible={client != null}
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
  const open = (c: RosterClient) => {
    if (draftFor.current !== c.id) { draftFor.current = c.id; setTitle(''); setBody(''); }
    setError('');
    setClient(c);
  };
  return { open, modal };
}
