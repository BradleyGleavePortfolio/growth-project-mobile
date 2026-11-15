/**
 * Tan swap guard (owner #203-E74, #203-E76).
 *
 * The owner moved the app's page colour from the near-white of #166-2 (the one
 * he calls "toothpaste") to tan, everywhere, in one atomic swap. This guard
 * fails if the earlier page value comes back anywhere under src/, docs/ or the
 * root App files, in any form:
 *   - hex, any case, with or without '#', 6-digit or 8-digit (alpha suffix)
 *   - rgb(r, g, b) / rgba(r, g, b, a), comma or space separated
 * It pins every token that paints the page, the status-bar band and the tab
 * bar to the tan, and holds the rules the darker ground needs:
 *   - light text on a dark fill is textOnAccent, never the page colour;
 *   - every text token drawn on the page clears WCAG AA (4.5:1) on the tan,
 *     every chart mark 3:1, and the hairline shows on the page and on a card.
 *
 * The earlier value is assembled at runtime so this file never contains it.
 * app.json (splash, Android icon fill) is native config: it changes with a
 * store build, not here, and boneSwapGuard.test.ts pins what it holds.
 */

import * as fs from 'fs';
import * as path from 'path';

import { Colors } from '../constants/colors';
import { Colors as LegacyColors, colors as legacyGroups } from '../theme';
import { colors as tokenColors, lightTokens } from '../theme/tokens';
import { STATUS_BAR_BONE } from '../components/StatusBarBand';

const TAN = '#E6C6A0';
const OLD_HEX = ['f7', 'fa', 'f7'].join('');
const OLD_RGB = [247, 250, 247];

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['src', 'docs', '__snapshots__'].map((d) => path.join(REPO_ROOT, d));
const SCAN_FILES = ['App.tsx', 'App.test.tsx', 'App.analytics.test.tsx'].map((f) => path.join(REPO_ROOT, f));

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.snap',
  '.css', '.html', '.svg', '.txt', '.yml', '.yaml',
]);

// Hex: not preceded or followed by another hex digit, optional 2-digit alpha.
const HEX_PATTERN = new RegExp(`(^|[^0-9a-f])${OLD_HEX}([0-9a-f]{2})?(?![0-9a-f])`, 'i');
// rgb()/rgba(), comma- or space-separated, optional alpha (comma or slash).
const SEP = '\\s*[,\\s]\\s*';
const RGB_PATTERN = new RegExp(
  `rgba?\\(\\s*${OLD_RGB.join(SEP)}\\s*([,/]\\s*[\\d.]+%?\\s*)?\\)`,
  'i',
);

function findOldPage(text: string): string[] {
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (HEX_PATTERN.test(line) || RGB_PATTERN.test(line)) hits.push(`line ${index + 1}`);
  });
  return hits;
}

function walk(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

const isTestFile = (file: string): boolean =>
  /[\\/]__tests__[\\/]|[\\/]__snapshots__[\\/]|\.test\.[jt]sx?$/.test(file);

// The page colour used as a text, icon or spinner colour. `bone` and
// `bgPrimary` are grounds; light text on a dark fill is `textOnAccent`.
const PAGE_AS_TEXT = new RegExp(
  '(?:^|[\\s{(,])(?:color|tintColor|headerTintColor)\\s*[:=]\\s*\\{?\\s*' +
    '(?:[\\w.]+\\s*\\?\\s*)?[\\w.]*\\b(?:bone|bgPrimary|tabBackground|STATUS_BAR_BONE)\\b',
);
const LEGACY_PAGE_AS_TEXT = /(?:^|[\s{(,])(?:color|tintColor|headerTintColor)\s*[:=]\s*\{?\s*Colors\.background\b/;

function pageAsText(line: string): boolean {
  return PAGE_AS_TEXT.test(line) || LEGACY_PAGE_AS_TEXT.test(line);
}

// ─── WCAG 2.1 relative-luminance contrast ──────────────────────────────────
function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function relLuminance(hex: string): number {
  const h = hex.replace('#', '');
  return (
    0.2126 * channelLinear(parseInt(h.slice(0, 2), 16)) +
    0.7152 * channelLinear(parseInt(h.slice(2, 4), 16)) +
    0.0722 * channelLinear(parseInt(h.slice(4, 6), 16))
  );
}
function contrastRatio(a: string, b: string): number {
  const l1 = relLuminance(a);
  const l2 = relLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('tan swap guard (#203-E74, #203-E76)', () => {
  it('the matcher catches every form of the earlier page value', () => {
    const upper = OLD_HEX.toUpperCase();
    const samples = [
      `'#${upper}'`,
      `"#${OLD_HEX}"`,
      `'#${upper}CC'`,
      `0x${upper}`,
      `rgb(${OLD_RGB.join(', ')})`,
      `rgb(${OLD_RGB.join(',')})`,
      `rgb(${OLD_RGB.join(' ')})`,
      `rgba(${OLD_RGB.join(', ')}, 0.5)`,
      `RGBA(${OLD_RGB.join(',')},1)`,
      `rgb(${OLD_RGB.join(' ')} / 50%)`,
    ];
    for (const sample of samples) {
      expect(findOldPage(sample)).toEqual(['line 1']);
    }
    // Neighbouring values must not trip it.
    expect(findOldPage(`'#${OLD_HEX}1'`)).toEqual([]);
    expect(findOldPage(`'#A${OLD_HEX}'`)).toEqual([]);
    expect(findOldPage('rgb(247, 250, 248)')).toEqual([]);
    expect(findOldPage(`'${TAN}'`)).toEqual([]);
  });

  it('no file under src/, docs/ or the root App files uses the earlier page value', () => {
    const offenders: string[] = [];
    const files = SCAN_DIRS.reduce<string[]>((all, dir) => walk(dir, all), []).concat(
      SCAN_FILES.filter((file) => fs.existsSync(file)),
    );
    for (const file of files) {
      const hits = findOldPage(fs.readFileSync(file, 'utf8'));
      if (hits.length > 0) {
        offenders.push(`${path.relative(REPO_ROOT, file)} (${hits.join(', ')})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every page token holds the tan', () => {
    expect(Colors.background).toBe(TAN);
    expect(Colors.tabBackground).toBe(TAN);
    expect(tokenColors.bone).toBe(TAN);
    expect(lightTokens.bgPrimary).toBe(TAN);
    expect(STATUS_BAR_BONE).toBe(TAN);
    expect(LegacyColors.background).toBe(TAN);
    expect(legacyGroups.background.primary).toBe(TAN);
  });

  it('light text on a dark fill is textOnAccent, never the page colour', () => {
    expect(Colors.textOnPrimary).toBe(lightTokens.textOnAccent);
    expect(LegacyColors.textOnPrimary).toBe(lightTokens.textOnAccent);
    expect(LegacyColors.white).toBe(lightTokens.textOnAccent);
    // The tan as text reaches AA on forest only; on the alarm red it does not.
    expect(contrastRatio(lightTokens.textOnAccent, lightTokens.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightTokens.textOnAccent, tokenColors.error)).toBeGreaterThanOrEqual(4.5);
  });

  it('the page-as-text matcher catches each form', () => {
    for (const line of [
      '    color: colors.bone,',
      '  btnText: { ...typography.bodySmall, color: colors.bone },',
      '          <ActivityIndicator color={colors.bgPrimary} />',
      '<Ionicons name="close" size={24} color={colors.bone} />',
      "      headerTintColor: caughtUp ? colors.bone : colors.ink,",
      '            tintColor={colors.bone}',
      '        <Text style={[styles.caption, { color: sc.bgPrimary }]}>Suggested</Text>',
      '  label: { color: Colors.background },',
    ]) {
      expect([line, pageAsText(line)]).toEqual([line, true]);
    }
    for (const line of [
      '    backgroundColor: colors.bone,',
      '    borderColor: colors.bone,',
      '  title: { color: colors.textOnAccent },',
      '  const colors = { bone: sc.bgPrimary, ink: sc.textPrimary };',
      '        tabBarInactiveTintColor: sc.textMuted,',
    ]) {
      expect([line, pageAsText(line)]).toEqual([line, false]);
    }
  });

  it('no component draws text, an icon or a spinner in the page colour', () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(REPO_ROOT, 'src'), [])) {
      if (isTestFile(file) || !/\.[jt]sx?$/.test(file)) continue;
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
        if (pageAsText(line)) offenders.push(`${path.relative(REPO_ROOT, file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  const TEXT = 4.5;
  const MARK = 3;
  const onPage: Array<[string, string, number]> = [
    ['textPrimary', lightTokens.textPrimary, TEXT],
    ['textMuted (captions, inactive tabs)', lightTokens.textMuted, TEXT],
    ['accentText (links, outline labels)', lightTokens.accentText, TEXT],
    ['charcoal', tokenColors.charcoal, TEXT],
    ['graphite', tokenColors.graphite, TEXT],
    ['legacy textPrimary', Colors.textPrimary, TEXT],
    ['legacy textSecondary', Colors.textSecondary, TEXT],
    ['legacy textMuted', Colors.textMuted, TEXT],
    ['legacy primary', Colors.primary, TEXT],
    ['error text', tokenColors.error, TEXT],
    ['legacy error text', Colors.error, TEXT],
    ['warning ink', tokenColors.warningInk, TEXT],
    ['legacy warning text', Colors.noticeWarningText, TEXT],
    ['data.missed (a number)', lightTokens.data.missed, TEXT],
    ['data.forest', lightTokens.data.forest, MARK],
    ['data.moss', lightTokens.data.moss, MARK],
    ['data.planned', lightTokens.data.planned, MARK],
    ['data.peakInk', lightTokens.data.peakInk, MARK],
    ['data.deep', lightTokens.data.deep, MARK],
  ];
  it.each(onPage)('%s clears its floor on the tan page', (_name, fg, floor) => {
    expect(contrastRatio(fg, lightTokens.bgPrimary)).toBeGreaterThanOrEqual(floor);
  });

  it('the hairline shows on the page and on a card as well as it did before the swap', () => {
    // The earlier hairline on the earlier page was 1.38:1.
    expect(contrastRatio(lightTokens.border, lightTokens.bgPrimary)).toBeGreaterThanOrEqual(1.35);
    expect(contrastRatio(lightTokens.border, lightTokens.bgSurface)).toBeGreaterThanOrEqual(1.35);
    expect(relLuminance(lightTokens.border)).toBeLessThan(relLuminance(lightTokens.bgPrimary));
  });

  it('a card still stands off the page', () => {
    expect(contrastRatio(lightTokens.bgSurface, lightTokens.bgPrimary)).toBeGreaterThanOrEqual(1.3);
    expect(contrastRatio(tokenColors.cream, lightTokens.bgPrimary)).toBeGreaterThanOrEqual(1.25);
  });
});
