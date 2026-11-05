/**
 * UI-4 peek sheet (client-peek-sheet mockup, owner 2026-10-09 "I like the peek sheet"), drawn as K1 Style C
 * (C_peek, owner #196-E8): the mini masthead, four one-line rows (label left, value right), Message and Send
 * nudge side by side, then the chips. Opens from any client row on the lookup. Every button opens today's real
 * screen for it. Payments shows only while the server flag coach_payment_actions is on. `children` (today's
 * nudge form) render inside this Modal so "Send nudge" opens over the sheet and returns to it. MEALPLAN-M
 * removed the client file's Plan tab, so the mockup's Meal plan chip is left out until the owner picks where
 * it opens (K1 rule 2 names a file section that no longer exists).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import { useFeatureFlags } from '../../../hooks/useFeatureFlags';
import { useCurrentMacrosForClient } from '../../../hooks/useMacros';
import { coachApi } from '../../../services/api';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors as palette, layout, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { firstName, initialsOf } from '../../../utils/coach/clientLookup';
import { peekJoinedLine, peekSlices, type PeekSlices } from '../../../utils/coach/clientPeek';
import { rosterDisplayName, type RosterClient } from '../../../utils/coach/clientRoster';
import { SegmentedRing } from '../../../ui/charts/StyleCMarks';
import { doneLine, workoutWeek, type ClientWeek, type WorkoutWeek } from '../client-detail/thisWeek';

export type PeekTarget =
  | { screen: 'ClientDetail'; tab?: 'logs' | 'workouts' | 'timeline' }
  | { screen: 'chat' }
  | { screen: 'ClientPayments' };

type Props = {
  client: RosterClient | null;
  onClose: () => void;
  onOpen: (c: RosterClient, target: PeekTarget) => void;
  onNudge: (c: RosterClient) => void;
  children?: React.ReactNode;
};

/** Each answer carries the client it was read for, so it is drawn only under that client's name. */
type Load = { id: string; state: 'loading' | 'error' } | { id: string; state: 'ready'; summary: unknown; checkIns: unknown; week: WorkoutWeek };
const LOAD_FAILED = 'Could not load this client. Please try again.';
const RING = 60; // C_peek draws the ring about 60 pt across at 390 and 360 (the file's own ring is 104)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export default function ClientPeekSheet({ client, onClose, onOpen, onNudge, children }: Props) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useScreenInsets();
  const payments = useFeatureFlags().flags.coach_payment_actions === true;
  const target = useCurrentMacrosForClient(client?.id);
  const [load, setLoad] = useState<Load | null>(null);
  // Only the newest read for the open client writes: closing or opening another client drops a late answer.
  const seq = useRef(0);

  const fetchPeek = useCallback(async (id: string) => {
    const mine = ++seq.current;
    setLoad({ id, state: 'loading' });
    try {
      // The week is the one the client file's ring reads (useThisWeek): the client's Monday to Sunday, in their zone.
      const [summary, checkIns, week] = await Promise.all([
        coachApi.getClientSummary(id), coachApi.getClientCheckIns(id, { limit: 1 }), coachApi.getClientWeek(id).then((r) => workoutWeek(r.data as ClientWeek)),
      ]);
      if (obj(summary?.data).error) throw new Error('not found');
      if (mine === seq.current) setLoad({ id, state: 'ready', summary: summary?.data, checkIns: checkIns?.data, week });
    } catch {
      if (mine === seq.current) setLoad({ id, state: 'error' });
    }
  }, []);
  const id = client?.id;
  useEffect(() => {
    if (!id) return undefined;
    void fetchPeek(id);
    return () => { seq.current += 1; };
  }, [id, fetchPeek]);

  if (!client) return null;
  const own = load?.id === client.id ? load : null;
  const first = firstName(client);
  const slices: PeekSlices | null = own?.state === 'ready'
    ? peekSlices(client, own.summary, own.checkIns, own.week, target.isSuccess ? target.data : null)
    : null;
  const open = (t: PeekTarget) => onOpen(client, t);
  const sc = theme.semanticColors;
  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  const ring = slices?.workouts.week ?? null;
  const lastDone = ring ? ring.segments.lastIndexOf('done') : -1;
  const chips: Array<[string, PeekTarget]> = [
    ['Food log', { screen: 'ClientDetail', tab: 'logs' }],
    ['Workouts', { screen: 'ClientDetail', tab: 'workouts' }],
    ...(payments ? [['Payments', { screen: 'ClientPayments' }] as [string, PeekTarget]] : []),
    ['Full profile', { screen: 'ClientDetail' }],
  ];

  // C_peek: one line per row, the label left and the value right (no icon). Every drawn size fits one line; on a
  // 320 pt phone at 130% a short value ("12 to review", "Nothing planned this week") wraps rather than lose words,
  // and only the free-text check-in (`lines` 1) is cut, its full words being the row's spoken label.
  const slice = (key: string, title: string, v: { text: string }, action?: React.ReactNode, last = false, lines = 2) => (
    <View style={[s.slice, last && s.lastSlice]} accessible={!action} accessibilityLabel={`${title}, ${v.text}`} testID={`peek-slice-${key}`}>
      <Text style={s.sliceTitle} numberOfLines={1}>{title}</Text>
      <Text style={s.sliceText} numberOfLines={lines} testID={`peek-value-${key}`}>{v.text}</Text>
      {action}
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} testID="peek-sheet">
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" testID="peek-scrim" />
        <View style={[s.sheet, { paddingBottom: 20 + insets.bottom }]} accessibilityViewIsModal>
          <View style={s.grab} />
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {/* K1 Style C (C_peek): a mini masthead with the file's week ring (SegmentedRing onDark, K1-S-38 inside and as
                its spoken label); the initials until the week is read, and when this week has no session. */}
            <View style={[s.head, { backgroundColor: sc.surface.masthead }]} testID="peek-masthead">
              {ring ? (
                <SegmentedRing
                  onDark size={RING} segments={ring.segments} label={doneLine(ring)} testID="peek-week-ring"
                  drawIndex={lastDone >= 0 ? lastDone : undefined} event={`${client.id}:${ring.week}`}
                >
                  <Text maxFontSizeMultiplier={1} numberOfLines={1} adjustsFontSizeToFit style={[s.ringCount, light]}>{`${ring.done} of ${ring.total}`}</Text>
                  <Text maxFontSizeMultiplier={1} style={[typography.eyebrow, s.ringDone, muted]}>done</Text>
                </SegmentedRing>
              ) : (
                <View style={s.avatar}><Text style={s.avatarText}>{initialsOf(client)}</Text></View>
              )}
              <View style={s.mid}>
                <Text style={[s.name, light]} accessibilityRole="header" numberOfLines={2}>{rosterDisplayName(client)}</Text>
                <Text style={[s.small, muted]}>{peekJoinedLine(client)}</Text>
              </View>
              <HapticPressable intent="light" style={s.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" testID="peek-close">
                <Ionicons name="close" size={24} color={sc.textOnAccent} />
              </HapticPressable>
            </View>
            {!own || own.state === 'loading' ? <QuietLoading label="Loading clients" rows={4} testID="peek-loading" /> : null}
            {own?.state === 'error' ? <QuietError message={LOAD_FAILED} onRetry={() => void fetchPeek(client.id)} /> : null}
            {slices ? (
              <View style={s.slices}>
                {slice('checkins', 'Check-ins', slices.checkIn, slices.checkIn.hasOne ? (
                  <HapticPressable intent="light" style={s.review} onPress={() => open({ screen: 'ClientDetail', tab: 'timeline' })} accessibilityRole="button" accessibilityLabel="Review" testID="peek-review">
                    <Text style={s.link}>Review</Text>
                  </HapticPressable>
                ) : undefined, false, slices.checkIn.note ? 1 : 2)}
                {slice('food', 'Food', slices.food)}
                {slice('workouts', 'Workouts', slices.workouts)}
                {slice('weighins', 'Weigh-ins', slices.weighIn, undefined, true)}
              </View>
            ) : null}
            {/* C_peek: Message {first} and Send nudge are one row of equal halves at every size and text size; a long
                name or 130% text wraps inside its half, never below the other button. */}
            <View style={s.buttons} testID="peek-buttons">
              <View style={s.flex} testID="peek-slot">
                <HapticPressable intent="medium" containerStyle={s.flex} style={s.primary} onPress={() => open({ screen: 'chat' })} accessibilityRole="button" accessibilityLabel={`Message ${first}`} testID="peek-message">
                  <Text style={s.primaryText}>{`Message ${first}`}</Text>
                </HapticPressable>
              </View>
              <View style={s.flex} testID="peek-slot">
                <HapticPressable intent="light" containerStyle={s.flex} style={s.outline} onPress={() => onNudge(client)} accessibilityRole="button" accessibilityLabel="Send nudge" testID="peek-nudge">
                  <Text style={s.outlineText}>Send nudge</Text>
                </HapticPressable>
              </View>
            </View>
            <View style={s.chips}>
              {chips.map(([label, t]) => (
                <HapticPressable key={label} intent="light" style={s.chip} onPress={() => open(t)} accessibilityRole="button" accessibilityLabel={label} testID={`peek-chip-${label}`}>
                  <Text style={s.chipText}>{label}</Text>
                </HapticPressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
      {children}
    </Modal>
  );
}


const makeStyles = ({ colors, semanticColors: sem }: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: sem.overlay },
    sheet: { maxHeight: '90%', paddingTop: 8, paddingHorizontal: layout.gutter, backgroundColor: colors.background, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
    grab: { width: 40, height: 5, borderRadius: radius.chip, backgroundColor: sem.border, alignSelf: 'center', marginBottom: 12 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingRight: 4, borderRadius: radius.card },
    mid: { flex: 1, minWidth: 0 },
    avatar: { width: 48, height: 48, borderRadius: radius.chip, borderWidth: 1, borderColor: palette.camel, backgroundColor: palette.cream, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 19, color: colors.textPrimary },
    name: { ...typography.h2 },
    small: { ...typography.bodySmall, color: colors.textPrimary },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    // The ring is a fixed 60 pt drawing, so its centre does not grow with text size; the Workouts row and the ring's
    // spoken label carry the same words at the coach's size.
    ringCount: { ...typography.h3, fontSize: 16, lineHeight: 19 },
    ringDone: { fontSize: 11, lineHeight: 13 },
    // C_peek rows: a hairline above the first and between rows, none under the last; label left in ink, value right
    // in muted ink, one line each at 44 pt (Review is a 44 pt target inside the Check-ins row).
    slices: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: sem.border },
    slice: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: layout.touchMin, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sem.border },
    lastSlice: { borderBottomWidth: 0 },
    sliceTitle: { ...typography.body, fontSize: 15, lineHeight: 21, flexShrink: 0, color: colors.textPrimary },
    sliceText: { ...typography.body, fontSize: 15, lineHeight: 21, flex: 1, minWidth: 0, textAlign: 'right', color: colors.textMuted },
    review: { minHeight: layout.touchMin, minWidth: layout.touchMin, justifyContent: 'center', alignItems: 'flex-end' },
    link: { ...typography.bodyMd, fontSize: 15, lineHeight: 21, color: colors.primary, textDecorationLine: 'underline' },
    // Two equal halves, 8 pt apart, as tall as the taller one (a wrapped name grows both together).
    buttons: { flexDirection: 'row', gap: 8, marginTop: 16 },
    flex: { flex: 1 },
    primary: { flex: 1, minHeight: layout.buttonHeight, borderRadius: radius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
    primaryText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20, textAlign: 'center', color: sem.textOnAccent },
    outline: { flex: 1, minHeight: layout.buttonHeight, borderRadius: radius.button, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
    outlineText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20, textAlign: 'center', color: colors.primary },
    // C_peek chips: each pill is itself the 44 pt target, 8 pt apart both ways.
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    chip: { minHeight: layout.touchMin, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.chip, borderWidth: 1, borderColor: sem.border, backgroundColor: colors.background },
    chipText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', lineHeight: 20, color: colors.primary },
  });
