/**
 * The Home's "Plan ended last 7 days, {N}" row (RENEWAL3 P1, P1-0) and its list (K1, K2), Style A of m#688. The list
 * opens over the Home, so the Home tab stays as K1 draws it; Back and the chevron close it. A row opens in place to
 * "Ask Roman to write" (the Home's one draft sheet, ask-first: K3) and "Message" (the client's chat in Messages).
 * No message is sent from here, and none is sent on the coach's behalf (ruling v3 6328335815 items 5 and 6).
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, layout, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { QuietError, loadFailureMessage } from '../../../ui/states/QuietStates';
import HapticPressable from '../../../components/HapticPressable';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { openInboxChat } from '../../../navigation/coachInbox';
import type { DraftAsk } from './DraftSheets';
import { SEMI, useCardStyles } from './HomeParts';
import {
  groupPlanEnded, homeLabel, homeLine, initialsOf, messagedLine, planEndedAsk, planEndedTitle, rowLine,
  type PlanEndedPage, type PlanEndedRow,
} from './planEnded';

const SLIDE_MS = 240;

/** P1 (tappable, newest first, up to three monograms) or P1-0 (nobody: quiet, not tappable). */
export function PlanEndedHomeRow({ page, onOpen }: { page: PlanEndedPage; onOpen: () => void }) {
  const first = page.items[0];
  const label = homeLabel(page);
  if (!first || page.total === 0) {
    return (
      <View style={[hs.row, hs.rowQuiet]} accessible accessibilityLabel={label} testID="home-plan-ended-none">
        <Ionicons name="refresh" size={22} color={forestPop.onDeepMuted} />
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
      <Ionicons name="refresh" size={22} color={forestPop.leaf} />
      <View style={hs.grow}>
        <Text style={hs.title}>{planEndedTitle(page.total)}</Text>
        <View style={hs.lineRow}>
          <Text style={[hs.line, hs.grow]} numberOfLines={2}>{homeLine(first)}</Text>
          <View style={hs.monos} importantForAccessibility="no-hide-descendants">
            {page.items.slice(0, 3).map((r, i) => (
              <View key={r.client_id} style={[hs.mono, i > 0 && hs.monoOver]}>
                <Text style={hs.monoText} maxFontSizeMultiplier={1.2}>{initialsOf(r.name)}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={forestPop.onDeepMuted} />
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
}

/** K1 and K2: Today, Yesterday, Earlier this week, each with its count; one row open at a time. */
export function PlanEndedList({ page, loading, error, onReload, onClose, onAsk }: ListProps) {
  const { colors, semanticColors: sc } = useTheme();
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
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close.current(); return true; });
    return () => sub.remove();
  }, []);

  const groups = groupPlanEnded(page.items);
  const message = (r: PlanEndedRow) => { void HapticService.lightImpact(); openInboxChat(navigation, r.client_id, r.name); };
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
          <View style={[cs.card, ls.flush]}>
            {g.rows.map((r, i) => {
              const open = openId === r.client_id;
              const messaged = r.last_coach_message_at ? messagedLine(r.last_coach_message_at, page.time_zone) : null;
              return (
                <View key={r.client_id} style={[i > 0 && cs.rowLine, open && { backgroundColor: sc.bgPrimary }]}>
                  <Pressable
                    style={({ pressed }) => [cs.row, pressed && ls.pressed]}
                    onPress={() => { void HapticService.selection(); setOpenId(open ? null : r.client_id); }}
                    accessibilityRole="button" accessibilityState={{ expanded: open }}
                    accessibilityLabel={[r.name, rowLine(r), messaged].filter(Boolean).join('. ')} testID={`plan-ended-row-${r.client_id}`}
                  >
                    <View style={ls.mono}><Text style={ls.monoText} maxFontSizeMultiplier={1.2}>{initialsOf(r.name)}</Text></View>
                    <View style={cs.rowText}>
                      <Text style={cs.title}>{r.name}</Text>
                      <Text style={cs.muted}>{rowLine(r)}</Text>
                      {messaged ? (
                        <View style={ls.messaged}>
                          <Ionicons name="checkmark" size={16} color={colors.success} />
                          <Text style={[cs.muted, ls.messagedText, { color: colors.success }]}>{messaged}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Ionicons name={open ? 'close' : 'chevron-forward'} size={open ? 24 : 20} color={colors.textMuted} />
                  </Pressable>
                  {open ? (
                    <View style={ls.actions}>
                      <HapticPressable
                        intent="light" style={[ls.button, ls.ask]} onPress={() => onAsk(planEndedAsk(r))}
                        accessibilityRole="button" accessibilityLabel={`Ask Roman to write to ${r.name}`} testID="plan-ended-ask"
                      >
                        <RomanAvatar size={28} />
                        <Text style={[ls.buttonText, { color: forestPop.onDeep }]}>Ask Roman to write</Text>
                      </HapticPressable>
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
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: sc.bgPrimary, transform: [{ translateX: x }] }]} testID="plan-ended-list">
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
        contentContainerStyle={[ls.page, { paddingBottom: 32 + bottom }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onReload} tintColor={sc.accent} />}
      >
        {body}
      </ScrollView>
    </Animated.View>
  );
}

const hs = StyleSheet.create({
  row: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, paddingVertical: 12, paddingLeft: 14, paddingRight: 12,
    borderRadius: radius.button + 2, borderLeftWidth: 4, borderLeftColor: forestPop.leaf, backgroundColor: forestPop.forest,
  },
  rowQuiet: { borderLeftColor: forestPop.brand400 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontFamily: SEMI, fontSize: 18, lineHeight: 24, color: forestPop.onDeep },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  line: { ...typography.bodySmall, color: forestPop.onDeepMuted },
  monos: { flexDirection: 'row' },
  mono: { width: 34, height: 34, borderRadius: 17, backgroundColor: forestPop.leaf, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: forestPop.forest },
  monoOver: { marginLeft: -10 },
  monoText: { fontFamily: SEMI, fontSize: 13, lineHeight: 16, color: forestPop.deep },
  pressed: { opacity: 0.7 },
});

const ls = StyleSheet.create({
  head: { backgroundColor: forestPop.deep, paddingHorizontal: layout.gutter, paddingBottom: 18, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8 },
  order: { ...typography.caption, fontFamily: SEMI, letterSpacing: 1.6, color: forestPop.onDeepMuted },
  title: { ...typography.h1, color: forestPop.onDeep, marginTop: 4 },
  page: { paddingHorizontal: layout.gutter, paddingTop: 8, gap: 8 },
  empty: { paddingVertical: 24, textAlign: 'center' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 2 },
  sectionText: { marginTop: 0, marginBottom: 0, flexShrink: 1 },
  badge: { minWidth: 28, height: 24, borderRadius: radius.chip, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: forestPop.deep },
  badgeText: { fontFamily: SEMI, fontSize: 14, lineHeight: 18, color: forestPop.leaf },
  mono: { width: 48, height: 48, borderRadius: 24, backgroundColor: forestPop.deep, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontFamily: SEMI, fontSize: 17, lineHeight: 22, color: forestPop.leaf },
  messaged: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  messagedText: { fontFamily: SEMI },
  flush: { padding: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 18, paddingBottom: 16 },
  button: { minHeight: 52, flexGrow: 1, borderRadius: radius.button, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ask: { backgroundColor: forestPop.forest },
  message: { borderWidth: 1.5 },
  buttonText: { fontFamily: SEMI, fontSize: 17, lineHeight: 22 },
  pressed: { opacity: 0.7 },
});
