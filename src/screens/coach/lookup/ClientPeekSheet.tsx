/**
 * UI-4 peek sheet (client-peek-sheet mockup, owner 2026-10-09 "I like the peek sheet"). Opens from any
 * client row on the lookup. Every button opens today's real screen for it. Payments shows only while
 * the server flag coach_payment_actions is on. `children` (today's nudge form) render inside this
 * Modal so "Send nudge" opens over the sheet and returns to it. MEALPLAN-M removed the client file's
 * Plan tab, so the mockup's Meal plan chip is left out until the owner picks where it opens.
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
import { Overline, useScreenInsets } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { firstName, initialsOf } from '../../../utils/coach/clientLookup';
import { peekJoinedLine, peekSlices, peekStatusLine, type PeekSlices } from '../../../utils/coach/clientPeek';
import { rosterDisplayName, type RosterClient } from '../../../utils/coach/clientRoster';

export type PeekTarget =
  | { screen: 'ClientDetail'; tab?: 'logs' | 'workouts' | 'timeline' }
  | { screen: 'chat' }
  | { screen: 'ClientPayments' };

type Props = {
  client: RosterClient | null;
  coachId?: string;
  onClose: () => void;
  onOpen: (c: RosterClient, target: PeekTarget) => void;
  onNudge: (c: RosterClient) => void;
  children?: React.ReactNode;
};

/** Each answer carries the client it was read for, so it is drawn only under that client's name. */
type Load = { id: string; state: 'loading' | 'error' } | { id: string; state: 'ready'; summary: unknown; checkIns: unknown };
const LOAD_FAILED = 'Could not load this client. Please try again.';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export default function ClientPeekSheet({ client, coachId, onClose, onOpen, onNudge, children }: Props) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { colors } = theme;
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
      const [summary, checkIns] = await Promise.all([coachApi.getClientSummary(id), coachApi.getClientCheckIns(id, { limit: 1 })]);
      if (obj(summary?.data).error) throw new Error('not found');
      if (mine === seq.current) setLoad({ id, state: 'ready', summary: summary?.data, checkIns: checkIns?.data });
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
  const status = peekStatusLine(client);
  const slices: PeekSlices | null = own?.state === 'ready'
    ? peekSlices(client, own.summary, own.checkIns, coachId, target.isSuccess ? target.data : null)
    : null;
  const open = (t: PeekTarget) => onOpen(client, t);
  const chips: Array<[string, PeekTarget]> = [
    ['Food log', { screen: 'ClientDetail', tab: 'logs' }],
    ['Workouts', { screen: 'ClientDetail', tab: 'workouts' }],
    ...(payments ? [['Payments', { screen: 'ClientPayments' }] as [string, PeekTarget]] : []),
    ['Full profile', { screen: 'ClientDetail' }],
  ];

  const slice = (key: string, icon: keyof typeof Ionicons.glyphMap, title: string, v: { text: string }, action?: React.ReactNode) => (
    <View style={s.slice} accessible={!action} accessibilityLabel={`${title}, ${v.text}`} testID={`peek-slice-${key}`}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <View style={s.mid}>
        <Overline style={s.sliceTitle}>{title}</Overline>
        <Text style={s.sliceText} numberOfLines={2}>{v.text}</Text>
      </View>
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
            <View style={s.head}>
              <View style={s.avatar}><Text style={s.avatarText}>{initialsOf(client)}</Text></View>
              <View style={s.mid}>
                <Text style={s.name} accessibilityRole="header" numberOfLines={2}>{rosterDisplayName(client)}</Text>
                <Text style={[s.small, s.muted]}>{peekJoinedLine(client)}</Text>
              </View>
              <HapticPressable intent="light" style={s.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" testID="peek-close">
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </HapticPressable>
            </View>
            {status ? (
              <View style={s.status}>
                {status.ok ? <View style={s.dot} /> : null}
                <Text style={[s.small, s.statusText]}>{status.text}</Text>
              </View>
            ) : null}
            {!own || own.state === 'loading' ? <QuietLoading label="Loading clients" rows={4} testID="peek-loading" /> : null}
            {own?.state === 'error' ? <QuietError message={LOAD_FAILED} onRetry={() => void fetchPeek(client.id)} /> : null}
            {slices ? (
              <View style={s.slices}>
                {slice('checkins', 'clipboard-outline', 'Check-ins', slices.checkIn, slices.checkIn.hasOne ? (
                  <HapticPressable intent="light" style={s.review} onPress={() => open({ screen: 'ClientDetail', tab: 'timeline' })} accessibilityRole="button" accessibilityLabel="Review" testID="peek-review">
                    <Text style={s.link}>Review</Text>
                  </HapticPressable>
                ) : undefined)}
                {slice('food', 'restaurant-outline', 'Food', slices.food)}
                {slice('workouts', 'barbell-outline', 'Workouts', slices.workouts)}
                {slice('weighins', 'scale-outline', 'Weigh-ins', slices.weighIn)}
              </View>
            ) : null}
            <View style={s.buttons}>
              <View style={s.slot}>
                <HapticPressable intent="medium" style={s.primary} onPress={() => open({ screen: 'chat' })} accessibilityRole="button" accessibilityLabel={`Message ${first}`} testID="peek-message">
                  <Text style={s.primaryText} numberOfLines={2}>{`Message ${first}`}</Text>
                </HapticPressable>
              </View>
              <View style={s.slot}>
                <HapticPressable intent="light" style={s.outline} onPress={() => onNudge(client)} accessibilityRole="button" accessibilityLabel="Send nudge" testID="peek-nudge">
                  <Text style={s.outlineText} numberOfLines={2}>Send nudge</Text>
                </HapticPressable>
              </View>
            </View>
            <View style={s.chips}>
              {chips.map(([label, t]) => (
                <HapticPressable key={label} intent="light" style={s.chipTarget} onPress={() => open(t)} accessibilityRole="button" accessibilityLabel={label} testID={`peek-chip-${label}`}>
                  <View style={s.chip}><Text style={s.chipText}>{label}</Text></View>
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
    head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    mid: { flex: 1, minWidth: 0 },
    avatar: { width: 48, height: 48, borderRadius: radius.chip, borderWidth: 1, borderColor: palette.camel, backgroundColor: palette.cream, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 19, color: colors.textPrimary },
    name: { ...typography.h3, color: colors.textPrimary },
    small: { ...typography.bodySmall, color: colors.textPrimary },
    muted: { color: colors.textMuted },
    close: { width: 44, height: 44, borderRadius: radius.chip, borderWidth: StyleSheet.hairlineWidth, borderColor: sem.border, backgroundColor: sem.bgSurface, alignItems: 'center', justifyContent: 'center' },
    status: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10, marginBottom: 4 },
    statusText: { flexShrink: 1 },
    dot: { width: 7, height: 7, borderRadius: radius.chip, backgroundColor: colors.primary },
    slices: { marginTop: 4 },
    slice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sem.border },
    sliceTitle: { color: colors.textMuted },
    sliceText: { ...typography.bodySmall, fontSize: 15, lineHeight: 21, color: colors.textPrimary },
    review: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
    link: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: colors.primary },
    // Two equal buttons; when "Message {first}" needs more than half the row (large text, a long name), each takes a full row.
    buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
    slot: { flexGrow: 1, minWidth: '45%' },
    primary: { minHeight: 48, borderRadius: radius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    primaryText: { ...typography.bodyMd, fontSize: 15, lineHeight: 20, textAlign: 'center', color: sem.textOnAccent },
    outline: { minHeight: 48, borderRadius: radius.button, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    outlineText: { ...typography.bodyMd, fontSize: 15, lineHeight: 20, textAlign: 'center', color: colors.primary },
    // Each chip is a 44 pt target: the mockup's 36 pt pill and 4 pt above and below it. The targets meet with no row
    // gap, so the pills keep their 8 pt gap at any text size, 12 pt above, and (with the sheet's 20) 24 below.
    chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, marginTop: 8 },
    chipTarget: { minHeight: layout.touchMin, paddingVertical: 4, justifyContent: 'center' },
    chip: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.chip, borderWidth: 1, borderColor: sem.border, backgroundColor: sem.bgSurface },
    chipText: { ...typography.bodySmall, fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textPrimary },
  });
