/**
 * REDO-DEVICES-133 part 2: metric detail on the shared primitives at 360 x 800 and 390 x 844: insets,
 * title stack, hero caption, dated values, the Starter goal label, calm states, no filled forest box.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
const mockSamples = jest.fn();
jest.mock('../../../../hooks/useWearableSamples', () => ({
  useWearableSamples: () => mockSamples(),
}));
jest.mock('../charts/RevolutGlowChart', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => ReactLocal.createElement(View, { testID: 'glow-chart' }) };
});
jest.mock('../components/ProviderOverlapChips', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/useReduceMotion', () => ({ useReduceMotion: () => true }));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = false;
let mockParams: Record<string, unknown> = { metric: 'STEPS', bucket: 'HEALTH_FITNESS' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: jest.fn(), goBack: mockGoBack, canGoBack: () => mockCanGoBack }),
  useRoute: () => ({ params: mockParams }),
}));

import MetricDetailScreen, {
  changeLine,
  dayLabel,
  goalDetail,
  heroCaption,
  sentenceLabel,
  starterGoalFor,
} from '../MetricDetailScreen';
import { layout, lightTokens } from '../../../../theme/tokens';

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 24, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
] as const;

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 1); // Thu 1 Oct 2026

function stepsSeries(values: number[]) {
  const at = (i: number) => new Date(START + i * DAY).toISOString();
  const samples = values.map((v, i) => ({ provider: 'APPLE_HEALTHKIT', value: v, start_at: at(i), end_at: at(i) }));
  const buckets = values.map((v, i) => ({ bucket_start: at(i), agg: v }));
  return { series: [{ metric: 'STEPS', unit: 'count', provider_used: 'APPLE_HEALTHKIT', sample_count: values.length, samples, buckets }] };
}

function samplesResult(over: Record<string, unknown>) {
  return { data: undefined, isLoading: false, isError: false, error: null, refetch: jest.fn(), ...over };
}

/** No 0, 2 or 4 pt corners and no filled forest box anywhere in the tree. */
function expectQuietTree(json: unknown) {
  const radii: number[] = [];
  const fills: string[] = [];
  const walk = (n: unknown) => {
    if (n == null || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as { props?: { style?: unknown }; children?: unknown };
    const s = StyleSheet.flatten(node.props?.style as StyleProp<Flat>) as Flat | undefined;
    if (s?.borderRadius != null) radii.push(s.borderRadius as number);
    if (typeof s?.backgroundColor === 'string') fills.push(s.backgroundColor);
    walk(node.children);
  };
  walk(json);
  expect(radii.filter((r) => r === 2 || r === 4)).toEqual([]);
  expect(fills).not.toContain(lightTokens.accent);
  expect(fills).not.toContain('#F1E8D5'); // cream card fill
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockCanGoBack = false;
  mockParams = { metric: 'STEPS', bucket: 'HEALTH_FITNESS' };
});

describe('MetricDetailScreen helpers', () => {
  const pts = [
    { x: START, y: 4000 },
    { x: START + DAY, y: 6000 },
    { x: START + 2 * DAY, y: 5000 },
  ];

  it('dates read in UTC, as the Health overview does', () => {
    expect(dayLabel(START)).toBe('1 Oct');
    expect(dayLabel(START + DAY, true)).toBe('Fri 2 Oct');
  });

  it('titles are sentence case with acronyms kept', () => {
    expect(sentenceLabel('Resting Heart Rate')).toBe('Resting heart rate');
    expect(sentenceLabel('VO₂ Max')).toBe('VO₂ max');
    expect(sentenceLabel('Blood Pressure (Systolic)')).toBe('Blood pressure (systolic)');
  });

  it('says what the hero number is and which days the change compares', () => {
    expect(heroCaption('sum', pts)).toBe('Total, last 30 days');
    expect(heroCaption('avg', pts)).toBe('Average, last 30 days');
    expect(heroCaption('latest', pts)).toBe('Latest reading, 3 Oct');
    expect(changeLine(pts)).toBe('Up 25% from 1 Oct to 3 Oct');
    expect(changeLine([pts[0]])).toBe('Last 30 days');
  });

  it('uses DES-H Starter goals only where they exist', () => {
    expect(starterGoalFor('STEPS')).toEqual({ target: 5000, unit: 'steps' });
    expect(starterGoalFor('RESTING_HEART_RATE_BPM')).toBeNull();
    expect(goalDetail(pts, 5000)).toBe('Reached on 2 of 3 days with data');
  });
});

describe.each(DEVICES)('Metric detail at $name', ({ frame, insets }) => {
  const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={{ frame, insets }}>{ui}</SafeAreaProvider>;

  it('shows the hero, the Starter goal and dated values', async () => {
    mockSamples.mockReturnValue(samplesResult({ data: stepsSeries([4000, 6000, 5000]) }));
    const r = await render(wrap(<MetricDetailScreen />));
    expect(flat(r.getByTestId('metric-detail')).paddingTop).toBe(insets.top + layout.statusBarGap);
    expect(screen.getByRole('header', { name: 'Steps' })).toBeTruthy();
    expect(screen.getByText('Fitness')).toBeTruthy();
    expect(screen.getByText('Total, last 30 days')).toBeTruthy();
    expect(screen.getByText('15,000')).toBeTruthy();
    expect(screen.getByText('Up 25% from 1 Oct to 3 Oct')).toBeTruthy();
    expect(screen.getByText('Starter goal')).toBeTruthy();
    expect(screen.getByText('5,000 steps')).toBeTruthy();
    expect(screen.getByText('Reached on 2 of 3 days with data')).toBeTruthy();
    expect(screen.getByText('Recent days')).toBeTruthy();
    expect(screen.getByLabelText('Sat 3 Oct, 5,000')).toBeTruthy();
    expect(screen.getByTestId('glow-chart')).toBeTruthy();
    expectQuietTree(r.toJSON());
  });

  it('a metric without a Starter goal shows none', async () => {
    mockParams = { metric: 'RESTING_HEART_RATE_BPM', bucket: 'SLEEP_RECOVERY' };
    mockSamples.mockReturnValue(samplesResult({ data: { series: [] } }));
    await render(wrap(<MetricDetailScreen />));
    expect(screen.getByRole('header', { name: 'Resting heart rate' })).toBeTruthy();
    expect(screen.getByText('Recovery')).toBeTruthy();
    expect(screen.queryByText('Starter goal')).toBeNull();
    // Empty: the same words as before, and Connect a source still opens Connections.
    expect(screen.getByText('No resting heart rate yet')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Connect a source'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
  });

  it('a failed load says what failed and keeps Try again', async () => {
    const refetch = jest.fn();
    mockSamples.mockReturnValue(samplesResult({ isError: true, refetch }));
    const r = await render(wrap(<MetricDetailScreen />));
    expect(screen.getByText('Steps could not load. Try again in a moment.')).toBeTruthy();
    expect(screen.queryByText(/Your data is safe/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(refetch).toHaveBeenCalledTimes(1);
    expectQuietTree(r.toJSON());
  });

  it('loading is a skeleton with a spoken label, not a spinner', async () => {
    mockSamples.mockReturnValue(samplesResult({ isLoading: true }));
    await render(wrap(<MetricDetailScreen />));
    expect(screen.getByLabelText('Loading steps')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

// B-HEALTHBACK-135 (B29): the More stack hides the native header and iOS has no hardware back, so the
// pushed detail draws the coach screens' Back (m#638) on every branch, first under the Screen top.
describe.each(DEVICES)('Metric detail Back at $name', ({ frame, insets }) => {
  const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={{ frame, insets }}>{ui}</SafeAreaProvider>;
  /** The first announced node (a label or a text) in render order. */
  const firstAnnounced = (n: unknown): string | undefined => {
    if (n == null || typeof n !== 'object') return undefined;
    if (Array.isArray(n)) {
      for (const c of n) {
        const hit = firstAnnounced(c);
        if (hit) return hit;
      }
      return undefined;
    }
    const node = n as { props?: { accessibilityLabel?: unknown }; children?: unknown[] | null };
    if (typeof node.props?.accessibilityLabel === 'string') return node.props.accessibilityLabel;
    const text = node.children?.find((c) => typeof c === 'string');
    return typeof text === 'string' ? text : firstAnnounced(node.children ?? null);
  };
  const BRANCHES = [
    { name: 'loaded', root: 'metric-detail', over: { data: stepsSeries([4000, 6000, 5000]) } },
    { name: 'loading', root: 'metric-detail-loading', over: { isLoading: true } },
    { name: 'error', root: 'metric-detail-error', over: { isError: true } },
  ];

  it.each(BRANCHES)('$name: a 44 pt Back first under the Screen top goes back once', async ({ root, over }) => {
    mockCanGoBack = true;
    mockSamples.mockReturnValue(samplesResult(over));
    const r = await render(wrap(<MetricDetailScreen />));
    expect(flat(r.getByTestId(root)).paddingTop).toBe(insets.top + layout.statusBarGap);
    const back = screen.getByTestId('metric-detail-back');
    expect(back.props.accessibilityRole).toBe('button');
    expect(back.props.accessibilityLabel).toBe('Back');
    expect(flat(back).width).toBe(44);
    expect(flat(back).height).toBe(44);
    expect(firstAnnounced(r.toJSON())).toBe('Back');
    await fireEvent.press(back);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expectQuietTree(r.toJSON());
  });

  it.each(BRANCHES)('$name: no Back when there is nothing to go back to', async ({ over }) => {
    mockSamples.mockReturnValue(samplesResult(over));
    await render(wrap(<MetricDetailScreen />));
    expect(screen.queryByTestId('metric-detail-back')).toBeNull();
    expect(screen.queryByLabelText('Back')).toBeNull();
  });

  it('keeps Connect a source next to Back on an empty metric', async () => {
    mockCanGoBack = true;
    mockSamples.mockReturnValue(samplesResult({ data: { series: [] } }));
    await render(wrap(<MetricDetailScreen />));
    await fireEvent.press(screen.getByLabelText('Connect a source'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
