/**
 * useThreadV2 — messaging v2 state and actions for one coach <-> client
 * thread (server flag `messaging_core_v2`): pins bar, mute, edit, delete for
 * everyone, pin / unpin. Shared by the client and coach thread screens.
 *
 * `enabled` = flag ON and no 503 `messaging.feature_disabled` seen yet (a
 * stale flag cache falls back to the legacy thread on the first refusal).
 * Every failure shows its own copy; nothing claims success before the server
 * confirms. `scope` must be referentially stable; `onChanged` refetches.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useFeatureFlags } from './useFeatureFlags';
import { messagingV2Api, toMessagingError, type MuteDuration, type ThreadMessage, type ThreadScope } from '../api/messagingV2Api';

export interface EditDraft {
  id: string;
  body: string;
}

export function useThreadV2(scope: ThreadScope | null, onChanged: () => void) {
  const { flags } = useFeatureFlags();
  const [refused, setRefused] = useState(false);
  const enabled = flags.messaging_core_v2 && !refused && scope !== null;
  const [pins, setPins] = useState<ThreadMessage[]>([]);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [busy, setBusy] = useState(false);

  /** A failed v2 call: 503 feature_disabled turns v2 off, else an alert. */
  const report = useCallback((title: string, err: unknown) => {
    const e = toMessagingError(err);
    if (e.isFeatureDisabled) setRefused(true);
    else Alert.alert(title, e.userMessage);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !scope) return;
    try {
      setPins((await messagingV2Api.listPins(scope)).items.filter((m) => !m.deleted));
    } catch (err) {
      // The pins bar is secondary: keep the last good list; only a 503 switches v2 off.
      if (toMessagingError(err).isFeatureDisabled) setRefused(true);
    }
    if (scope.role === 'client') {
      // The client has one thread: its inbox row carries the mute state. On
      // failure the state stays unknown and the menu offers every option.
      await messagingV2Api.getClientInbox().then((r) => setMuted(r.items[0]?.muted ?? false), () => undefined);
    }
  }, [enabled, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs one server action; on success refetches the thread and the pins. */
  const run = useCallback(
    async (title: string, fn: () => Promise<unknown>, after?: () => void) => {
      setBusy(true);
      try {
        await fn();
        after?.();
        onChanged();
        await refresh();
      } catch (err) {
        report(title, err);
      } finally {
        setBusy(false);
      }
    },
    [onChanged, refresh, report],
  );

  const saveEdit = useCallback(
    async (body: string) => {
      if (!editing || !scope) return;
      const text = body.trim();
      if (!text) {
        Alert.alert('Message not edited', 'An edited message needs some text. To remove the message, delete it instead.');
        return;
      }
      if (text === editing.body.trim()) return setEditing(null);
      await run('Message not edited', () => messagingV2Api.editMessage(scope, editing.id, text), () => setEditing(null));
    },
    [editing, scope, run],
  );

  const pin = useCallback(
    async (messageId: string, pinned: boolean) => {
      if (!scope) return;
      await run(pinned ? 'Message not pinned' : 'Message not unpinned', () =>
        pinned ? messagingV2Api.pinMessage(scope, messageId) : messagingV2Api.unpinMessage(scope, messageId),
      );
    },
    [scope, run],
  );

  const confirmDelete = useCallback(
    (messageId: string) => {
      if (!scope) return;
      Alert.alert('Delete for everyone?', 'The message is removed for both people in this conversation. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void run('Message not deleted', () => messagingV2Api.deleteMessage(scope, messageId)),
        },
      ]);
    },
    [scope, run],
  );

  const setMute = useCallback(
    async (duration: MuteDuration) => {
      if (!scope) return;
      setBusy(true);
      try {
        setMuted((await messagingV2Api.setMute(scope, duration)).muted);
      } catch (err) {
        report('Notifications not changed', err);
      } finally {
        setBusy(false);
      }
    },
    [scope, report],
  );

  return {
    enabled,
    pins: enabled ? pins : [],
    muted,
    editing,
    busy,
    refresh,
    startEdit: setEditing,
    cancelEdit: () => setEditing(null),
    saveEdit,
    pin,
    confirmDelete,
    setMute,
    report,
  };
}
