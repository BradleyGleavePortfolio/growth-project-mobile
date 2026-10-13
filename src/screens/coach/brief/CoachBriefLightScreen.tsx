/**
 * CoachBriefLightScreen: today's brief as Concept A, "Roman in the light"
 * (BRIEFA, behind coachBriefGate). Roman's face, the date, his words, at most
 * two suggested actions from selectBriefActions, then "Thank you, Roman".
 *
 * States: busy, quiet, still being prepared (checks every 5 s for 60 s, then
 * offers Try again), could not load, could not be prepared, prepared too
 * often. Every state has a way out. The brief is marked read once, when its
 * words show. Motion: the glow lights, the words and rows rise in over 1.3 s
 * and a tap anywhere completes it; Reduce Motion and screen readers get
 * everything at once with a 150 ms fade and a still glow.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
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
import { coachBriefApi, CoachBriefApiError, type CoachBrief } from '../../../api/coachBriefApi';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { __USING_MOCK_DATA } from '../../../services/commandCenterApi';
import { colors, motion, radius } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { logger } from '../../../utils/logger';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import BriefField from './BriefField';
import { selectBriefActions, type BriefAction, type BriefTarget } from './briefActions';

export const BRIEF_LIGHT_POLL_MS = 5_000;
export const BRIEF_LIGHT_POLL_TRIES = 12;

const BONE = '#FBF7F0';
const END = 1300;
const DECEL = Easing.bezier(...motion.easing.decel);
/** The coach's Home: the tab the coach app opens on (CoachNavigator initialTab). */
const HOME_TAB = __USING_MOCK_DATA ? 'CommandCenter' : 'ClientsStack';
const OPENS = 'Opens the screen for this item';
const OPENS_LIST = 'Opens the full list';
const CLOSES = 'Closes today\u2019s brief.';

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
  getParent: () => { navigate: (name: string, params?: object) => void } | undefined;
};

type Row = { key: string; label: string; hint?: string; onPress: () => void };

/** The narrative opens with "Good morning, {name}."; that sentence is set on its own. */
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

  /** Resolves false when the brief could not load or could not be prepared. */
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
      navigation.getParent()?.navigate(target ? target.tab : HOME_TAB, target?.params);
    },
    [navigation],
  );
  const leave = () => {
    void HapticService.softImpact();
    if (still) return close();
    Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => close());
  };
  const open = (action: BriefAction) => {
    void HapticService.softImpact();
    if (action.opens === 'list') navigation.navigate('CoachBriefList', { kind: action.kind, items: action.items });
    else close(action.target);
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
      actions = selectBriefActions(state.brief.summary?.action_items);
      rows = [
        ...actions.map((a) => ({ key: a.kind, label: a.label, hint: a.opens === 'list' ? OPENS_LIST : OPENS, onPress: () => open(a) })),
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
  const paras = [greeting, words, actions.length > 0 ? 'Where would you like to start?' : ''].filter(Boolean);
  const dots = state.kind === 'loading' || (state.kind === 'preparing' && state.polling);

  const rise = (start: number, dy: number, dur = 250) => {
    const range = { inputRange: [start, start + dur], extrapolate: 'clamp' as const, easing: DECEL };
    return {
      opacity: t.interpolate({ ...range, outputRange: [0, 1] }),
      transform: [{ translateY: t.interpolate({ ...range, outputRange: [dy, 0] }) }],
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
      <Animated.View style={[styles.fill, { opacity: fade, paddingHorizontal: gutter }]}>
        <ScrollView
          style={styles.words}
          contentContainerStyle={{ paddingTop: insets.top + (wide ? 64 : 44), paddingBottom: 8 }}
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
                    <Stop offset={0.5} stopColor={colors.romanAccent} stopOpacity={0.42} />
                    <Stop offset={1} stopColor={colors.romanAccent} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={56} cy={56} r={56} fill="url(#halo)" />
              </Svg>
              <View style={styles.ring}>
                <RomanAvatar crop="neutral" size={52} />
              </View>
            </View>
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Text style={styles.name}>Roman</Text>
              <Text style={styles.date}>{date}</Text>
            </View>
          </Animated.View>
          {paras.map((p, i) => (
            <Animated.View key={`${i}-${p.slice(0, 12)}`} style={[{ marginTop: i === 0 ? 28 : 14 }, rise(300 + i * step, 4)]}>
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
          // Long words scroll above the rows; a 32 pt fade shows there is more.
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
          style={[styles.rows, { paddingBottom: Math.max(insets.bottom, 16) + 16 }, rise(1000, 8, 300)]}
          pointerEvents={revealed ? 'auto' : 'none'}
        >
          {rows.map((row, i) => (
            <Pressable
              key={row.key}
              onPress={row.onPress}
              accessibilityRole="button"
              accessibilityLabel={row.label}
              accessibilityHint={row.hint}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID={`brief-row-${row.key}`}
            >
              <Text style={styles.badge} maxFontSizeMultiplier={1} accessibilityElementsHidden importantForAccessibility="no">
                {i + 1}
              </Text>
              <Text style={styles.label}>{row.label}</Text>
            </Pressable>
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111612' },
  fill: { flex: 1 },
  words: { flexGrow: 0, flexShrink: 1 },
  more: { marginTop: -32 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  halo: { borderRadius: 31, borderWidth: 4, borderColor: 'rgba(201,169,97,0.14)' },
  glow: { position: 'absolute', left: -29, top: -29 },
  ring: { borderRadius: 27, borderWidth: 1, borderColor: colors.romanAccent, overflow: 'hidden' },
  name: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 20, color: BONE },
  date: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: 'rgba(251,247,240,0.82)' },
  words24: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 24, lineHeight: 30, letterSpacing: 0.3, color: BONE },
  dots: { flexDirection: 'row', gap: 6, marginTop: 18 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(251,247,240,0.7)' },
  rows: { marginTop: 26, gap: 8 },
  row: {
    minHeight: 54,
    borderRadius: radius.button,
    backgroundColor: 'rgba(26,26,24,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(251,247,240,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 14,
  },
  pressed: { backgroundColor: 'rgba(12,12,11,0.98)' },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#2C2C29',
    color: colors.stone,
    textAlign: 'center',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 22,
  },
  label: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, letterSpacing: -0.1, color: BONE },
});
