// Source-level guard for the four P0 chart-related fixes:
//   P0-2  removes the `try { useTheme() } catch {}` hooks-rule violation
//   P0-5  caps per-point <Circle> rendering so 90D/All views stay smooth
//   P0-6  surfaces an xFormatter prop so x-axis labels can render dates
// This file pins the regression-prone shape of TgpLineChart.tsx itself so
// any regression to the old patterns trips a CI failure long before it
// can ship.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'ui', 'charts', 'TgpLineChart.tsx'),
  'utf8',
);

describe('TgpLineChart — audit P0 regression guards', () => {
  it('does not wrap useTheme() in a try/catch (P0-2 hooks-rule violation)', () => {
    expect(SRC).not.toMatch(/try\s*\{[\s\S]{0,80}useTheme\(\)/);
    expect(SRC).not.toMatch(/eslint-disable-next-line react-hooks\/rules-of-hooks/);
  });

  it('still calls useTheme() unconditionally at the top of the component', () => {
    expect(SRC).toMatch(/const theme = useTheme\(\);/);
  });

  it('only renders per-point <Circle> markers when data.length <= 30 (P0-5)', () => {
    expect(SRC).toMatch(/data\.length\s*<=\s*30\s*&&[\s\S]+?<Circle/);
  });

  it('exposes an xFormatter prop on the component (P0-6)', () => {
    expect(SRC).toMatch(/xFormatter\?:\s*\(x:\s*number\)\s*=>\s*string/);
  });

  it('uses xFormatter for both the x-axis labels and the tooltip label', () => {
    // Must appear at least twice: once in the xLabels map, once in the tooltip.
    const matches = SRC.match(/xFormatter\s*\?/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Tgp* sibling charts — same try/catch + eslint-disable removal', () => {
  for (const name of ['TgpAreaChart', 'TgpBarChart', 'TgpSparkline']) {
    it(`${name}.tsx no longer wraps useTheme() in try/catch`, () => {
      const src = fs.readFileSync(
        path.join(ROOT, 'src', 'ui', 'charts', `${name}.tsx`),
        'utf8',
      );
      expect(src).not.toMatch(/try\s*\{[\s\S]{0,80}useTheme\(\)/);
      expect(src).not.toMatch(/eslint-disable-next-line react-hooks\/rules-of-hooks/);
      expect(src).toMatch(/const theme = useTheme\(\);/);
    });
  }
});
