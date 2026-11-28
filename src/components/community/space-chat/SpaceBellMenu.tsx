/**
 * LEAVE-MUTE-M (agent 203; owner D2a; LEAVE-MUTE-MOCK Style 1 "Bell beside info", frames s1_L1 to s1_L3b): the bell in
 * the space chat's bar, left of the info button, and its one menu, a white card dropped under the bar holding the
 * owner's 10-25 menu word for word: All messages, Mute low priority, Mute all (the server's chosen mode checked), Mute
 * for 1 hour, 8 hours or 1 day, and Leave space last, in red, only where the server allows it. While Mute all runs (a
 * timer or the level: effective_mode mute_all) the bell is slashed and Unmute heads the card (R4, R5); the default Mute
 * low priority keeps the plain bell. The bell says it is working and takes no tap while an action runs (R3).
 * The card is anchored at the bell's own place in the window (measureInWindow) and reads no inset, so the Modal it lives
 * in needs no screen-area row (screenAreaCensus.test.ts). Leave runs once the card has gone (iOS: the Modal's onDismiss,
 * with a short fallback), so the system confirm never meets a closing card.
 */
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, forestPop as fp, neutral, radius, spacing, voiceShades, withAlpha } from '../../../theme/tokens';
import type { BellAction } from './useSpaceLeaveMute';
import type { SpaceNotify } from './spaceLeaveMuteApi';

export const BELL_LABEL = 'Notifications for this space';
export const BELL_MUTED_LABEL = 'Notifications for this space, muted';
const LEVELS = [['all', 'All messages'], ['mute_low', 'Mute low priority'], ['mute_all', 'Mute all']] as const;
const TIMERS = [[1, 'Mute for 1 hour'], [8, 'Mute for 8 hours'], [24, 'Mute for 1 day']] as const;
const FALLBACK_TOP = 103;

export function SpaceBell({ notify, busy, canLeave, onAction, onLeave }: {
  notify: SpaceNotify | null;
  busy: boolean;
  canLeave: boolean;
  onAction: (a: BellAction) => void;
  onLeave: () => void;
}): React.ReactElement {
  const bell = useRef<View>(null);
  const [at, setAt] = useState<{ top: number } | null>(null);
  const after = useRef<(() => void) | null>(null);
  const { width } = useWindowDimensions();
  const muted = notify?.effective_mode === 'mute_all';
  const open = () => {
    if (busy) return;
    // The bar's bottom is 10 pt under the bell (its paddingBottom); the card drops 6 pt below it. A measure that never
    // answers (no native view) opens it under a typical bar.
    let placed = false;
    const fallback = setTimeout(() => { if (!placed) { placed = true; setAt({ top: FALLBACK_TOP }); } }, 120);
    bell.current?.measureInWindow?.((_x, y, _w, h) => {
      if (placed) return;
      placed = true;
      clearTimeout(fallback);
      setAt({ top: (Number.isFinite(y) ? y : 0) + (Number.isFinite(h) && h > 0 ? h : 44) + 10 });
    });
  };
  const done = () => {
    const next = after.current;
    after.current = null;
    next?.();
  };
  const close = (next?: () => void, waitForDismiss = false) => {
    setAt(null);
    if (!next) return;
    if (!waitForDismiss || Platform.OS !== 'ios') { next(); return; }
    after.current = next;
    setTimeout(done, 350);
  };
  const item = (label: string, run: () => void, id: string, opts: { checked?: boolean; lead?: React.ReactNode; red?: boolean; wait?: boolean } = {}) => (
    <TouchableOpacity
      key={id} onPress={() => close(run, opts.wait)} accessibilityRole="menuitem" accessibilityLabel={label}
      accessibilityState={opts.checked === undefined ? undefined : { checked: opts.checked }} style={s.item} testID={`space-bell-${id}`}
    >
      <View style={s.lead}>{opts.lead ?? null}</View>
      <Text style={[s.label, opts.checked && s.chosen, opts.red && s.red]}>{label}</Text>
      <View style={s.lead}>{opts.checked ? <Ionicons name="checkmark" size={22} color={fp.forest} /> : null}</View>
    </TouchableOpacity>
  );
  return (
    <View style={s.slot}>
      <TouchableOpacity
        ref={bell} onPress={open} disabled={busy} accessibilityRole="button" accessibilityLabel={muted ? BELL_MUTED_LABEL : BELL_LABEL}
        accessibilityState={{ busy, expanded: !!at, disabled: busy }} style={[s.bell, at && s.bellOpen]} testID="space-chat-bell"
      >
        {busy ? <ActivityIndicator color={fp.onDeep} />
          : <Ionicons name={muted ? 'notifications-off-outline' : 'notifications-outline'} size={24} color={fp.onDeep} />}
      </TouchableOpacity>
      <Modal transparent visible={!!at} animationType="fade" statusBarTranslucent onRequestClose={() => close()} onDismiss={done}>
        <Pressable style={[s.scrim, { top: at?.top ?? 0 }]} onPress={() => close()} accessibilityRole="button" accessibilityLabel="Close" testID="space-bell-scrim" />
        <View style={[s.card, { top: (at?.top ?? 0) + 6, width: Math.min(300, width - 16) }]} accessibilityViewIsModal onAccessibilityEscape={() => close()} testID="space-bell-menu">
          <Text style={s.eyebrow}>Notifications</Text>
          {muted ? (
            <>
              {item('Unmute', () => onAction({ kind: 'unmute' }), 'unmute', { lead: <Ionicons name="notifications-outline" size={20} color={fp.forest} /> })}
              <View style={s.hr} />
            </>
          ) : null}
          {LEVELS.map(([mode, label]) => item(label, () => onAction({ kind: 'mode', mode }), mode, { checked: !!notify && notify.mode === mode }))}
          <View style={s.hr} />
          {TIMERS.map(([hours, label]) => item(label, () => onAction({ kind: 'silence', hours }), `silence-${hours}`))}
          {canLeave ? (
            <>
              <View style={s.hr} />
              {item('Leave space', onLeave, 'leave', { red: true, wait: true, lead: <Ionicons name="exit-outline" size={20} color={colors.error} /> })}
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  slot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bell: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  bellOpen: { backgroundColor: fp.forest },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: withAlpha(colors.ink, 0.4) },
  // .card: white, radius 16, a hairline ring and a soft shadow, 6 pt inside top and bottom, 8 pt from the right edge.
  card: {
    position: 'absolute', right: spacing.sm, backgroundColor: neutral[0], borderRadius: radius.card, paddingVertical: 6,
    borderWidth: 1, borderColor: voiceShades.hairline, shadowColor: colors.ink, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 12, lineHeight: 16, letterSpacing: 1.4, textTransform: 'uppercase', color: fp.n700, paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  lead: { width: 22, alignItems: 'center' },
  label: { flex: 1, minWidth: 0, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 21, color: fp.ink },
  chosen: { fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  red: { color: colors.error },
  hr: { height: 1, backgroundColor: voiceShades.hairline, marginVertical: spacing.xs, marginHorizontal: spacing.lg },
});
