/**
 * HomeTiles — the rings Home tile grid (UI-1), two columns with 12 pt gaps. Each
 * tile opens the screen that already exists for it; the water chip adds one
 * glass (8 oz, or 250 ml in metric, the Food log's first amount) with a haptic
 * for saved or not saved. The eighth tile is the next session (coached, while
 * the Calendar tab is on) or the logging run. Every read refetches when Home is
 * focused again, so a fast, weigh-in or meal logged elsewhere shows on return.
 * Edit tiles and the notice slot follow in a later UI-1 pull request.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { useFocusEffect, useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useSettings } from '../../../hooks/useSettings';
import { useHabitLogs, useHabits, useWeightHistory } from '../../../hooks/useApi';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { fastingApi, logApi } from '../../../services/api';
import { schedulingApi } from '../../../api/schedulingApi';
import { useClientStore } from '../../../store/clientStore';
import { featureFlags } from '../../../config/featureFlags';
import { getTodayString } from '../../../utils/date';
import { PROVIDER_CONFIG } from '../../../api/wearablesConnectionsApi';
import { STARTER_GOALS } from '../../../screens/client/wearables/starterGoals';
import { seriesPoints } from '../../../screens/client/wearables/seriesSummary';
import { parseWeightLogRow, weightHistoryRows } from '../../../screens/client/progress/weightHistory';
import HomeTile from './HomeTile';
import {
  checkInTile, fastingTile, habitsTile, loggingTile, nextSessionTile, proteinTile, shiftDay, stepsTile, waterTile, weightTile,
} from './homeTiles';

export interface HomeTilesProps {
  day: { ready: boolean; protein?: number; carbs?: number; fat?: number; proteinTarget?: number; simple: boolean; waterOz: number };
  checkIn: unknown;
  refreshing: boolean;
  /** null until the user is known: the eighth tile waits for it. */
  coached: boolean | null;
}

const WATER_NOT_SAVED = ' oz of water was not saved. Check the connection, then add it again.';

export default function HomeTiles({ day, checkIn, refreshing, coached }: HomeTilesProps) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const { settings, loaded } = useSettings();
  const { logWater } = useClientStore();
  const today = getTodayString();
  const weight = useWeightHistory(30);
  const habits = useHabits();
  const habitLogs = useHabitLogs(today);
  // One window per local day (as the Sleep dial's), so the query key is stable and refresh refetches it.
  const range = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    return { from: new Date(y, m - 1, d - 7).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() };
  }, [today]);
  const fitness = useWearableSamples(
    { bucket: 'HEALTH_FITNESS', from: range.from, to: range.to, granularity: 'day', preferredOnly: true },
    { enabled: !!currentUser },
  );
  const fasting = useQuery({
    queryKey: ['fasting', 'history', 10],
    queryFn: async () => (await fastingApi.getHistory(10)).data as unknown,
    enabled: !!currentUser,
  });
  // The eighth tile: the next session needs the Calendar tab to open; otherwise the logging run.
  const eighth = coached === null ? null : coached && featureFlags.clientCalendar ? 'session' : 'logging';
  // Same key as useMyUpcomingSessions(5).
  const sessions = useQuery({
    queryKey: ['scheduling', 'sessions', 'me', { limit: 5 }],
    queryFn: () => schedulingApi.listMySessions(5),
    enabled: eighth === 'session',
  });
  // Two weekly reads cover the last 14 days; each row is a day with food logged.
  const logging = useQuery({
    queryKey: ['log', 'weekly', 'days', today],
    queryFn: async () => {
      const weeks = await Promise.all([logApi.getWeekly(shiftDay(today, -13)), logApi.getWeekly(shiftDay(today, -6))]);
      return weeks.flatMap((w) => (Array.isArray(w.data) ? (w.data as Array<{ date?: unknown }>) : []))
        .map((r) => r.date).filter((d): d is string => typeof d === 'string');
    },
    enabled: eighth === 'logging' && !!currentUser,
  });
  const [now, setNow] = useState(() => Date.now());
  const refetchAll = () => Promise.all([
    weight.refetch(), habits.refetch(), habitLogs.refetch(), fitness.refetch(), fasting.refetch(),
    eighth === 'session' ? sessions.refetch() : null, eighth === 'logging' ? logging.refetch() : null,
  ]);
  useEffect(() => {
    if (refreshing) void refetchAll();
  }, [refreshing]);
  // The first focus is the mount (the reads are already loading); later focuses refetch.
  const seen = useRef(false);
  const refetchOnFocus = useRef(refetchAll);
  refetchOnFocus.current = refetchAll;
  useFocusEffect(useCallback(() => {
    setNow(Date.now());
    if (seen.current) void refetchOnFocus.current();
    seen.current = true;
  }, []));

  const metric = settings.unit === 'kg';
  const protein = proteinTile({ ready: day.ready, protein: day.protein, carbs: day.carbs, fat: day.fat, target: day.proteinTarget, simple: day.simple });
  const water = waterTile({ ready: day.ready && loaded, oz: day.waterOz, goalOz: settings.waterGoalOz, metric });
  const rows = weight.isSuccess
    ? weightHistoryRows(weight.data).map((r) => parseWeightLogRow(r, currentUser?.id ?? '')).filter((r) => r !== null)
    : null;
  const body = weightTile(loaded ? rows : null, metric);
  const habitView = habitsTile(habits.data, habitLogs.data);
  const stepsSeries = fitness.data?.series.find((s) => s.metric === 'STEPS');
  // Day buckets are calendar days in UTC (as the Health screen reads them).
  const todaySteps = seriesPoints(stepsSeries).filter((p) => new Date(p.x).toISOString().slice(0, 10) === today).pop();
  const steps = stepsTile({
    today: todaySteps ? Math.round(todaySteps.y) : null,
    connected: !fitness.isSuccess || (fitness.data?.freshness.providers.length ?? 0) > 0,
    goal: STARTER_GOALS.STEPS,
    source: stepsSeries?.provider_used ? PROVIDER_CONFIG[stepsSeries.provider_used]?.displayName ?? null : null,
  });

  const fast = fastingTile(fasting.data, now);
  // A running fast's time so far moves on each minute.
  useEffect(() => {
    if (!fast.active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, [fast.active]);
  const next = nextSessionTile(sessions.data, now);
  const run = loggingTile(logging.data, today);

  const glass = metric ? 250 : 8;
  const addWater = async () => {
    if (!currentUser) return;
    await logWater(currentUser.id, '', metric ? glass / 29.5735 : glass);
    if (useClientStore.getState().loadError?.endsWith(WATER_NOT_SAVED)) void HapticService.error();
    else void HapticService.success();
  };
  const open = (screen: string, params?: object) => () =>
    navigation.navigate('MoreTab', params ? { screen, initial: false, params } : { screen, initial: false });

  const tiles = [
    <HomeTile key="protein" label="Protein" view={protein} testID="home-tile-protein" onPress={() => navigation.navigate('Log')} />,
    <HomeTile key="water" label="Water" view={water} testID="home-tile-water" onPress={() => navigation.navigate('Log')}
      accessory={
        <Pressable testID="home-tile-water-add" onPress={() => void addWater()} disabled={!water.value || water.value === '—'}
          accessibilityRole="button" accessibilityLabel={`Add ${glass} ${metric ? 'milliliters' : 'ounces'} of water`}
          hitSlop={6} style={({ pressed }) => [styles.chip, { borderColor: sc.border, backgroundColor: sc.bgSurface, opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="add" size={16} color={sc.textPrimary} />
          <Text style={[styles.chipText, { color: sc.textPrimary }]}>{metric ? `${glass} ml` : `${glass} oz`}</Text>
        </Pressable>
      } />,
    <HomeTile key="weight" label="Weight" view={body} testID="home-tile-weight" onPress={open('Progress')}>
      {body.points.length > 1 ? <Sparkline points={body.points} color={sc.accent} /> : null}
    </HomeTile>,
    <HomeTile key="fasting" label="Fasting" view={fast} testID="home-tile-fasting" onPress={open('Fast')} />,
    <HomeTile key="habits" label="Habits" view={habitView} testID="home-tile-habits" onPress={() => navigation.navigate('Habits')} />,
    // Connections only once Health answered with no source; pending or failed opens Health and fitness.
    <HomeTile key="steps" label="Steps" view={steps} testID="home-tile-steps" prompt={steps.value === 'Connect'}
      onPress={steps.value === 'Connect' ? open('Connections') : open('Health', { bucket: 'fitness' })} />,
    <HomeTile key="checkin" label="Check-in" view={checkInTile(checkIn)} testID="home-tile-checkin" onPress={() => navigation.navigate('Habits')} />,
  ];
  if (eighth === 'session') {
    tiles.push(
      <HomeTile key="session" label="Next session" view={next} testID="home-tile-session"
        onPress={() => navigation.navigate('CalendarTab', next.sessionId
          ? { screen: 'CalendarSession', initial: false, params: { sessionId: next.sessionId } }
          : { screen: 'CalendarHome' })} />,
    );
  } else if (eighth === 'logging') {
    tiles.push(<HomeTile key="logging" label="Logging" view={run} testID="home-tile-logging" onPress={() => navigation.navigate('Log')} />);
  }
  const pairs: React.ReactNode[][] = [];
  for (let i = 0; i < tiles.length; i += 2) pairs.push(tiles.slice(i, i + 2));
  return (
    <View style={styles.grid} testID="home-tiles">
      {pairs.map((pair, i) => <View key={i} style={styles.row}>{pair}{pair.length === 1 ? <View style={styles.spacer} /> : null}</View>)}
    </View>
  );
}

/** The 30-day weight line, scaled to the tile's width. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 100},${22 - ((p - min) / span) * 18}`).join(' ');
  return (
    <Svg testID="home-tile-weight-trend" width="100%" height={26} viewBox="0 0 100 26" preserveAspectRatio="none" style={styles.spark}>
      <Polyline points={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  grid: { marginTop: 20, gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  spacer: { flex: 1 },
  chip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 32, paddingHorizontal: 12,
    borderRadius: radius.chip, borderWidth: 1,
  },
  chipText: { ...typography.bodyMd, fontSize: 13, lineHeight: 18 },
  spark: { marginTop: 10 },
});
