/**
 * CoachBriefLightScreen: today's brief as Concept A, "Roman in the light" (BRIEFA, behind coachBriefGate): Roman's face,
 * the date, his words, the actions from selectBriefActions, then "Thank you, Roman". Every state has a way out;
 * the brief is marked read once, when its words show. Reduce Motion and screen readers get everything at once.
 * ROMAN-EXTRAS-M (Style A, folded rows): on a brief that carries the check-in and new-client rows, a list row shows its
 * count and folds open in place (one at a time, 200 ms) to the newest three names and "See all {n}"; while one is
 * open the rows scroll in their own area so Roman's greeting stays on screen. An older brief keeps today's rows.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { coachBriefApi, CoachBriefApiError, type CoachBrief, type CoachBriefActionItem } from '../../../api/coachBriefApi';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { coachLandingTab } from '../../../navigation/coachLanding';
import { openTarget } from '../../../navigation/coachInbox';
import { brand, colors, motion, radius } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { logger } from '../../../utils/logger';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import BriefField from './BriefField';
import {
  actionTarget,
  briefFirstName,
  briefHasExtras,
  selectBriefActions,
  type BriefAction,
  type BriefKind,
  type BriefTarget,
} from './briefActions';

export const BRIEF_LIGHT_POLL_MS = 5_000;
export const BRIEF_LIGHT_POLL_TRIES = 12;

const BONE = '#FBF7F0';
const END = 1300;
/** The native driver ignores interpolate's `easing`, so the decel curve is sampled into the ranges (within 2%). */
const CURVE = [0, 0.04, 0.1, 0.18, 0.3, 0.5, 1].map((x) => [x, Easing.bezier(...motion.easing.decel)(x)] as const);
const OPENS = 'Opens the screen for this item';
const OPENS_LIST = 'Opens the full list';
const CLOSES = 'Closes today\u2019s brief.';
const SHOWS = 'Shows the newest three';
const DIM = 'rgba(251,247,240,0.7)';
const LEAF = '#C9DC9F';
const FOLD = LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);
const FADE = { duration: 200, create: FOLD.create, delete: FOLD.delete };

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; brief: CoachBrief }
  | { kind: 'preparing'; polling: boolean }
  | { kind: 'failed' }
  | { kind: 'error' }
  | { kind: 'throttled' };

type Nav = {
  navigate: (name: string, params?: object) => void;
  goBack: () => void;
  canGoBack: () => boolean;
  getParent: () => Parameters<typeof openTarget>[0] | undefined;
};

type Row = {
  key: string;
  label: string;
  hint?: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** A folding row: its clients (count = length) and whether it is the open one. */
  fold?: { kind: BriefKind; items: CoachBriefActionItem[]; open: boolean };
};

function splitGreeting(narrative: string): [string | null, string] {
  const m = /^\s*(Good morning\b[^.?]*[.?])\s*([\s\S]*)$/.exec(narrative);
  return m ? [m[1], m[2].trim()] : [null, narrative.trim()];
}

function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => live && setOn(v));
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v: boolean) => live && setOn(v));
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, []);
  return on;
}

export default function CoachBriefLightScreen() {
  const navigation = useNavigation<Nav>();
  const focused = useIsFocused();
  const user = useCurrentUser();
  const reduced = useReducedMotion();
  const reader = useScreenReader();
  const still = reduced || reader;
  const insets = useScreenInsets();
  const { width } = useWindowDimensions();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [revealed, setRevealed] = useState(false);
  const [fit, setFit] = useState({ view: 0, content: 0 });
  const [openKind, setOpenKind] = useState<BriefKind | null>(null);
  // While a fold is open the words keep Roman's greeting and the faded top of the next line; the rows scroll below.
  const [keep, setKeep] = useState(0);
  const rowsRef = useRef<ScrollView>(null);
  const rowsView = useRef(0);
  const mounted = useRef(true);
  const markedRead = useRef<string | null>(null);
  const waited = useRef(false);
  const greetingRef = useRef<Text>(null);
  const t = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settle = useCallback((brief: CoachBrief): boolean => {
    if (brief.status === 'generated' && brief.summary) {
      setState({ kind: 'ready', brief });
      if (markedRead.current !== brief.id) {
        markedRead.current = brief.id;
        coachBriefApi.markRead(brief.id).catch((err) => logger.warn('CoachBriefLightScreen', 'failed to mark brief read', err));
      }
      return true;
    }
    if (brief.status === 'failed') {
      setState({ kind: 'failed' });
      return true;
    }
    return false;
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      for (let i = 0; i < BRIEF_LIGHT_POLL_TRIES; i += 1) {
        const brief = await coachBriefApi.today();
        if (!mounted.current) return true;
        if (settle(brief)) return brief.status !== 'failed';
        setState({ kind: 'preparing', polling: true });
        await new Promise((r) => setTimeout(r, BRIEF_LIGHT_POLL_MS));
        if (!mounted.current) return true;
      }
      setState({ kind: 'preparing', polling: false });
      return true;
    } catch (err) {
      logger.warn('CoachBriefLightScreen', 'failed to load brief', err);
      if (mounted.current) setState({ kind: 'error' });
      return false;
    }
  }, [settle]);

  useEffect(() => {
    void load();
  }, [load]);

  const regenerate = useCallback(async (): Promise<boolean> => {
    try {
      const brief = await coachBriefApi.regenerate();
      if (!mounted.current) return true;
      return settle(brief) ? brief.status !== 'failed' : await load();
    } catch (err) {
      logger.warn('CoachBriefLightScreen', 'failed to prepare brief again', err);
      const throttled = err instanceof CoachBriefApiError && err.kind === 'throttled';
      if (mounted.current) setState({ kind: throttled ? 'throttled' : 'error' });
      return false;
    }
  }, [load, settle]);

  const retry = (run: () => Promise<boolean>) => async () => {
    void HapticService.softImpact();
    setState({ kind: 'loading' });
    if (!(await run()) && mounted.current) void HapticService.error();
  };

  // Reveal: 0-300 ms glow and Roman, 300-1000 ms the words, 1000-1300 ms the rows.
  const finish = useCallback(() => {
    t.stopAnimation();
    t.setValue(END);
    setRevealed(true);
  }, [t]);
  useEffect(() => {
    if (still) {
      finish();
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(t, { toValue: END, duration: END, easing: Easing.linear, useNativeDriver: true }).start(
      ({ finished }) => finished && setRevealed(true),
    );
  }, [still, finish, fade, t]);

  // A brief that arrives after the reveal cross-fades in place; after a wait it is announced once.
  const contentKey = state.kind === 'ready' ? state.brief.id : state.kind;
  const shownKey = useRef(contentKey);
  useEffect(() => {
    if (state.kind === 'preparing') waited.current = true;
    if (shownKey.current === contentKey) return;
    shownKey.current = contentKey;
    if (revealed) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: still ? 150 : 300, useNativeDriver: true }).start();
    }
    if (state.kind === 'ready' && waited.current) {
      waited.current = false;
      AccessibilityInfo.announceForAccessibility('Today\u2019s brief is ready.');
      const node = findNodeHandle(greetingRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [contentKey, state.kind, revealed, still, fade]);

  const close = useCallback(
    (target?: BriefTarget) => {
      if (navigation.canGoBack()) navigation.goBack();
      const tabs = navigation.getParent(); // Home is the tab the app opens on; a chat opens the inbox way (COACH-CHAT-BACK).
      if (tabs) openTarget(tabs, target ?? { tab: coachLandingTab() });
    },
    [navigation],
  );
  const leave = () => {
    void HapticService.softImpact();
    if (still) return close();
    Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => close());
  };
  const list = (kind: BriefKind, items: CoachBriefActionItem[]) => navigation.navigate('CoachBriefList', { kind, items });
  const open = (action: BriefAction) => {
    void HapticService.softImpact();
    if (action.opens === 'list') list(action.kind, action.items);
    else close(action.target);
  };
  const toggle = (kind: BriefKind) => {
    void HapticService.selection();
    LayoutAnimation.configureNext(still ? FADE : FOLD);
    setOpenKind((k) => (k === kind ? null : kind));
  };
  const tap = (run: () => void) => () => {
    void HapticService.softImpact();
    run();
  };

  const first = (user?.firstName ?? '').trim();
  let greeting = first ? `Good morning, ${first}.` : 'Good morning.';
  let words: string;
  let rows: Row[];
  const way = (label: string): Row => ({ key: 'out', label, hint: CLOSES, onPress: leave });
  const tryAgain: Row = { key: 'retry', label: 'Try again', onPress: retry(load) };
  let actions: BriefAction[] = [];
  switch (state.kind) {
    case 'ready': {
      const [said, rest] = splitGreeting(state.brief.summary?.narrative ?? '');
      greeting = said ?? greeting;
      words = rest;
      actions = selectBriefActions(state.brief.summary?.action_items, { extras: briefHasExtras(state.brief.summary) });
      rows = [
        ...actions.map((a): Row => {
          const base = { key: a.kind, label: a.label };
          if (a.opens !== 'list' || !a.fold) {
            return { ...base, hint: a.opens === 'list' ? OPENS_LIST : OPENS, onPress: () => open(a), icon: 'chevron-forward' };
          }
          const shut = openKind !== a.kind;
          const fold = { kind: a.kind, items: a.items, open: !shut };
          return { ...base, hint: shut ? SHOWS : undefined, onPress: () => toggle(a.kind), icon: shut ? 'chevron-down' : 'chevron-up', fold };
        }),
        way('Thank you, Roman'),
      ];
      break;
    }
    case 'failed':
      words = 'Today\u2019s brief could not be prepared. Tap Prepare again to build it from the latest activity.';
      rows = [{ key: 'prepare', label: 'Prepare again', onPress: retry(regenerate) }, way('Continue')];
      break;
    case 'error':
      words = 'Today\u2019s brief could not load. Check the connection, then try again.';
      rows = [tryAgain, way('Continue')];
      break;
    case 'throttled':
      words = 'Today\u2019s brief was prepared several times this hour. It can be prepared again within the hour.';
      rows = [tryAgain, way('Continue')];
      break;
    case 'preparing':
      words = 'Today\u2019s brief is still being prepared. It appears here in a moment.';
      rows = state.polling ? [way('Continue')] : [tryAgain, way('Continue')];
      break;
    default:
      words = '';
      rows = [way('Continue')];
  }
  const folded = rows.some((r) => r.fold?.open);
  const paras = [greeting, words, actions.length > 0 ? 'Where would you like to start?' : ''].filter(Boolean);
  const dots = state.kind === 'loading' || (state.kind === 'preparing' && state.polling);
  const rise = (start: number, dy: number, dur = 250) => {
    const range = { inputRange: CURVE.map(([x]) => start + x * dur), extrapolate: 'clamp' as const };
    return {
      opacity: t.interpolate({ ...range, outputRange: CURVE.map(([, y]) => y) }),
      transform: [{ translateY: t.interpolate({ ...range, outputRange: CURVE.map(([, y]) => dy * (1 - y)) }) }],
    };
  };
  const step = 700 / Math.max(paras.length, 1);
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const wide = width >= 390;
  const gutter = wide ? 30 : 26;

  return (
    <View
      style={styles.root}
      onTouchStart={revealed ? undefined : finish}
      onAccessibilityEscape={leave}
      testID="brief-light"
    >
      {focused ? <StatusBar barStyle="light-content" /> : null}
      <BriefField lit={t.interpolate({ inputRange: [0, 300], outputRange: [0, 1], extrapolate: 'clamp' })} still={still} />
      <Animated.View style={[styles.fill, { opacity: fade }]}>
        <ScrollView
          style={[styles.words, folded && keep ? { height: Math.min(keep, fit.content || keep), flexShrink: 0 } : null]}
          contentContainerStyle={{ paddingTop: insets.top + (wide ? 60 : 40), paddingBottom: 8, paddingHorizontal: gutter }}
          showsVerticalScrollIndicator={false}
          onLayout={(e) => setFit((f) => ({ ...f, view: e.nativeEvent.layout.height }))}
          onContentSizeChange={(_w, h) => setFit((f) => ({ ...f, content: h }))}
        >
          <Animated.View
            style={[styles.who, rise(0, 0, 300)]}
            accessible
            accessibilityLabel={`Roman, ${date}`}
            testID="brief-roman"
          >
            <View style={styles.halo}>
              <Svg width={112} height={112} style={styles.glow}>
                <Defs>
                  <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
                    <Stop offset={0.5} stopColor={colors.romanAccent} stopOpacity={0.16} />
                    <Stop offset={0.86} stopColor={colors.romanAccent} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={56} cy={56} r={56} fill="url(#halo)" />
              </Svg>
              <View style={styles.ring}>
                <RomanAvatar crop="neutral" size={50} />
              </View>
            </View>
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Text style={styles.name}>Roman</Text>
              <Text style={styles.date}>{date}</Text>
            </View>
          </Animated.View>
          {paras.map((p, i) => (
            <Animated.View
              key={`${i}-${p.slice(0, 12)}`}
              style={[{ marginTop: i === 0 ? 24 : 14 }, rise(300 + i * step, 4)]}
              onLayout={i === 0 ? (e) => setKeep(e.nativeEvent.layout.y + e.nativeEvent.layout.height + 40) : undefined}
            >
              <Text
                ref={i === 0 ? greetingRef : undefined}
                style={styles.words24}
                accessibilityRole={i === 0 ? 'header' : undefined}
                testID={`brief-para-${i}`}
              >
                {p}
              </Text>
            </Animated.View>
          ))}
          {dots ? (
            <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="brief-dots">
              {[0, 1, 2].map((d) => <View key={d} style={styles.dot} />)}
            </View>
          ) : null}
        </ScrollView>
        {fit.content > fit.view + 1 ? (
          <Svg height={32} width="100%" style={styles.more} pointerEvents="none" testID="brief-more">
            <Defs>
              <LinearGradient id="more" x1="0" y1="0" x2="0" y2="1">
                <Stop offset={0} stopColor={colors.forest} stopOpacity={0} />
                <Stop offset={1} stopColor={colors.forest} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height={32} fill="url(#more)" />
          </Svg>
        ) : null}
        <Animated.View
          style={[styles.rows, folded ? styles.rowsOpen : null, rise(1000, 8, 300)]}
          pointerEvents={revealed ? 'auto' : 'none'}
        >
          <ScrollView
            ref={rowsRef}
            style={styles.rowsScroll}
            onLayout={(e) => (rowsView.current = e.nativeEvent.layout.height)}
            contentContainerStyle={{ gap: 8, paddingBottom: Math.max(insets.bottom, 16) + 16, paddingHorizontal: gutter }}
            showsVerticalScrollIndicator={false}
          >
            {rows.map((row, i) => {
              const out = row.key === 'out';
              const n = row.fold?.items.length;
              const header = (
                <Pressable
                  key={row.key}
                  onPress={row.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={n === undefined ? row.label : `${row.label}, ${n}`}
                  accessibilityHint={row.hint}
                  accessibilityState={row.fold ? { expanded: row.fold.open } : undefined}
                  style={({ pressed }) => [styles.row, out && styles.out, row.fold?.open && styles.inFold, pressed && styles.pressed]}
                  testID={`brief-row-${row.key}`}
                >
                  {out ? null : (
                    <Text style={styles.badge} maxFontSizeMultiplier={1} accessibilityElementsHidden importantForAccessibility="no">
                      {i + 1}
                    </Text>
                  )}
                  <Text style={[styles.label, out && styles.center]}>{row.label}</Text>
                  {n === undefined ? null : (
                    <Text style={styles.pill} maxFontSizeMultiplier={1.3} accessibilityElementsHidden importantForAccessibility="no">
                      {n}
                    </Text>
                  )}
                  {row.icon ? <Ionicons name={row.icon} size={18} color={DIM} /> : null}
                </Pressable>
              );
              if (!row.fold?.open) return header;
              const { kind, items } = row.fold;
              return (
                <View
                  key={row.key}
                  style={styles.fold}
                  onLayout={({ nativeEvent: { layout: l } }) => {
                    // Bring the whole fold into view, its top first when it is taller than the rows area.
                    const y = Math.max(0, Math.min(l.y, l.y + l.height + 8 - rowsView.current));
                    rowsRef.current?.scrollTo({ y, animated: !still });
                  }}
                  testID={`brief-fold-${kind}`}
                >
                  {header}
                  {items.slice(0, 3).flatMap((item) => {
                    const target = actionTarget(item);
                    const name = briefFirstName(item.client_name) ? (item.client_name ?? '').trim() : null;
                    if (!target) return [];
                    const id = `${item.type}-${item.client_id}`;
                    const detail = name ? item.detail : undefined;
                    const go = tap(() => close(target));
                    return [<Sub key={id} label={name ?? item.detail} detail={detail} hint={OPENS} onPress={go} testID={`brief-fold-${id}`} />];
                  })}
                  <Sub
                    label={`See all ${items.length}`}
                    hint={OPENS_LIST}
                    onPress={tap(() => list(kind, items))}
                    all
                    testID={`brief-all-${kind}`}
                  />
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

type SubProps = { label: string; detail?: string; hint: string; onPress: () => void; all?: boolean; testID: string };

/** One line inside an open fold: a client (name, detail) or "See all {n}". */
function Sub({ label, detail, hint, onPress, all, testID }: SubProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.sub, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={styles.subText}>
        <Text style={[styles.subName, all && styles.all]}>{label}</Text>
        {detail ? <Text style={styles.subDetail} numberOfLines={1}>{detail}</Text> : null}
      </View>
      <Ionicons name={all ? 'arrow-forward' : 'chevron-forward'} size={18} color={all ? LEAF : DIM} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111612' },
  fill: { flex: 1 },
  words: { flexGrow: 0, flexShrink: 1 },
  more: { marginTop: -32 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  halo: { marginLeft: -4, borderRadius: radius.chip, borderWidth: 4, borderColor: 'rgba(201,169,97,0.14)' },
  glow: { position: 'absolute', left: -30, top: -30 },
  ring: { borderRadius: radius.chip, borderWidth: 1, borderColor: colors.romanAccent, overflow: 'hidden' },
  name: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 20, color: BONE },
  date: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: 'rgba(251,247,240,0.82)' },
  words24: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: 0.3,
    color: BONE,
    fontVariant: ['lining-nums'],
  },
  dots: { flexDirection: 'row', gap: 6, marginTop: 18 },
  dot: { width: 7, height: 7, borderRadius: radius.chip, backgroundColor: 'rgba(251,247,240,0.7)' },
  rows: { marginTop: 18 },
  rowsOpen: { flexShrink: 1 },
  rowsScroll: { flexGrow: 0, flexShrink: 1 },
  row: {
    minHeight: 54,
    borderRadius: radius.button,
    backgroundColor: 'rgba(16,30,21,0.86)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(251,247,240,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 14,
  },
  pressed: { backgroundColor: 'rgba(8,14,10,0.98)' },
  out: { backgroundColor: 'rgba(16,30,21,0.6)', borderColor: 'rgba(251,247,240,0.16)' },
  center: { textAlign: 'center' },
  inFold: { backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0 },
  fold: {
    borderRadius: radius.card,
    backgroundColor: 'rgba(16,30,21,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(201,169,97,0.38)',
    overflow: 'hidden',
  },
  sub: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingLeft: 48,
    paddingRight: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(251,247,240,0.08)',
  },
  subText: { flex: 1, minWidth: 0 },
  subName: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 20, color: BONE },
  subDetail: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: brand[100] },
  all: { fontFamily: 'Inter_600SemiBold', color: LEAF },
  pill: {
    minWidth: 32,
    paddingHorizontal: 9,
    borderRadius: radius.button,
    overflow: 'hidden',
    backgroundColor: 'rgba(163,196,106,0.16)',
    color: LEAF,
    textAlign: 'center',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: '#2A3D30',
    color: brand[100],
    textAlign: 'center',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 22,
  },
  label: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, letterSpacing: -0.1, color: BONE },
});
