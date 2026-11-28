/**
 * LEAVE-MUTE-M (agent 203; LEAVE-MUTE-MOCK Style 1 .toast, frames s1_L5, s1_L9, s1_L11): the dark toast, one line of
 * words and one underlined action (Undo, Try again), 12 pt from the sides, radius 12, ink with the warm near-white.
 * SpaceLeftToastHost is Home's: after a leave the chat hands it "You left {space}." (LM-12) and she lands there; Undo
 * joins again (POST .../join) and the toast goes once the server answers; a failure says so with Try again.
 * The pending toast lives only in memory and goes with a sign-out.
 */
import React, { useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { authEvents } from '../../../utils/authEvents';
import { colors, forestPop as fp, radius, spacing } from '../../../theme/tokens';
import { useJoinSpace } from './useSpaceLeaveMute';

const SHOWN_MS = 8000;

export function SpaceToast({ text, action, onAction, busy = false, stack = false, onTimeout, testID = 'space-toast' }: {
  text: string;
  action?: string;
  onAction?: () => void;
  busy?: boolean;
  /** A failure's toast (s1_L11): its words over its action (Try again), not beside it. */
  stack?: boolean;
  /** Called once it has been on screen long enough (not while its action runs). */
  onTimeout?: () => void;
  testID?: string;
}): React.ReactElement {
  useEffect(() => { AccessibilityInfo.announceForAccessibility?.(text); }, [text]);
  useEffect(() => {
    if (!onTimeout || busy) return undefined;
    const t = setTimeout(onTimeout, SHOWN_MS);
    return () => clearTimeout(t);
  }, [onTimeout, busy, text]);
  const button = action && onAction ? (
    <TouchableOpacity
      onPress={busy ? undefined : onAction} disabled={busy} accessibilityRole="button" accessibilityLabel={action}
      accessibilityState={{ busy, disabled: busy }} style={[s.action, stack && s.actionStacked]} testID={`${testID}-action`}
    >
      {busy ? <ActivityIndicator color={fp.onDeep} /> : <Text style={s.actionText}>{action}</Text>}
    </TouchableOpacity>
  ) : null;
  return (
    <View style={[s.toast, stack && s.toastStacked]} testID={testID} accessibilityLiveRegion="polite">
      {stack ? (
        <View style={s.stack} testID={`${testID}-stack`}>
          <Text style={[s.text, s.textStacked]}>{text}</Text>
          {button}
        </View>
      ) : (
        <>
          <Text style={s.text}>{text}</Text>
          {button}
        </>
      )}
    </View>
  );
}

// ─── Home's toast after a leave ──────────────────────────────────────────────────────────────────────────────────────
type LeftToast = { cohortId: string; name: string } | null;
let pending: LeftToast = null;
const listeners = new Set<() => void>();
const set = (next: LeftToast) => { pending = next; listeners.forEach((l) => l()); };
authEvents.on('logout', () => set(null));

/** The chat calls this once the server has answered a leave, before it goes to Home. */
export function showLeftToast(cohortId: string, name: string): void { set({ cohortId, name }); }

export function SpaceLeftToastHost(): React.ReactElement | null {
  const toast = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => pending, () => pending);
  const { join, busy, failed } = useJoinSpace((id) => { if (pending?.cohortId === id) set(null); });
  if (!toast) return null;
  const failure = failed[toast.cohortId];
  return (
    <View style={s.host} pointerEvents="box-none">
      <SpaceToast
        testID="space-left-toast"
        text={failure ?? `You left ${toast.name}.`}
        action={failure ? 'Try again' : 'Undo'}
        stack={!!failure}
        onAction={() => join(toast.cohortId)}
        busy={busy.has(toast.cohortId)}
        onTimeout={() => { if (pending === toast) set(null); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    paddingLeft: spacing.lg, paddingRight: spacing.xs, paddingVertical: 2, borderRadius: radius.button, backgroundColor: colors.ink,
  },
  text: { flex: 1, minWidth: 0, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: fp.onDeep, paddingVertical: spacing.sm },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  // s1_L11's failure toast: the words, then Try again under them at the words' left edge.
  toastStacked: { alignItems: 'flex-start' },
  stack: { flex: 1, minWidth: 0, paddingVertical: 6 },
  // In the column the words keep their own height (the row's flex: 1 would let them collapse there).
  textStacked: { flex: 0, alignSelf: 'stretch' },
  actionStacked: { alignSelf: 'flex-start', paddingHorizontal: spacing.xs },
  actionText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 14, lineHeight: 20, color: fp.onDeep, textDecorationLine: 'underline' },
  host: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
