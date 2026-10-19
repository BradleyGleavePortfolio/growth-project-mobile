/**
 * Shared wearable chart: unfilled lines or daily-total bars.
 *
 * Pins the owner's no-area/no-gradient/no-glow rule:
 *   • the line is a smooth `<Path>` whose `d` starts with `M` and contains at
 *     least one cubic-bezier `C` command (NOT the prior tutorial `<Polyline>`),
 *   • the reduce-motion path renders the chart fully (data is never hidden
 *     behind an animation — #50 graceful degradation).
 *
 * We walk the rendered element tree (react-test-renderer JSON) and inspect SVG
 * element types + props directly, which is robust to RN-SVG's internals.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RevolutGlowChart, type GlowChartPoint } from '../RevolutGlowChart';
import { CHART_FLARE as FLARE } from '../../wearablesTheme';
import { colors } from '../../../../../theme/tokens';

const mockPan: {
  begin?: (e: { x: number }) => void;
  update?: (e: { x: number }) => void;
  finalize?: () => void;
} = {};
jest.mock('react-native-gesture-handler', () => {
  const ReactLocal = require('react');
  return {
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement(ReactLocal.Fragment, null, children),
    Gesture: { Pan: () => {
      const g = {
        onBegin: (fn: typeof mockPan.begin) => { mockPan.begin = fn; return g; },
        onUpdate: (fn: typeof mockPan.update) => { mockPan.update = fn; return g; },
        onFinalize: (fn: typeof mockPan.finalize) => { mockPan.finalize = fn; return g; },
      };
      return g;
    } },
  };
});
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return { ...mock, runOnJS: (fn: unknown) => fn };
});
jest.mock('react-native-svg', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const mark = (name: string) => ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactLocal.createElement(View, { ...props, testID: name }, children);
  return { __esModule: true, default: mark('Svg'), Path: mark('Path'), Rect: mark('Rect'), Circle: mark('Circle'), Line: mark('Line') };
});

const DATA: readonly GlowChartPoint[] = [
  { value: 62, label: '2026-05-01' },
  { value: 58, label: '2026-05-02' },
  { value: 71, label: '2026-05-03' },
  { value: 65, label: '2026-05-04' },
  { value: 60, label: '2026-05-05' },
];

/**
 * Minimal structural shape of a react-test-renderer JSON node we inspect.
 * `props` is intentionally an index map of unknown values so each read site
 * narrows the specific prop it cares about (no blanket `any`).
 */
interface TestNode {
  readonly props?: Record<string, unknown>;
  readonly children?: readonly unknown[];
}

/** Type guard: is this rendered JSON value an inspectable node? */
function isTestNode(value: unknown): value is TestNode {
  return typeof value === 'object' && value !== null;
}

/** Read a string prop off a node, or undefined if absent/non-string. */
function stringProp(node: TestNode, key: string): string | undefined {
  const v = node.props?.[key];
  return typeof v === 'string' ? v : undefined;
}

/** Depth-first collect every node in the rendered JSON tree. */
function flatten(node: unknown, out: TestNode[] = []): TestNode[] {
  if (!isTestNode(node)) return out;
  out.push(node);
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const k of kids) flatten(k, out);
  return out;
}

async function renderTree(reduceMotion: boolean): Promise<TestNode[]> {
  const r = await render(
    <RevolutGlowChart data={DATA} tone="warm" reduceMotion={reduceMotion} />,
  );
  const json = r.toJSON();
  const roots = Array.isArray(json) ? json : [json];
  const nodes: TestNode[] = [];
  for (const root of roots) flatten(root, nodes);
  return nodes;
}

describe('RevolutGlowChart', () => {
  it('renders no gradient or filled area', async () => {
    const nodes = await renderTree(true);
    // RN-SVG maps the SVG `id` prop to the native `name` prop on the gradient,
    // and a fill that references it carries `brushRef="chartFill"`. Neither
    // the gradient nor a filled area may remain.
    const gradient = nodes.find(
      (n) =>
        n.props?.id === 'chartFill' || n.props?.name === 'chartFill',
    );
    expect(gradient).toBeUndefined();
    // RN-SVG resolves the `fill="url(#chartFill)"` reference to a brush object
    // `{ type, brushRef: 'chartFill' }` on the area path; web/string form is
    // also accepted so the assertion is renderer-agnostic.
    const filledArea = nodes.find((n) => {
      const fill = n.props?.fill;
      return (
        fill === 'url(#chartFill)' ||
        (typeof fill === 'object' &&
          fill !== null &&
          (fill as { brushRef?: unknown }).brushRef === 'chartFill')
      );
    });
    expect(filledArea).toBeUndefined();
  });

  it('renders a smooth bezier line path (d starts with M, contains a C)', async () => {
    const nodes = await renderTree(true);
    // Among Path-like nodes, find the line: a `d` with a cubic command.
    const beziers = nodes.filter((n) => {
      const d = stringProp(n, 'd');
      return d !== undefined && d.startsWith('M') && d.includes('C');
    });
    expect(beziers.length).toBeGreaterThan(0);
    // No legacy <Polyline> points-based line remains.
    const polylines = nodes.filter((n) => n.props != null && 'points' in n.props);
    expect(polylines.length).toBe(0);
  });

  it('renders the chart fully under reduce-motion (data never hidden)', async () => {
    const nodes = await renderTree(false);
    const reduced = await renderTree(true);
    const hasLine = (ns: TestNode[]) =>
      ns.some((n) => {
        const d = stringProp(n, 'd');
        return d !== undefined && d.includes('C');
      });
    // The smooth line is present whether or not motion is reduced.
    expect(hasLine(nodes)).toBe(true);
    expect(hasLine(reduced)).toBe(true);
  });

  it.each([
    ['line', false], ['line', true], ['bar', false], ['bar', true],
  ] as const)('%s, reduced=%s: clean marks and scrub/release kept', async (variant, reduceMotion) => {
    const onSelect = jest.fn();
    const node = await render(
      <RevolutGlowChart data={DATA} tone="warm" variant={variant} reduceMotion={reduceMotion} onSelect={onSelect} />,
    );
    const paths = node.queryAllByTestId('Path');
    // Gold flare on the latest mark at rest, on the scrubbed mark while held.
    const expectFlare = (index: number | null) => {
      if (variant === 'line') {
        const mark = node.queryByTestId('chart-latest-mark');
        if (index === null) expect(mark).toBeNull();
        else expect(StyleSheet.flatten(mark?.props.style)).toMatchObject({ backgroundColor: FLARE, left: '100%' });
        return;
      }
      node.getAllByTestId('Rect').forEach((bar, i) =>
        expect(bar.props.fill).toBe(i === (index ?? DATA.length - 1) ? FLARE : colors.forest));
    };
    if (variant === 'line') {
      expect(paths).toHaveLength(1);
      expect(paths[0].props.fill).toBe('none');
      expect(paths[0].props.stroke).toBe(colors.forest);
    } else {
      expect(paths).toHaveLength(0);
      const bars = node.getAllByTestId('Rect');
      expect(bars).toHaveLength(DATA.length);
      bars.forEach((bar) => {
        expect(bar.props.height).toBeGreaterThan(0);
        expect(bar.props.y + bar.props.height).toBeCloseTo(node.getByTestId('Line').props.y1);
      });
    }
    expectFlare(DATA.length - 1);
    await fireEvent(node.getByLabelText('Interactive trend chart'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 120, x: 0, y: 0 } },
    });
    await act(() => {
      mockPan.begin?.({ x: 8 });
      mockPan.update?.({ x: 9 });
    });
    expectFlare(variant === 'bar' ? 0 : null);
    await act(() => {
      mockPan.update?.({ x: 292 });
      mockPan.finalize?.();
    });
    expect(onSelect.mock.calls).toEqual([[0], [DATA.length - 1], [null]]);
    expectFlare(DATA.length - 1);
    await node.unmount();
  });

  it.each(['line', 'bar'] as const)('%s: empty and single-day marks stay valid', async (variant) => {
    const node = await render(<RevolutGlowChart data={[]} tone="cool" variant={variant} reduceMotion />);
    expect(node.queryAllByTestId('Path')).toHaveLength(0);
    expect(node.queryAllByTestId('Rect')).toHaveLength(0);
    await node.rerender(<RevolutGlowChart data={DATA.slice(0, 1)} tone="cool" variant={variant} reduceMotion />);
    expect(node.queryAllByTestId(variant === 'bar' ? 'Rect' : 'chart-latest-mark')).toHaveLength(1);
  });
});
