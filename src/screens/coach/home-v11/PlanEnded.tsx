/**
 * The Home's "Plan ended last 7 days, {N}" row (RENEWAL3 P1, P1-0) and its list (K1, K2), Style A of m#688. The list
 * opens over the Home, so the Home tab stays as K1 draws it; Back and the chevron close it. Android back is the list's only
 * while the Home is in front, and Message closes the list as it leaves for the chat (LO B1). A row opens in place to
 * "Ask Roman to write" (the Home's one draft sheet, ask-first: K3) and "Message" (the client's chat in Messages).
 * No message is sent from here, and none is sent on the coach's behalf (ruling v3 6328335815 items 5 and 6).
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, neutral, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { QuietError, loadFailureMessage } from '../../../ui/states/QuietStates';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { openInboxChat } from '../../../navigation/coachInbox';
import type { DraftAsk } from './DraftSheets';
import { SEMI, useCardStyles } from './HomeParts';
import { RomanMark } from './RomanMark';
import {
  groupPlanEnded, homeLabel, homeParts, initialsOf, messagedLine, planEndedAsk, planEndedTitle, rowLine, rowParts,
  type PlanEndedPage, type PlanEndedRow,
} from './planEndedData';

const SLIDE_MS = 240;
/** RENEWAL3 K1/K2's page gutter (r2a.py `.g`, `.lh`): 20 on iPhone, 16 on Android. */
const GUTTER = Platform.OS === 'android' ? 16 : 20;

import { KeepTail } from './KeepTail';
export { KeepTail }; // lives in KeepTail.tsx so K3's context chip can use it too (class-first)


/** P1 (tappable, newest first, up to three monograms) or P1-0 (nobody: quiet, not tappable). */
export function PlanEndedHomeRow({ page, onOpen }: { page: PlanEndedPage; onOpen: () => void }) {
  const first = page.items[0];
  const label = homeLabel(page);
  if (!first || page.total === 0) {
    return (
      <View style={[hs.row, hs.rowQuiet]} accessible accessibilityLabel={label} testID="home-plan-ended-none">
        <Ionicons name="refresh" size={24} color={forestPop.onDeepMuted} />
        <View style={hs.grow}>
          <Text style={hs.title}>{planEndedTitle(0)}</Text>
          <Text style={hs.line}>Clients whose plan ended show here, newest first.</Text>
        </View>
      </View>
    );
  }
  return (
    <Pressable
      style={({ pressed }) => [hs.row, pressed && hs.pressed]} onPress={() => { void HapticService.softImpact(); onOpen(); }}
      accessibilityRole="button" accessibilityLabel={label} testID="home-plan-ended"
    >
      <Ionicons name="refresh" size={24} color={forestPop.leaf} />
      <View style={hs.grow}>
        <Text style={hs.title}>{planEndedTitle(page.total)}</Text>
        <View style={hs.lineRow}>
          <KeepTail parts={homeParts(first)} style={hs.line} box={hs.grow} testID="home-plan-ended-line" />
          <View style={hs.monos} importantForAccessibility="no-hide-descendants">
            {page.items.slice(0, 3).map((r, i) => (
              <View key={r.client_id} style={[hs.mono, i > 0 && hs.monoOver, { zIndex: 3 - i }]}>
                <Text style={hs.monoText} maxFontSizeMultiplier={1.2}>{initialsOf(r.name)}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={forestPop.onDeepMuted} />
    </Pressable>
  );
}

interface ListProps {
  page: PlanEndedPage;
  /** A re-read in flight (on open, pull down, after Send): the rows stay while it runs. */
  loading: boolean;
  /** The last re-read failed: the rows shown are the last that loaded. */
  error: unknown;
  onReload: () => void;
  onClose: () => void;
  onAsk: (ask: DraftAsk) => void;
  /** The K3 sheet is up over the list: it holds the screen reader then, not the list. */
  covered?: boolean;
}

/** K1 and K2: Today, Yesterday, Earlier this week, each with its count; one row open at a time. */
export function PlanEndedList({ page, loading, error, onReload, onClose, onAsk, covered = false }: ListProps) {
  const { colors, semanticColors: sc, colorScheme } = useTheme();
  const cs = useCardStyles();
  const { top, bottom } = useScreenInsets();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [openId, setOpenId] = useState<string | null>(null);
  const x = useRef(new Animated.Value(width)).current;
  const still = useRef(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((rm) => {
      if (!live) return;
      still.current = rm;
      if (rm) x.setValue(0);
      else Animated.timing(x, { toValue: 0, duration: SLIDE_MS, useNativeDriver: true }).start();
    }).catch(() => x.setValue(0));
    return () => { live = false; };
  }, [x]);
  const close = useRef(onClose);
  close.current = () => {
    if (still.current) { onClose(); return; }
    Animated.timing(x, { toValue: width, duration: SLIDE_MS, useNativeDriver: true }).start(() => onClose());
  };
  useEffect(() => {
    // Off the Home (another tab, a pushed screen) back belongs to that screen: the app's pattern, ConsultationFlow.tsx.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation.isFocused?.() === false) return false;
      close.current();
      return true;
    });
    return () => sub.remove();
  }, [navigation]);

  const groups = groupPlanEnded(page.items);
  const message = (r: PlanEndedRow) => {
    void HapticService.softImpact();
    openInboxChat(navigation, r.client_id, r.name);
    onClose(); // the chat is in Messages; nothing stays open behind it
  };
  const body = (
    <>
      {error ? <QuietError layout="inline" message={loadFailureMessage(error, 'This list')} onRetry={onReload} testID="plan-ended-error" /> : null}
      {groups.length === 0 ? <Text style={[cs.muted, ls.empty]}>Clients whose plan ended show here, newest first.</Text> : null}
      {groups.map((g) => (
        <View key={g.key} testID={`plan-ended-${g.key}`}>
          <View style={ls.section}>
            <Text style={[cs.section, ls.sectionText]} accessibilityRole="header" accessibilityLabel={`${g.label}, ${g.rows.length}`}>{g.label.toUpperCase()}</Text>
            <View style={ls.badge} importantForAccessibility="no-hide-descendants"><Text style={ls.badgeText} maxFontSizeMultiplier={1.2}>{g.rows.length}</Text></View>
          </View>
          <View style={[cs.card, ls.flush, colorScheme === 'light' && ls.cardLight]}>
            {g.rows.map((r, i) => {
              const open = openId === r.client_id;
              const messaged = r.last_coach_message_at ? messagedLine(r.last_coach_message_at, page.time_zone) : null;
              return (
                <View key={r.client_id} style={[i > 0 && cs.rowLine, open && { backgroundColor: sc.bgPrimary }]}>
                  <Pressable
                    style={({ pressed }) => [cs.row, ls.row, pressed && ls.pressed]}
                    onPress={() => { void HapticService.selection(); setOpenId(open ? null : r.client_id); }}
                    accessibilityRole="button" accessibilityState={{ expanded: open }}
                    accessibilityLabel={[r.name, rowLine(r), messaged].filter(Boolean).join('. ')} testID={`plan-ended-row-${r.client_id}`}
                  >
                    <View style={ls.mono}><Text style={ls.monoText} maxFontSizeMultiplier={1.2}>{initialsOf(r.name)}</Text></View>
                    <View style={cs.rowText}>
                      <Text style={[ls.name, { color: colors.textPrimary }]}>{r.name}</Text>
                      <KeepTail parts={rowParts(r)} style={[ls.line, { color: colors.textMuted }]} testID={`plan-ended-line-${r.client_id}`} />
                      {messaged ? (
                        <View style={ls.messaged}>
                          <Ionicons name="checkmark" size={14} color={colors.success} />
                          <Text style={[ls.messagedText, { color: colors.success }]}>{messaged}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Ionicons name={open ? 'close' : 'chevron-forward'} size={open ? 18 : 20} color={colors.textMuted} />
                  </Pressable>
                  {open ? (
                    <View style={ls.actions}>
                      <Pressable
                        style={({ pressed }) => [ls.button, ls.ask, pressed && ls.pressed]} onPress={() => { void HapticService.softImpact(); onAsk(planEndedAsk(r)); }}
                        accessibilityRole="button" accessibilityLabel={`Ask Roman to write to ${r.name}`} testID="plan-ended-ask"
                      >
                        <RomanMark />
                        <Text style={[ls.buttonText, { color: forestPop.onDeep }]}>Ask Roman to write</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [ls.button, ls.message, { borderColor: colors.textPrimary }, pressed && ls.pressed]} onPress={() => message(r)}
                        accessibilityRole="button" accessibilityLabel={`Message ${r.name}`} testID="plan-ended-message"
                      >
                        <Text style={[ls.buttonText, { color: colors.textPrimary }]}>Message</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </>
  );

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: sc.bgPrimary, transform: [{ translateX: x }] }]} testID="plan-ended-list"
      accessibilityViewIsModal={!covered} // VoiceOver stays in the list; on Android the Home under it hides its content (LO C1)
    >
      <View style={[ls.head, { paddingTop: top + 4 }]}>
        <View style={ls.headRow}>
          <Pressable onPress={() => close.current()} hitSlop={8} style={ls.back} accessibilityRole="button" accessibilityLabel="Back" testID="plan-ended-back">
            <Ionicons name="chevron-back" size={28} color={forestPop.onDeep} />
          </Pressable>
          <Text style={ls.order} maxFontSizeMultiplier={1.3}>NEWEST FIRST</Text>
        </View>
        <Text style={ls.title} accessibilityRole="header">{planEndedTitle(page.total)}</Text>
      </View>
      <ScrollView
        testID="plan-ended-scroll" contentContainerStyle={[ls.page, { paddingBottom: 32 + bottom }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onReload} tintColor={sc.accent} />}
      >
        {body}
      </ScrollView>
    </Animated.View>
  );
}

const hs = StyleSheet.create({
  // RENEWAL3 P1 (r2b.py `.wbrow`, `.wbt`, `.wbs`): its own metrics, not the Home's shared rows (LS B1).
  row: {
    minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, paddingVertical: 8, paddingLeft: 12, paddingRight: 10,
    borderRadius: radius.button, borderLeftWidth: 4, borderLeftColor: forestPop.leaf, backgroundColor: forestPop.forest,
  },
  rowQuiet: { borderLeftColor: forestPop.brand400 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontFamily: SEMI, fontSize: 15, lineHeight: 20, color: forestPop.onDeep },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  line: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, color: forestPop.onDeepMuted },
  monos: { flexDirection: 'row' },
  mono: { width: 32, height: 32, borderRadius: 16, backgroundColor: forestPop.leaf, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: forestPop.forest },
  monoOver: { marginLeft: -6 },
  monoText: { fontFamily: SEMI, fontSize: 11, lineHeight: 14, color: forestPop.deep },
  pressed: { opacity: 0.7 },
});

// RENEWAL3 K1/K2 (r2a.py `.lh`, `.h1`, `.cnt`, `.pgcard`, `.lr`, `.av`, `.nm`, `.la`, `.msg`, `.acts`, `.btn`): the list's own
// metrics, not the Home's shared card rows (LS B1).
const ls = StyleSheet.create({
  head: { backgroundColor: forestPop.deep, paddingHorizontal: GUTTER, paddingBottom: 18, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8 },
  order: { ...typography.caption, fontFamily: SEMI, letterSpacing: 1.6, color: forestPop.onDeepMuted },
  title: { ...typography.h1, lineHeight: 38, color: forestPop.onDeep, marginTop: 4 },
  page: { paddingHorizontal: GUTTER, paddingTop: 8, gap: 8 },
  empty: { paddingVertical: 24, textAlign: 'center' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 2 },
  sectionText: { marginTop: 0, marginBottom: 0, flexShrink: 1 },
  badge: { minWidth: 24, borderRadius: radius.chip, paddingHorizontal: 9, paddingVertical: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: forestPop.deep },
  badgeText: { fontFamily: SEMI, fontSize: 12, lineHeight: 16, color: forestPop.leaf },
  row: { minHeight: 72, paddingVertical: 10, paddingHorizontal: 14 },
  mono: { width: 40, height: 40, borderRadius: 20, backgroundColor: forestPop.deep, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontFamily: SEMI, fontSize: 14, lineHeight: 18, color: forestPop.leaf },
  name: { fontFamily: SEMI, fontSize: 15.5, lineHeight: 20 },
  line: { ...typography.bodySmall, fontSize: 13, lineHeight: 18 },
  messaged: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  messagedText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, flexShrink: 1 },
  flush: { padding: 0, overflow: 'hidden', borderRadius: radius.card },
  cardLight: { backgroundColor: neutral[0] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14, paddingBottom: 14 },
  button: { minHeight: 48, flexGrow: 1, borderRadius: radius.button, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ask: { backgroundColor: forestPop.forest },
  message: { borderWidth: 1.5 },
  buttonText: { fontFamily: SEMI, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  pressed: { opacity: 0.7 },
});
