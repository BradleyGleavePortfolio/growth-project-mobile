/**
 * TGP Charts — render-output contract tests.
 *
 * Asserts on the resolved props of the rendered SVG primitives (fill, stroke,
 * `d`, dimensions) — not on the source text of the chart files. Theme tokens
 * may be refactored freely as long as the rendered output preserves the
 * contract.
 *
 * The remaining source-grep tests target the `index.ts` export surface and
 * the structural shape of `TgpSparkline`, where the contract under test
 * (no axes / no tooltips / public exports) has no equivalent runtime
 * assertion.
 */

import * as fs from 'fs';
import * as path from 'path';
import React, { act } from 'react';
import { render } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
const CHARTS_DIR = path.join(ROOT, 'src', 'ui', 'charts');

const SPARK_SRC = fs.readFileSync(path.join(CHARTS_DIR, 'TgpSparkline.tsx'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(CHARTS_DIR, 'index.ts'), 'utf8');

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary:         '#2C4A36',
      primaryPale:     '#D6E4DA',
      surface:         '#F1E8D5',
      surfaceElevated: '#F1E8D5',
      background:      '#F5EFE4',
      textPrimary:     '#1A1A18',
      textSecondary:   '#3D3D3A',
      textMuted:       '#B1A89F',
      textOnPrimary:   '#F5EFE4',
      border:          '#B08D57',
      success:         '#2C4A36',
      warning:         '#C5A253',
      error:           '#4A0404',
    },
  }),
}));

// Capture the gesture callbacks so tests can drive them synchronously and
// force the chart into its tooltip-visible state. Each test resets the
// captured handlers before rendering.
type GestureHandlers = {
  panUpdate?: (evt: { x: number; y: number }) => void;
  panEnd?: () => void;
  tapStart?: (evt: { x: number; y: number }) => void;
};
const gestureHandlers: GestureHandlers = {};

jest.mock('react-native-gesture-handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mockReact = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  const makePanBuilder = () => {
    const builder = {
      runOnJS: () => builder,
      onUpdate: (fn: (evt: { x: number; y: number }) => void) => {
        gestureHandlers.panUpdate = fn;
        return builder;
      },
      onEnd: (fn: () => void) => {
        gestureHandlers.panEnd = fn;
        return builder;
      },
    };
    return builder;
  };
  const makeTapBuilder = () => {
    const builder = {
      runOnJS: () => builder,
      onStart: (fn: (evt: { x: number; y: number }) => void) => {
        gestureHandlers.tapStart = fn;
        return builder;
      },
    };
    return builder;
  };
  return {
    GestureDetector: ({ children }: { children: unknown }) =>
      mockReact.createElement(View, null, children),
    Gesture: {
      Pan: () => makePanBuilder(),
      Tap: () => makeTapBuilder(),
    },
  };
});

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mockReact = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  const MockSvg = ({ children }: { children?: unknown }) =>
    mockReact.createElement(View, { testID: 'svg' }, children);
  const makeMock = (name: string) =>
    ({ children, ...props }: { children?: unknown; [key: string]: unknown }) =>
      mockReact.createElement(View, { testID: name, ...props }, children);
  return {
    __esModule: true,
    default: MockSvg,
    Svg: MockSvg,
    Polyline: makeMock('Polyline'),
    Path: makeMock('Path'),
    Line: makeMock('Line'),
    Circle: makeMock('Circle'),
    Rect: makeMock('Rect'),
    Text: makeMock('SvgText'),
    G: makeMock('G'),
  };
});

// ─── Imports under test ───────────────────────────────────────────────────────

import TgpLineChart from '../ui/charts/TgpLineChart';
import TgpBarChart from '../ui/charts/TgpBarChart';
import TgpAreaChart from '../ui/charts/TgpAreaChart';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

// Quiet Luxury palette — what the rendered tooltip must use, regardless of
// which token in src/constants/colors.ts resolves to each value.
const BONE = '#F5EFE4';
const INK = '#1A1A18';
const OXBLOOD = '#4A0404';

const SAMPLE = [
  { x: 0, y: 180 },
  { x: 1, y: 179.5 },
  { x: 2, y: 179 },
  { x: 3, y: 178 },
  { x: 4, y: 177.5 },
];

beforeEach(() => {
  gestureHandlers.panUpdate = undefined;
  gestureHandlers.panEnd = undefined;
  gestureHandlers.tapStart = undefined;
});

// The tooltip Rect/SvgText in all three charts share the same dimensions
// (width=56, height=22, rx=1; fontSize=10, textAnchor="middle"). These
// selectors locate that specific Rect/SvgText among grid/axis siblings.
type Rendered = { props: Record<string, unknown> };
const isTooltipRect = (r: Rendered) =>
  r.props.width === 56 && r.props.height === 22 && r.props.rx === 1;
const isTooltipText = (t: Rendered) =>
  t.props.fontSize === 10 && t.props.textAnchor === 'middle';

// ─── TgpLineChart ─────────────────────────────────────────────────────────────

describe('TgpLineChart — render output', () => {
  it('renders the Svg primitives expected for a multi-point line', () => {
    const { getAllByTestId } = render(<TgpLineChart data={SAMPLE} height={200} />);
    expect(getAllByTestId('Polyline').length).toBeGreaterThan(0);
    expect(getAllByTestId('Circle').length).toBe(SAMPLE.length);
  });

  it('line stroke resolves to the theme primary color', () => {
    const { getAllByTestId } = render(<TgpLineChart data={SAMPLE} height={200} />);
    const polyline = getAllByTestId('Polyline')[0];
    expect(polyline.props.stroke).toBe('#2C4A36');
  });

  it('tooltip renders with Quiet Luxury palette: bone fill, oxblood stroke, ink text', () => {
    const { getAllByTestId } = render(<TgpLineChart data={SAMPLE} height={200} />);
    // Drive the pan gesture so the chart enters its tooltip-visible state.
    expect(gestureHandlers.panUpdate).toBeDefined();
    act(() => {
      gestureHandlers.panUpdate!({ x: 100, y: 50 });
    });
    const rects = getAllByTestId('Rect').map((n) => n as unknown as Rendered);
    const tooltipRect = rects.find(isTooltipRect);
    expect(tooltipRect).toBeDefined();
    expect(tooltipRect!.props.fill).toBe(BONE);
    expect(tooltipRect!.props.stroke).toBe(OXBLOOD);
    const texts = getAllByTestId('SvgText').map((n) => n as unknown as Rendered);
    const tooltipText = texts.find(isTooltipText);
    expect(tooltipText).toBeDefined();
    expect(tooltipText!.props.fill).toBe(INK);
  });

  it('renders an accessible root with role="image"', () => {
    const { getByLabelText } = render(<TgpLineChart data={SAMPLE} height={200} />);
    const root = getByLabelText('Line chart');
    expect(root.props.accessibilityRole).toBe('image');
  });

  it('renders empty state when data has fewer than 2 points', () => {
    const { getByText } = render(<TgpLineChart data={[{ x: 0, y: 100 }]} />);
    expect(getByText('Not enough data points')).toBeTruthy();
  });
});

// ─── TgpBarChart ──────────────────────────────────────────────────────────────

describe('TgpBarChart — render output', () => {
  it('renders one Rect per bar', () => {
    const { getAllByTestId } = render(<TgpBarChart data={SAMPLE} height={200} />);
    const bars = getAllByTestId('Rect').filter(
      (r) => !isTooltipRect(r as unknown as Rendered),
    );
    expect(bars.length).toBe(SAMPLE.length);
  });

  it('bar fill resolves to the theme primary color', () => {
    const { getAllByTestId } = render(<TgpBarChart data={SAMPLE} height={200} />);
    const bars = getAllByTestId('Rect').filter(
      (r) => !isTooltipRect(r as unknown as Rendered),
    );
    bars.forEach((bar) => expect(bar.props.fill).toBe('#2C4A36'));
  });

  it('tooltip renders with Quiet Luxury palette: bone fill, oxblood stroke, ink text', () => {
    const { getAllByTestId } = render(<TgpBarChart data={SAMPLE} height={200} />);
    expect(gestureHandlers.tapStart).toBeDefined();
    act(() => {
      gestureHandlers.tapStart!({ x: 80, y: 100 });
    });
    const rects = getAllByTestId('Rect').map((n) => n as unknown as Rendered);
    const tooltipRect = rects.find(isTooltipRect);
    expect(tooltipRect).toBeDefined();
    expect(tooltipRect!.props.fill).toBe(BONE);
    expect(tooltipRect!.props.stroke).toBe(OXBLOOD);
    const texts = getAllByTestId('SvgText').map((n) => n as unknown as Rendered);
    const tooltipText = texts.find(isTooltipText);
    expect(tooltipText).toBeDefined();
    expect(tooltipText!.props.fill).toBe(INK);
  });

  it('renders an accessible root with role="image"', () => {
    const { getByLabelText } = render(<TgpBarChart data={SAMPLE} height={200} />);
    const root = getByLabelText('Bar chart');
    expect(root.props.accessibilityRole).toBe('image');
  });
});

// ─── TgpAreaChart ─────────────────────────────────────────────────────────────

describe('TgpAreaChart — render output', () => {
  it('renders a filled area Path', () => {
    const { getAllByTestId } = render(<TgpAreaChart data={SAMPLE} height={200} />);
    const paths = getAllByTestId('Path');
    expect(paths.length).toBeGreaterThan(0);
    const area = paths[0];
    expect(typeof area.props.d).toBe('string');
    expect((area.props.d as string).length).toBeGreaterThan(0);
    expect(area.props.fill).toBeTruthy();
  });

  it('renders the line Polyline and one Circle per data point', () => {
    const { getAllByTestId } = render(<TgpAreaChart data={SAMPLE} height={200} />);
    expect(getAllByTestId('Polyline').length).toBe(1);
    expect(getAllByTestId('Circle').length).toBe(SAMPLE.length);
  });

  it('tooltip renders with Quiet Luxury palette: bone fill, oxblood stroke, ink text', () => {
    const { getAllByTestId } = render(<TgpAreaChart data={SAMPLE} height={200} />);
    expect(gestureHandlers.panUpdate).toBeDefined();
    act(() => {
      gestureHandlers.panUpdate!({ x: 100, y: 50 });
    });
    const rects = getAllByTestId('Rect').map((n) => n as unknown as Rendered);
    const tooltipRect = rects.find(isTooltipRect);
    expect(tooltipRect).toBeDefined();
    expect(tooltipRect!.props.fill).toBe(BONE);
    expect(tooltipRect!.props.stroke).toBe(OXBLOOD);
    const texts = getAllByTestId('SvgText').map((n) => n as unknown as Rendered);
    const tooltipText = texts.find(isTooltipText);
    expect(tooltipText).toBeDefined();
    expect(tooltipText!.props.fill).toBe(INK);
  });
});

// ─── TgpSparkline (structural shape — no runtime contract to assert) ──────────

describe('TgpSparkline — source guards', () => {
  it('accepts width and height props', () => {
    expect(SPARK_SRC).toMatch(/width\?.*number/);
    expect(SPARK_SRC).toMatch(/height\?.*number/);
  });

  it('renders area fill for visual momentum', () => {
    expect(SPARK_SRC).toMatch(/areaPath/);
  });

  it('has accessibilityLabel', () => {
    expect(SPARK_SRC).toMatch(/accessibilityLabel/);
  });

  it('is label-free (no axes, grid, or tooltips)', () => {
    expect(SPARK_SRC).not.toMatch(/yTicks/);
    expect(SPARK_SRC).not.toMatch(/SvgText/);
  });
});

// ─── charts/index.ts export surface ───────────────────────────────────────────

describe('charts/index.ts — export surface', () => {
  it('exports TgpLineChart', () => {
    expect(INDEX_SRC).toMatch(/export.*TgpLineChart/);
  });
  it('exports TgpBarChart', () => {
    expect(INDEX_SRC).toMatch(/export.*TgpBarChart/);
  });
  it('exports TgpAreaChart', () => {
    expect(INDEX_SRC).toMatch(/export.*TgpAreaChart/);
  });
  it('exports TgpSparkline', () => {
    expect(INDEX_SRC).toMatch(/export.*TgpSparkline/);
  });
  it('re-exports ChartDataPoint type', () => {
    expect(INDEX_SRC).toMatch(/export type.*ChartDataPoint/);
  });
});
