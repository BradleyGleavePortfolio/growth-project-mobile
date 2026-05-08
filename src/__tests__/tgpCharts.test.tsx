/**
 * TGP Charts — snapshot + source-level contract tests.
 *
 * Tests:
 *  1. TgpLineChart — snapshot with sample data
 *  2. TgpBarChart  — source-level contracts
 *  3. TgpAreaChart — source-level contracts
 *  4. TgpSparkline — source-level contracts
 *  5. index.ts     — export surface contracts
 *
 * Source-level guards verify the documented API surface without requiring
 * a full Skia/native render environment (which is unavailable in CI Jest).
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
const CHARTS_DIR = path.join(ROOT, 'src', 'ui', 'charts');

// ─── Source paths ─────────────────────────────────────────────────────────────

const LINE_SRC = fs.readFileSync(path.join(CHARTS_DIR, 'TgpLineChart.tsx'), 'utf8');
const BAR_SRC  = fs.readFileSync(path.join(CHARTS_DIR, 'TgpBarChart.tsx'),  'utf8');
const AREA_SRC = fs.readFileSync(path.join(CHARTS_DIR, 'TgpAreaChart.tsx'), 'utf8');
const SPARK_SRC= fs.readFileSync(path.join(CHARTS_DIR, 'TgpSparkline.tsx'), 'utf8');
const INDEX_SRC= fs.readFileSync(path.join(CHARTS_DIR, 'index.ts'),         'utf8');

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary:       '#2C4A36',
      primaryPale:   '#D6E4DA',
      surface:       '#F1E8D5',
      surfaceElevated: '#F1E8D5',
      background:    '#F5EFE4',
      textPrimary:   '#1A1A18',
      textSecondary: '#3D3D3A',
      textMuted:     '#B1A89F',
      textOnPrimary: '#F5EFE4',
      border:        '#B08D57',
      success:       '#2C4A36',
      warning:       '#C5A253',
      error:         '#4A0404',
    },
  }),
}));

jest.mock('react-native-gesture-handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mockReact = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  return {
    GestureDetector: ({ children }: { children: unknown }) =>
      mockReact.createElement(View, null, children),
    Gesture: {
      Pan: () => ({ runOnJS: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) }),
      Tap: () => ({ runOnJS: () => ({ onStart: () => ({}) }) }),
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

// ─── Source-level contracts ───────────────────────────────────────────────────

describe('TgpLineChart — source guards', () => {
  it('accepts data: Array<{x, y}> prop', () => {
    expect(LINE_SRC).toMatch(/data:\s*ChartDataPoint\[\]/);
  });

  it('accepts optional height prop', () => {
    expect(LINE_SRC).toMatch(/height\?.*number/);
  });

  it('accepts optional themeOverride prop', () => {
    expect(LINE_SRC).toMatch(/themeOverride\?.*Partial<ThemeColors>/);
  });

  it('falls back to FALLBACK tokens when ThemeProvider is absent', () => {
    expect(LINE_SRC).toMatch(/FALLBACK/);
    expect(LINE_SRC).toMatch(/catch/);
  });

  it('tooltip uses Quiet Luxury palette: bone bg, ink text, oxblood border', () => {
    expect(LINE_SRC).toMatch(/#F5EFE4/);    // bone background
    expect(LINE_SRC).toMatch(/#1A1A18/);    // ink text
    expect(LINE_SRC).toMatch(/#4A0404/);    // oxblood border
  });

  it('uses react-native-gesture-handler for pan', () => {
    expect(LINE_SRC).toMatch(/GestureDetector/);
    expect(LINE_SRC).toMatch(/Gesture\.Pan/);
  });

  it('has accessibilityLabel and accessibilityRole on root', () => {
    expect(LINE_SRC).toMatch(/accessibilityLabel/);
    expect(LINE_SRC).toMatch(/accessibilityRole="image"/);
  });

  it('has JSDoc block at the top of the file', () => {
    expect(LINE_SRC.trimStart()).toMatch(/^\/\*\*/);
  });
});

describe('TgpBarChart — source guards', () => {
  it('accepts data: Array<{x, y}> prop', () => {
    expect(BAR_SRC).toMatch(/data:\s*ChartDataPoint\[\]/);
  });

  it('has tooltip with Quiet Luxury styling', () => {
    expect(BAR_SRC).toMatch(/#F5EFE4/);
    expect(BAR_SRC).toMatch(/#4A0404/);
  });

  it('uses GestureDetector', () => {
    expect(BAR_SRC).toMatch(/GestureDetector/);
  });

  it('has accessibilityRole="image"', () => {
    expect(BAR_SRC).toMatch(/accessibilityRole="image"/);
  });
});

describe('TgpAreaChart — source guards', () => {
  it('accepts data: Array<{x, y}> prop', () => {
    expect(AREA_SRC).toMatch(/data:\s*ChartDataPoint\[\]/);
  });

  it('renders a filled area Path element', () => {
    expect(AREA_SRC).toMatch(/areaPath/);
    expect(AREA_SRC).toMatch(/<Path/);
  });

  it('has pan gesture support', () => {
    expect(AREA_SRC).toMatch(/Gesture\.Pan/);
  });

  it('has tooltip with Quiet Luxury styling', () => {
    expect(AREA_SRC).toMatch(/#F5EFE4/);
    expect(AREA_SRC).toMatch(/#4A0404/);
  });
});

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
    // Sparkline must not have y-axis labels or grid lines
    expect(SPARK_SRC).not.toMatch(/yTicks/);
    expect(SPARK_SRC).not.toMatch(/SvgText/);
  });
});

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

// ─── RTL snapshot — TgpLineChart ─────────────────────────────────────────────

import TgpLineChart from '../ui/charts/TgpLineChart';

const SAMPLE_DATA = [
  { x: 0, y: 180 },
  { x: 1, y: 179.5 },
  { x: 2, y: 179 },
  { x: 3, y: 178 },
  { x: 4, y: 177.5 },
];

describe('TgpLineChart — RTL snapshot', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<TgpLineChart data={SAMPLE_DATA} height={200} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders a View with accessibilityRole="image"', () => {
    const { getByRole } = render(<TgpLineChart data={SAMPLE_DATA} height={200} />);
    expect(getByRole('image')).toBeTruthy();
  });

  it('renders empty state when data has fewer than 2 points', () => {
    const { getByText } = render(<TgpLineChart data={[{ x: 0, y: 100 }]} />);
    expect(getByText('Not enough data points')).toBeTruthy();
  });
});
