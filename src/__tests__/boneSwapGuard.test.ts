/**
 * Bone guard (owner ruling #203-E83, which undoes #166-2).
 *
 * #166-2 moved the app background from the warm bone to a near-white value
 * "everywhere" in one atomic swap. The owner has now ordered the same swap in
 * reverse: "we atomic swap to the old tan we used to have". The page is bone
 * #F5EFE4 again. This guard fails if the near-white value comes back anywhere
 * under src/, docs/, the root App test files or app.json, in any form:
 *   - hex, any case, with or without '#', 6-digit or 8-digit (alpha suffix)
 *   - rgb(r, g, b) / rgba(r, g, b, a), comma or space separated
 * It also pins every place that paints the page, the status-bar band, the
 * tab bar, text on forest fills, the splash and the Android icon fill to
 * bone, so the page tokens can never drift apart, and it holds the theme's
 * body text colours to WCAG AA on bone.
 *
 * The banned value is assembled at runtime so this file never contains it.
 */

import * as fs from 'fs';
import * as path from 'path';

import { Colors } from '../constants/colors';
import { colors as tokenColors, lightTokens } from '../theme/tokens';
import { STATUS_BAR_BONE } from '../components/StatusBarBand';

const BONE = '#F5EFE4';
const BANNED_HEX = ['f7', 'fa', 'f7'].join('');
const BANNED_RGB = [247, 250, 247];

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const APP_JSON = path.join(REPO_ROOT, 'app.json');
const SCAN_DIRS = ['src', 'docs', '__snapshots__'].map((dir) => path.join(REPO_ROOT, dir));
const SCAN_FILES = ['app.json', 'App.tsx', 'App.test.tsx', 'README.md'].map((file) => path.join(REPO_ROOT, file));

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.snap',
  '.css', '.html', '.svg', '.txt', '.yml', '.yaml',
]);

// Hex: not preceded or followed by another hex digit, optional 2-digit alpha.
const HEX_PATTERN = new RegExp(`(^|[^0-9a-f])${BANNED_HEX}([0-9a-f]{2})?(?![0-9a-f])`, 'i');
// rgb()/rgba(), comma- or space-separated, optional alpha (comma or slash).
const SEP = '\\s*[,\\s]\\s*';
const RGB_PATTERN = new RegExp(
  `rgba?\\(\\s*${BANNED_RGB.join(SEP)}\\s*([,/]\\s*[\\d.]+%?\\s*)?\\)`,
  'i',
);

function findBanned(text: string): string[] {
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

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('bone guard (#203-E83)', () => {
  it('the matcher catches every form of the banned near-white', () => {
    const upper = BANNED_HEX.toUpperCase();
    const samples = [
      `'#${upper}'`,
      `"#${BANNED_HEX}"`,
      `'#${upper}CC'`,
      `0x${upper}`,
      `rgb(${BANNED_RGB.join(', ')})`,
      `rgb(${BANNED_RGB.join(',')})`,
      `rgb(${BANNED_RGB.join(' ')})`,
      `rgba(${BANNED_RGB.join(', ')}, 0.5)`,
      `RGBA(${BANNED_RGB.join(',')},1)`,
      `rgb(${BANNED_RGB.join(' ')} / 50%)`,
    ];
    for (const sample of samples) {
      expect(findBanned(sample)).toEqual(['line 1']);
    }
    // Neighbouring values must not trip it.
    expect(findBanned(`'#${BANNED_HEX}1'`)).toEqual([]);
    expect(findBanned(`'#A${BANNED_HEX}'`)).toEqual([]);
    expect(findBanned(`rgb(247, 250, 248)`)).toEqual([]);
    expect(findBanned(`'${BONE}'`)).toEqual([]);
  });

  it('no file under src/, docs/ or the root App files uses the banned near-white', () => {
    const files = SCAN_DIRS.reduce<string[]>((all, dir) => walk(dir, all), []);
    for (const file of SCAN_FILES) {
      if (file !== APP_JSON && fs.existsSync(file)) files.push(file);
    }
    const offenders: string[] = [];
    for (const file of files) {
      const hits = findBanned(fs.readFileSync(file, 'utf8'));
      if (hits.length > 0) {
        offenders.push(`${path.relative(REPO_ROOT, file)} (${hits.join(', ')})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('app.json does not use the banned near-white', () => {
    expect(findBanned(fs.readFileSync(APP_JSON, 'utf8'))).toEqual([]);
  });

  it('splash and Android icon fill are bone', () => {
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
  ])('%s is bone', (_name, read) => {
    expect(read()).toBe(BONE);
  });

  // WCAG AA body text (4.5:1) on bone, for the theme's own text colours.
  it.each([
    ['ink', () => tokenColors.ink, 15.2],
    ['charcoal', () => tokenColors.charcoal, 9.5],
    ['forest', () => tokenColors.forest, 8.5],
    ['graphite', () => tokenColors.graphite, 12.2],
    ['textPrimary', () => lightTokens.textPrimary, 15.2],
    ['textMuted', () => lightTokens.textMuted, 4.9],
    ['accentText', () => lightTokens.accentText, 8.5],
  ])('%s reads on bone', (_name, read, floor) => {
    const ratio = contrast(read(), BONE);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeGreaterThanOrEqual(floor);
  });
});
