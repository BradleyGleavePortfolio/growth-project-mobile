/**
 * HomeTiles — the rings Home tile grid (UI-1), two columns with 12 pt gaps. Each
 * tile opens the screen that already exists for it; the water chip adds one
 * glass (8 oz, or 250 ml in metric, the Food log's first amount) with a haptic
 * for saved or not saved. Fasting, the next session or logging run, Edit tiles
 * and the notice slot follow in the next UI-1 pull request.
 */
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useSettings } from '../../../hooks/useSettings';
import { useHabitLogs, useHabits, useWeightHistory } from '../../../hooks/useApi';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { useClientStore } from '../../../store/clientStore';
import { getTodayString } from '../../../utils/date';
import { PROVIDER_CONFIG } from '../../../api/wearablesConnectionsApi';
import { STARTER_GOALS } from '../../../screens/client/wearables/starterGoals';
import { seriesPoints } from '../../../screens/client/wearables/seriesSummary';
import { parseWeightLogRow, weightHistoryRows } from '../../../screens/client/progress/weightHistory';
import HomeTile from './HomeTile';
import { checkInTile, habitsTile, proteinTile, stepsTile, waterTile, weightTile } from './homeTiles';

export interface HomeTilesProps {
  day: { ready: boolean; protein?: number; carbs?: number; fat?: number; proteinTarget?: number; simple: boolean; waterOz: number };
  checkIn: unknown;
  refreshing: boolean;
  /** #RINGS-CONNECT: the client's connections list none connected (noHealthSource, read once on Home). */
  noSource: boolean;
}

const WATER_NOT_SAVED = ' oz of water was not saved. Check the connection, then add it again.';

export default function HomeTiles({ day, checkIn, refreshing, noSource }: HomeTilesProps) {
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
  // Pull to refresh on Home refetches every tile read (useQuery's refetch functions are stable).
  const { refetch: refetchWeight } = weight;
  const { refetch: refetchHabits } = habits;
  const { refetch: refetchHabitLogs } = habitLogs;
  const { refetch: refetchFitness } = fitness;
  useEffect(() => {
    if (refreshing) void Promise.all([refetchWeight(), refetchHabits(), refetchHabitLogs(), refetchFitness()]);
  }, [refreshing, refetchWeight, refetchHabits, refetchHabitLogs, refetchFitness]);

  const metric = settings.unit === 'kg';
  const protein = proteinTile({ ready: day.ready, protein: day.protein, carbs: day.carbs, fat: day.fat, target: day.proteinTarget, simple: day.simple });
  const water = waterTile({ ready: day.ready && loaded, oz: day.waterOz, goalOz: settings.waterGoalOz, metric });
  const rows = weight.isSuccess
    ? weightHistoryRows(weight.data).map((r) => parseWeightLogRow(r, currentUser?.id ?? '')).filter((r) => r !== null)
    : null;
  const body = weightTile(loaded ? rows : null, metric);
  const habitView = habitsTile(habits.data, habitLogs.data, today);
  const stepsSeries = fitness.data?.series.find((s) => s.metric === 'STEPS');
  // Day buckets are calendar days in UTC (as the Health screen reads them).
  const todaySteps = seriesPoints(stepsSeries).filter((p) => new Date(p.x).toISOString().slice(0, 10) === today).pop();
  const steps = stepsTile({
    today: todaySteps ? Math.round(todaySteps.y) : null,
    // The Sleep dial's rule: "Connect" only once Health answered with no steps today and no source is connected.
    connected: !noSource || !fitness.isSuccess,
    goal: STARTER_GOALS.STEPS,
    source: stepsSeries?.provider_used ? PROVIDER_CONFIG[stepsSeries.provider_used]?.displayName ?? null : null,
  });

  const glass = metric ? 250 : 8;
  // Until today's water is known the chip reads as off (and is off), so it is never a dead tap.
  const waterReady = !!water.value && water.value !== '—';
  const addWater = async () => {
    if (!currentUser) return;
    await logWater(currentUser.id, '', metric ? glass / 29.5735 : glass);
    if (useClientStore.getState().loadError?.endsWith(WATER_NOT_SAVED)) void HapticService.error();
    else void HapticService.success();
  };

  const tiles = [
    <HomeTile key="protein" label="Protein" view={protein} testID="home-tile-protein" onPress={() => navigation.navigate('Log')} />,
    <HomeTile key="water" label="Water" view={water} testID="home-tile-water" onPress={() => navigation.navigate('Log')}
      accessory={
        <Pressable testID="home-tile-water-add" onPress={() => void addWater()} disabled={!waterReady}
          accessibilityRole="button" accessibilityLabel={`Add ${glass} ${metric ? 'milliliters' : 'ounces'} of water`}
          style={({ pressed }) => [styles.chip, { borderColor: sc.border, backgroundColor: sc.bgSurface, opacity: !waterReady ? 0.4 : pressed ? 0.7 : 1 }]}>
          <Ionicons name="add" size={16} color={sc.textPrimary} />
          <Text style={[styles.chipText, { color: sc.textPrimary }]}>{metric ? `${glass} ml` : `${glass} oz`}</Text>
        </Pressable>
      } />,
    <HomeTile key="weight" label="Weight" view={body} testID="home-tile-weight" onPress={() => navigation.navigate('MoreTab', { screen: 'Progress', initial: false })}>
      {body.points.length > 1 ? <Sparkline points={body.points} color={sc.accent} /> : null}
    </HomeTile>,
    <HomeTile key="habits" label="Habits" view={habitView} testID="home-tile-habits" onPress={() => navigation.navigate('Habits')} />,
    // #RINGS-CONNECT (the Sleep dial's rule): Connections only when the client's connections list none connected and
    // Health has no steps today; every other state opens Health and fitness. Both sit in the Home stack.
    <HomeTile key="steps" label="Steps" view={steps} testID="home-tile-steps" prompt={steps.value === 'Connect'}
      onPress={() => (noSource && !todaySteps ? navigation.navigate('Connections') : navigation.navigate('Health', { bucket: 'fitness' }))} />,
    <HomeTile key="checkin" label="Check-in" view={checkInTile(checkIn)} testID="home-tile-checkin" onPress={() => navigation.navigate('Habits', { initialTab: 'checkin' })} />,
  ];
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
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: layout.touchMin, paddingHorizontal: 14,
    borderRadius: radius.chip, borderWidth: 1,
  },
  chipText: { ...typography.bodyMd, fontSize: 13, lineHeight: 18 },
  spark: { marginTop: 10 },
});
