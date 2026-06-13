/**
 * RevolutGlowChart — render contract for the VISCERAL PEAK (R1 visual P0 #1).
 *
 * Pins the Revolut treatment the visual audit required:
 *   • a `<LinearGradient id="chartFill">` soft area fill exists in the SVG,
 *   • the line is a smooth `<Path>` whose `d` starts with `M` and contains at
 *     least one cubic-bezier `C` command (NOT the prior tutorial `<Polyline>`),
 *   • the reduce-motion path renders the chart fully (data is never hidden
 *     behind an animation — #50 graceful degradation).
 *
 * We walk the rendered element tree (react-test-renderer JSON) and inspect SVG
 * element types + props directly, which is robust to RN-SVG's internals.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { RevolutGlowChart, type GlowChartPoint } from '../RevolutGlowChart';

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
  it('renders a chartFill linear gradient (the Revolut area treatment)', async () => {
    const nodes = await renderTree(true);
    // RN-SVG maps the SVG `id` prop to the native `name` prop on the gradient,
    // and a fill that references it carries `brushRef="chartFill"`. Assert the
    // gradient exists AND is wired to a filled area path.
    const gradient = nodes.find(
      (n) =>
        n.props?.id === 'chartFill' || n.props?.name === 'chartFill',
    );
    expect(gradient).toBeTruthy();
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
    expect(filledArea).toBeTruthy();
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
});
