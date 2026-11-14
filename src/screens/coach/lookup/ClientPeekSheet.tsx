/**
 * UI-4 peek sheet (client-peek-sheet mockup, owner 2026-10-09 "I like the peek sheet"), drawn as K1 Style C
 * (C_peek, owner #196-E8): the mini masthead, four one-line rows (label left, value right), Message and Send
 * nudge side by side, then the chips. Opens from any client row on the lookup. Every button opens today's real
 * screen for it. Payments shows only while the server flag coach_payment_actions is on. `children` (today's
 * nudge form) render inside this Modal so "Send nudge" opens over the sheet and returns to it. The drawn Meal plan
 * chip is kept as drawn but opens nothing for v1 (owner #197-E6: "keep the chip, it doesn't open anywhere more for
 * v1"; MEALPLAN-M removed the file's Plan tab): it is display only, not a button, and is read as plain text.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import {
  BLOCKED_BY_ME_LINE, CLOSED_LINE, ConversationClosedLine, blockedYouLine, useClosedBy, useConversationClosed,
} from '../../../components/messaging/ConversationClosed';
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

/** The lookup's settled answer for this pair: 'me' (the coach blocked them), 'them' (closed_client_ids: a block the
 * other way), 'open', or null while it is unread. Only 'open' offers Send nudge. */
export type PeekPair = 'open' | 'me' | 'them' | null;

type Props = {
  client: RosterClient | null;
  onClose: () => void;
  onOpen: (c: RosterClient, target: PeekTarget) => void;
  onNudge: (c: RosterClient) => void;
  pair?: PeekPair;
  children?: React.ReactNode;
};

/** Each answer carries the client it was read for, so it is drawn only under that client's name. */
type Load = { id: string; state: 'loading' | 'error' } | { id: string; state: 'ready'; summary: unknown; checkIns: unknown; week: WorkoutWeek };
const LOAD_FAILED = 'Could not load this client. Please try again.';
const RING = 60; // C_peek draws the ring about 60 pt across at 390 and 360 (the file's own ring is 104)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export default function ClientPeekSheet({ client, onClose, onOpen, onNudge, pair = null, children }: Props) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useScreenInsets();
  const payments = useFeatureFlags().flags.coach_payment_actions === true;
  const target = useCurrentMacrosForClient(client?.id);
  const [load, setLoad] = useState<Load | null>(null);
  // LS-933R2 B1: Send nudge is messaging, so it takes the chat's own gate and line (ClientMessagesScreen.tsx:90-97 and
  // :489; BLOCK-ALL-M, FX-872, owner b#1141): offered only once the server has answered that this pair is open, and a
  // block either way (or a send refused closed this session) draws the chat's closed line in its place. Message
  // stays: the chat it opens shows the same line (owner O03).
  const gate = useConversationClosed(client?.id, [], pair != null, pair === 'me' || pair === 'them');
  const by = useClosedBy(client?.id, gate.closed, { pair: true, mine: pair === 'me' });
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
  // The chat's line for this side (BAM-2a, BAM-2b, else BAM-1), passed as its words so it is plain text here: its
  // Settings link would open Blocked people under this sheet, which stays up over the screens behind it.
  const name = rosterDisplayName(client).trim();
  const closedLine = by === 'me' ? BLOCKED_BY_ME_LINE : by === 'them' && name ? blockedYouLine(name) : CLOSED_LINE;
  const slices: PeekSlices | null = own?.state === 'ready'
    ? peekSlices(client, own.summary, own.checkIns, own.week, target.isSuccess ? target.data : null)
    : null;
  const open = (t: PeekTarget) => onOpen(client, t);
  const sc = theme.semanticColors;
  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  const ring = slices?.workouts.week ?? null;
  const lastDone = ring ? ring.segments.lastIndexOf('done') : -1;
  // C_peek's order. Meal plan has no target: display only (owner #197-E6).
  const chips: Array<[string, PeekTarget | null]> = [
    ['Food log', { screen: 'ClientDetail', tab: 'logs' }],
    ['Meal plan', null],
    ['Workouts', { screen: 'ClientDetail', tab: 'workouts' }],
    ...(payments ? [['Payments', { screen: 'ClientPayments' }] as [string, PeekTarget]] : []),
    ['Full profile', { screen: 'ClientDetail' }],
  ];

  // C_peek: one line per row, the label left and the value right (no icon). Every drawn size fits one line. The app's
  // own words are never cut: on a narrow phone or at large text they wrap, as many lines as they need (LS-933 B1,
  // LO-933 B1). Only the client's own note is cut, to one line under them. The value is one accessible element whose
  // label is every word, the whole note included, so a screen reader reads it once, in full, with Review after it
  // (LS-933 B2; the row itself is the accessible element only when it has no Review, and then the value is not one
  // too, so TalkBack stops once per row, not twice; LO-933R2 C1).
  const slice = (key: string, title: string, v: { text: string; note?: string | null }, action?: React.ReactNode, last = false) => {
    const spoken = v.note ? `${v.text}, ${v.note}` : v.text;
    return (
      <View style={[s.slice, last && s.lastSlice]} accessible={!action} accessibilityLabel={`${title}, ${spoken}`} testID={`peek-slice-${key}`}>
        <Text style={s.sliceTitle} numberOfLines={1}>{title}</Text>
        <View style={s.value} accessible={!!action} accessibilityLabel={spoken} testID={`peek-spoken-${key}`}>
          <Text style={s.sliceText} accessibilityLabel={v.note ? spoken : undefined} testID={`peek-value-${key}`}>{v.text}</Text>
          {v.note ? <Text style={s.sliceText} numberOfLines={1} testID={`peek-note-${key}`}>{v.note}</Text> : null}
        </View>
        {action}
      </View>
    );
  };

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
                ) : undefined)}
                {slice('food', 'Food', slices.food)}
                {slice('workouts', 'Workouts', slices.workouts)}
                {slice('weighins', 'Weigh-ins', slices.weighIn, undefined, true)}
              </View>
            ) : null}
            {/* C_peek: Message {first} and Send nudge share one row, each as wide as its words with the spare width shared
                (LO-933 B2: "Message Jordan" stays one line at 390 pt and 130%). When the two do not fit, Message gives way
                first, as C_peek android360 130% draws: Send nudge keeps its words' width, never more than half the row,
                and either wraps inside its own button, never below the other. */}
            <View style={s.buttons} testID="peek-buttons">
              <View style={s.slotMessage} testID="peek-slot">
                <HapticPressable intent="medium" containerStyle={s.flex} style={s.primary} onPress={() => open({ screen: 'chat' })} accessibilityRole="button" accessibilityLabel={`Message ${first}`} testID="peek-message">
                  <Text style={s.primaryText}>{`Message ${first}`}</Text>
                </HapticPressable>
              </View>
              {gate.open ? (
                <View style={s.slotNudge} testID="peek-slot">
                  <HapticPressable intent="light" containerStyle={s.flex} style={s.outline} onPress={() => onNudge(client)} accessibilityRole="button" accessibilityLabel="Send nudge" testID="peek-nudge">
                    <Text style={s.outlineText}>Send nudge</Text>
                  </HapticPressable>
                </View>
              ) : null}
            </View>
            {gate.closed ? <ConversationClosedLine line={closedLine} style={s.closedLine} testID="peek-closed" /> : null}
            <View style={s.chips}>
              {chips.map(([label, t]) => (t ? (
                <HapticPressable key={label} intent="light" style={s.chip} onPress={() => open(t)} accessibilityRole="button" accessibilityLabel={label} testID={`peek-chip-${label}`}>
                  <Text style={s.chipText}>{label}</Text>
                </HapticPressable>
              ) : (
                <View key={label} style={s.chip} accessible accessibilityRole="text" accessibilityLabel={label} testID={`peek-chip-${label}`}>
                  <Text style={s.chipText}>{label}</Text>
                </View>
              )))}
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
    // C_peek rows: a sage hairline (the drawing's #C9D8CD, surface.sageLine; LO-933 C2) above the first and between
    // rows, none under the last; label left in ink, Medium (LO-933 B3), value right in muted ink Regular, at 44 pt
    // (Review is a 44 pt target inside the Check-ins row).
    slices: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: sem.surface.sageLine },
    slice: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: layout.touchMin, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sem.surface.sageLine },
    lastSlice: { borderBottomWidth: 0 },
    sliceTitle: { ...typography.bodyMd, fontSize: 15, lineHeight: 21, flexShrink: 0, color: colors.textPrimary },
    value: { flex: 1, minWidth: 0 },
    sliceText: { ...typography.body, fontSize: 15, lineHeight: 21, textAlign: 'right', color: colors.textMuted },
    review: { minHeight: layout.touchMin, minWidth: layout.touchMin, justifyContent: 'center', alignItems: 'flex-end' },
    link: { ...typography.bodyMd, fontSize: 15, lineHeight: 21, color: colors.primary, textDecorationLine: 'underline' },
    // Two buttons 8 pt apart, each sized to its words plus an equal share of the spare width (C_peek), as tall as the
    // taller one (a wrapped name grows both together).
    buttons: { flexDirection: 'row', gap: 8, marginTop: 16 },
    slotMessage: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0 },
    slotNudge: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', maxWidth: '50%' },
    flex: { flex: 1 },
    closedLine: { marginTop: 8, borderRadius: radius.button },
    primary: { flex: 1, minHeight: layout.buttonHeight, borderRadius: radius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
    primaryText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20, textAlign: 'center', color: sem.textOnAccent },
    outline: { flex: 1, minHeight: layout.buttonHeight, borderRadius: radius.button, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
    outlineText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20, textAlign: 'center', color: colors.primary },
    // C_peek chips: each pill is itself the 44 pt target, 8 pt apart both ways.
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    chip: { minHeight: layout.touchMin, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.chip, borderWidth: 1, borderColor: sem.surface.sageLine, backgroundColor: colors.background },
    chipText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', lineHeight: 20, color: colors.primary },
  });
