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

/** Depth-first collect every node in the rendered JSON tree. */
function flatten(node: unknown, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as any;
  out.push(n);
  const kids = Array.isArray(n.children) ? n.children : [];
  for (const k of kids) flatten(k, out);
  return out;
}

function renderTree(reduceMotion: boolean) {
  const r = render(
    <RevolutGlowChart data={DATA} tone="warm" reduceMotion={reduceMotion} />,
  );
  const json = r.toJSON();
  const roots = Array.isArray(json) ? json : [json];
  const nodes: any[] = [];
  for (const root of roots) flatten(root, nodes);
  return nodes;
}

describe('RevolutGlowChart', () => {
  it('renders a chartFill linear gradient (the Revolut area treatment)', () => {
    const nodes = renderTree(true);
    // RN-SVG maps the SVG `id` prop to the native `name` prop on the gradient,
    // and a fill that references it carries `brushRef="chartFill"`. Assert the
    // gradient exists AND is wired to a filled area path.
    const gradient = nodes.find(
      (n) =>
        n.props &&
        (n.props.id === 'chartFill' || n.props.name === 'chartFill'),
    );
    expect(gradient).toBeTruthy();
    // RN-SVG resolves the `fill="url(#chartFill)"` reference to a brush object
    // `{ type, brushRef: 'chartFill' }` on the area path; web/string form is
    // also accepted so the assertion is renderer-agnostic.
    const filledArea = nodes.find((n) => {
      const fill = n.props && n.props.fill;
      return (
        fill === 'url(#chartFill)' ||
        (fill && typeof fill === 'object' && fill.brushRef === 'chartFill')
      );
    });
    expect(filledArea).toBeTruthy();
  });

  it('renders a smooth bezier line path (d starts with M, contains a C)', () => {
    const nodes = renderTree(true);
    // Among Path-like nodes, find the line: a `d` with a cubic command.
    const beziers = nodes.filter(
      (n) =>
        n.props &&
        typeof n.props.d === 'string' &&
        n.props.d.startsWith('M') &&
        n.props.d.includes('C'),
    );
    expect(beziers.length).toBeGreaterThan(0);
    // No legacy <Polyline> points-based line remains.
    const polylines = nodes.filter((n) => n.props && 'points' in n.props);
    expect(polylines.length).toBe(0);
  });

  it('renders the chart fully under reduce-motion (data never hidden)', () => {
    const nodes = renderTree(false);
    const reduced = renderTree(true);
    const hasLine = (ns: any[]) =>
      ns.some(
        (n) =>
          n.props &&
          typeof n.props.d === 'string' &&
          n.props.d.includes('C'),
      );
    // The smooth line is present whether or not motion is reduced.
    expect(hasLine(nodes)).toBe(true);
    expect(hasLine(reduced)).toBe(true);
  });
});
