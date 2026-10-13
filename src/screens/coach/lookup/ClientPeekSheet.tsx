/**
 * UI-4 peek sheet (client-peek-sheet mockup, owner 2026-10-09 "I like the peek sheet"). Opens from any
 * client row on the lookup. Every button opens today's real screen for it. Payments shows only while
 * the server flag coach_payment_actions is on. `children` (today's nudge form) render inside this
 * Modal so "Send nudge" opens over the sheet and returns to it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  | { screen: 'ClientDetail'; tab?: 'logs' | 'mealplan' | 'workouts' | 'timeline' }
  | { screen: 'ClientMessages' }
  | { screen: 'ClientPayments' };

type Props = {
  client: RosterClient | null;
  coachId?: string;
  onClose: () => void;
  onOpen: (c: RosterClient, target: PeekTarget) => void;
  onNudge: (c: RosterClient) => void;
  children?: React.ReactNode;
};

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; summary: unknown; checkIns: unknown };
const LOAD_FAILED = 'Could not load this client. Please try again.';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export default function ClientPeekSheet({ client, coachId, onClose, onOpen, onNudge, children }: Props) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { colors } = theme;
  const insets = useScreenInsets();
  const payments = useFeatureFlags().flags.coach_payment_actions === true;
  const target = useCurrentMacrosForClient(client?.id);
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const fetchPeek = useCallback(async (id: string) => {
    setLoad({ state: 'loading' });
    try {
      const [summary, checkIns] = await Promise.all([coachApi.getClientSummary(id), coachApi.getClientCheckIns(id, { limit: 1 })]);
      if (obj(summary?.data).error) throw new Error('not found');
      setLoad({ state: 'ready', summary: summary?.data, checkIns: checkIns?.data });
    } catch {
      setLoad({ state: 'error' });
    }
  }, []);
  useEffect(() => {
    if (client) void fetchPeek(client.id);
  }, [client, fetchPeek]);

  if (!client) return null;
  const first = firstName(client);
  const status = peekStatusLine(client);
  const slices: PeekSlices | null = load.state === 'ready'
    ? peekSlices(client, load.summary, load.checkIns, coachId, target.isSuccess ? target.data : null)
    : null;
  const open = (t: PeekTarget) => onOpen(client, t);
  const chips: Array<[string, PeekTarget]> = [
    ['Food log', { screen: 'ClientDetail', tab: 'logs' }],
    ['Meal plan', { screen: 'ClientDetail', tab: 'mealplan' }],
    ['Workouts', { screen: 'ClientDetail', tab: 'workouts' }],
    ...(payments ? [['Payments', { screen: 'ClientPayments' }] as [string, PeekTarget]] : []),
    ['Full profile', { screen: 'ClientDetail' }],
  ];

  const slice = (key: string, icon: keyof typeof Ionicons.glyphMap, title: string, v: { text: string; shared: boolean }, action?: React.ReactNode) => (
    <View style={s.slice} accessible={!action} accessibilityLabel={`${title}, ${v.text}`} testID={`peek-slice-${key}`}>
      <Ionicons name={v.shared ? icon : 'lock-closed-outline'} size={20} color={v.shared ? colors.primary : colors.textMuted} />
      <View style={s.mid}>
        <Overline style={s.sliceTitle}>{title}</Overline>
        <Text style={[s.sliceText, !v.shared && s.muted]} numberOfLines={2}>{v.text}</Text>
      </View>
      {action}
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} testID="peek-sheet">
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" testID="peek-scrim" />
        <View style={[s.sheet, { paddingBottom: 24 + insets.bottom }]} accessibilityViewIsModal>
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
            {load.state === 'loading' ? <QuietLoading label={`Loading ${first}`} rows={4} testID="peek-loading" /> : null}
            {load.state === 'error' ? <QuietError message={LOAD_FAILED} onRetry={() => void fetchPeek(client.id)} /> : null}
            {slices ? (
              <View>
                {slice('checkins', 'clipboard-outline', 'Check-ins', slices.checkIn, slices.checkIn.hasOne ? (
                  <HapticPressable intent="light" style={s.review} onPress={() => open({ screen: 'ClientDetail', tab: 'timeline' })} accessibilityRole="button" accessibilityLabel={`Review ${first}'s check-ins`} testID="peek-review">
                    <Text style={s.link}>Review</Text>
                  </HapticPressable>
                ) : undefined)}
                {slice('food', 'restaurant-outline', 'Food', slices.food)}
                {slice('workouts', 'barbell-outline', 'Workouts', slices.workouts)}
                {slice('weighins', 'scale-outline', 'Weigh-ins', slices.weighIn)}
              </View>
            ) : null}
            <View style={s.buttons}>
              <View style={s.flex}>
                <HapticPressable intent="medium" style={s.primary} onPress={() => open({ screen: 'ClientMessages' })} accessibilityRole="button" accessibilityLabel={`Message ${first}`} testID="peek-message">
                  <Text style={s.primaryText} numberOfLines={1}>{`Message ${first}`}</Text>
                </HapticPressable>
              </View>
              <View style={s.flex}>
                <HapticPressable intent="light" style={s.outline} onPress={() => onNudge(client)} accessibilityRole="button" accessibilityLabel={`Send ${first} a nudge`} testID="peek-nudge">
                  <Text style={s.outlineText} numberOfLines={1}>Send nudge</Text>
                </HapticPressable>
              </View>
            </View>
            <View style={s.chips}>
              {chips.map(([label, t]) => (
                <HapticPressable key={label} intent="light" style={s.chip} onPress={() => open(t)} accessibilityRole="button" accessibilityLabel={`${label}, ${first}`} testID={`peek-chip-${label}`}>
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
    slice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sem.border },
    sliceTitle: { color: colors.textMuted },
    sliceText: { ...typography.bodySmall, fontSize: 15, lineHeight: 21, color: colors.textPrimary },
    review: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
    link: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: colors.primary },
    buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
    flex: { flex: 1 },
    primary: { minHeight: 48, borderRadius: radius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    primaryText: { ...typography.bodyMd, fontSize: 15, color: sem.textOnAccent },
    outline: { minHeight: 48, borderRadius: radius.button, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    outlineText: { ...typography.bodyMd, fontSize: 15, color: colors.primary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    chip: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.chip, borderWidth: 1, borderColor: sem.border, backgroundColor: sem.bgSurface },
    chipText: { ...typography.bodySmall, fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textPrimary },
  });
