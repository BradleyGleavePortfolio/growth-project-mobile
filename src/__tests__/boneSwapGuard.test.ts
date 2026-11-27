/**
 * Page colour guard (owner ruling #203-E86, which replaces #203-E84, #203-E83 and #166-2).
 *
 * The owner chose the page colour: Sunlit sand, #F7EED9 ("a lighter tan, rich, less peachy more sand beach tone"),
 * swapped in everywhere at once. The token keeps its name, bone.
 * This guard fails if an earlier page colour comes back: the near-white
 * of #166-2, the old tan of #203-E83 or the earlier cream of #203-E84, anywhere under src/, docs/, the root
 * App test files or app.json, in any form:
 *   - hex, any case, with or without '#', 6-digit or 8-digit (alpha suffix)
 *   - rgb(r, g, b) / rgba(r, g, b, a), comma or space separated
 * Five files under docs/ held the old tan on main before this swap, as
 * records of what earlier renders measured (one of them as a text colour,
 * not the page). They are named below and keep it; nothing else may. The
 * earlier cream has no such record: it is banned everywhere.
 * The guard also pins every place that paints the page, the status-bar band,
 * the tab bar, text on forest fills, the splash and the Android icon fill to
 * Sunlit sand, so the page tokens can never drift apart, and it holds the
 * theme's body text colours to WCAG AA on it.
 *
 * The banned values are assembled at runtime so this file never contains them.
 */

import * as fs from 'fs';
import * as path from 'path';

import { Colors } from '../constants/colors';
import { colors as tokenColors, gold, lightTokens, semantic } from '../theme/tokens';
import { STATUS_BAR_BONE } from '../components/StatusBarBand';

const BONE = '#F7EED9';
// [name, hex, rgb] for each earlier page colour.
const BANNED: ReadonlyArray<readonly [string, string, readonly number[]]> = [
  ['near-white', ['f7', 'fa', 'f7'].join(''), [247, 250, 247]],
  ['old tan', ['f5', 'ef', 'e4'].join(''), [245, 239, 228]],
  ['earlier cream', ['f9', 'f4', 'ec'].join(''), [249, 244, 236]],
];
const OLD_TAN = BANNED[1][0];

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const APP_JSON = path.join(REPO_ROOT, 'app.json');
const SCAN_DIRS = ['src', 'docs', '__snapshots__'].map((dir) => path.join(REPO_ROOT, dir));
const SCAN_FILES = ['app.json', 'App.tsx', 'App.test.tsx', 'README.md'].map((file) => path.join(REPO_ROOT, file));

// Records on main before this swap (measurements of earlier renders); they keep the old tan as written.
const OLD_TAN_RECORDS = new Set([
  'docs/EXPO_56_LOCAL_VERIFICATION.md',
  'docs/ui-evidence/C3B-S2/measurements.jsonl',
  'docs/ui-evidence/C3B-THREAD/measurements.jsonl',
  'docs/ui-evidence/C4LOCKM/README.md',
  'docs/ui-evidence/K1-OVERVIEW/measurements.json',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.snap',
  '.css', '.html', '.svg', '.txt', '.yml', '.yaml',
]);

// Hex: not preceded or followed by another hex digit, optional 2-digit alpha.
// rgb()/rgba(): comma- or space-separated, optional alpha (comma or slash).
const SEP = '\\s*[,\\s]\\s*';
const PATTERNS = BANNED.map(([name, hex, rgb]) => ({
  name,
  hex: new RegExp(`(^|[^0-9a-f])${hex}([0-9a-f]{2})?(?![0-9a-f])`, 'i'),
  rgb: new RegExp(`rgba?\\(\\s*${rgb.join(SEP)}\\s*([,/]\\s*[\\d.]+%?\\s*)?\\)`, 'i'),
}));

function findBanned(text: string, skip: readonly string[] = []): string[] {
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const pattern of PATTERNS) {
      if (skip.includes(pattern.name)) continue;
      if (pattern.hex.test(line) || pattern.rgb.test(line)) hits.push(`line ${index + 1} (${pattern.name})`);
    }
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

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('page colour guard (#203-E86)', () => {
  it.each(BANNED)('the matcher catches every form of the banned %s', (name, hex, rgb) => {
    const upper = hex.toUpperCase();
    const samples = [
      `'#${upper}'`,
      `"#${hex}"`,
      `'#${upper}CC'`,
      `0x${upper}`,
      `rgb(${rgb.join(', ')})`,
      `rgb(${rgb.join(',')})`,
      `rgb(${rgb.join(' ')})`,
      `rgba(${rgb.join(', ')}, 0.5)`,
      `RGBA(${rgb.join(',')},1)`,
      `rgb(${rgb.join(' ')} / 50%)`,
    ];
    for (const sample of samples) {
      expect(findBanned(sample)).toEqual([`line 1 (${name})`]);
    }
    // Neighbouring values must not trip it.
    expect(findBanned(`'#${hex}1'`)).toEqual([]);
    expect(findBanned(`'#A${hex}'`)).toEqual([]);
    expect(findBanned(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2] + 1})`)).toEqual([]);
    expect(findBanned(`'${BONE}'`)).toEqual([]);
  });

  it('no file under src/, docs/ or the root App files uses an earlier page colour', () => {
    const files = SCAN_DIRS.reduce<string[]>((all, dir) => walk(dir, all), []);
    for (const file of SCAN_FILES) {
      if (file !== APP_JSON && fs.existsSync(file)) files.push(file);
    }
    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      const hits = findBanned(fs.readFileSync(file, 'utf8'), OLD_TAN_RECORDS.has(relative) ? [OLD_TAN] : []);
      if (hits.length > 0) {
        offenders.push(`${relative} (${hits.join(', ')})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every named record of the old tan still exists', () => {
    for (const relative of OLD_TAN_RECORDS) {
      expect(fs.existsSync(path.join(REPO_ROOT, relative))).toBe(true);
    }
  });

  it('app.json does not use an earlier page colour', () => {
    expect(findBanned(fs.readFileSync(APP_JSON, 'utf8'))).toEqual([]);
  });

  it('splash and Android icon fill are Sunlit sand', () => {
    const expo = JSON.parse(fs.readFileSync(APP_JSON, 'utf8')).expo;
    expect(expo.android.adaptiveIcon.backgroundColor).toBe(BONE);
    const splash = (expo.plugins as unknown[]).find(
      (plugin): plugin is [string, { backgroundColor?: string }] =>
        Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );
    expect(splash).toBeDefined();
    expect(splash?.[1].backgroundColor).toBe(BONE);
  });

  it.each([
    ['Colors.background', () => Colors.background],
    ['Colors.tabBackground', () => Colors.tabBackground],
    ['Colors.textOnPrimary', () => Colors.textOnPrimary],
    ['colors.bone', () => tokenColors.bone],
    ['lightTokens.bgPrimary', () => lightTokens.bgPrimary],
    ['STATUS_BAR_BONE', () => STATUS_BAR_BONE],
  ])('%s is Sunlit sand', (_name, read) => {
    expect(read()).toBe(BONE);
  });

  // WCAG AA body text (4.5:1) on Sunlit sand, for the theme's own text colours. Each floor is the measured ratio, cut
  // to two places (main's near-white page gave 16.58, 10.36, 9.33, 13.28, 16.58, 5.35, 9.33).
  it.each([
    ['ink', () => tokenColors.ink, 15.09],
    ['charcoal', () => tokenColors.charcoal, 9.43],
    ['forest', () => tokenColors.forest, 8.49],
    ['graphite', () => tokenColors.graphite, 12.09],
    ['textPrimary', () => lightTokens.textPrimary, 15.09],
    ['textMuted', () => lightTokens.textMuted, 4.87],
    ['accentText', () => lightTokens.accentText, 8.49],
    // Warning words drawn on the page (a connection row's "needs attention"): 4.78 on main's page, 4.36 on sand
    // at the old value, so both text tokens are the darker gold (undo "warning gold 700").
    ['semantic.warning.fg', () => semantic.warning.fg, 6.59],
    ['Colors.noticeWarningText', () => Colors.noticeWarningText, 6.59],
  ])('%s reads on Sunlit sand', (_name, read, floor) => {
    const ratio = contrast(read(), BONE);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeGreaterThanOrEqual(floor);
  });

  // warningInk is not body text on the page: its readers are icons on the warning ground and three edges, and the
  // safety alert's in-app banner reads it for its edge and mark (ForegroundNotificationBanner), so its value is not
  // this swap's to change. Round 2 held it to 4.5:1 on the page (4.59 on the earlier cream); on Sunlit sand it is
  // 4.36, held here at the 3:1 floor for marks and at its value.
  it('warningInk keeps its value and reads as a mark on Sunlit sand', () => {
    expect(tokenColors.warningInk).toBe(gold[700]);
    const ratio = contrast(tokenColors.warningInk, BONE);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeGreaterThanOrEqual(4.35);
  });
});
