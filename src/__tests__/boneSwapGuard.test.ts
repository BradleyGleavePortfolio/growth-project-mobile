/**
 * Bone swap guard (owner ruling #166-2).
 *
 * The owner moved the app background off the old warm bone "everywhere" in
 * one atomic swap. This guard fails if the old bone value comes back anywhere
 * under src/ or in app.json, in any form:
 *   - hex, any case, with or without '#', 6-digit or 8-digit (alpha suffix)
 *   - rgb(r, g, b) / rgba(r, g, b, a), comma or space separated
 *
 * The page has since moved again, to tan (owner #203-E74, #203-E76): the page
 * tokens are pinned by tanSwapGuard.test.ts. app.json is native config and
 * changes only with a store build, so the splash and the Android icon fill
 * still hold the #166-2 value; this file pins that until that build.
 *
 * Both earlier values are assembled at runtime so this file never contains them.
 */

import * as fs from 'fs';
import * as path from 'path';

// The #166-2 value app.json still holds (splash, Android icon fill).
const SPLASH_FILL = `#${['F7', 'FA', 'F7'].join('')}`;
const OLD_HEX = ['f5', 'ef', 'e4'].join('');
const OLD_RGB = [245, 239, 228];

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const APP_JSON = path.join(REPO_ROOT, 'app.json');

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

function findOldBone(text: string): string[] {
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (HEX_PATTERN.test(line) || RGB_PATTERN.test(line)) hits.push(`line ${index + 1}`);
  });
  return hits;
}

function walk(dir: string, out: string[]): string[] {
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

describe('bone swap guard (#166-2)', () => {
  it('the matcher catches every form of the old bone', () => {
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
      expect(findOldBone(sample)).toEqual(['line 1']);
    }
    // Neighbouring values must not trip it.
    expect(findOldBone(`'#${OLD_HEX}1'`)).toEqual([]);
    expect(findOldBone(`'#A${OLD_HEX}'`)).toEqual([]);
    expect(findOldBone(`rgb(245, 239, 229)`)).toEqual([]);
    expect(findOldBone(`'${SPLASH_FILL}'`)).toEqual([]);
  });

  it('no file under src/ uses the old bone', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT, [])) {
      const hits = findOldBone(fs.readFileSync(file, 'utf8'));
      if (hits.length > 0) {
        offenders.push(`${path.relative(REPO_ROOT, file)} (${hits.join(', ')})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('app.json does not use the old bone', () => {
    expect(findOldBone(fs.readFileSync(APP_JSON, 'utf8'))).toEqual([]);
  });

  it('splash and Android icon fill hold the #166-2 value until a store build', () => {
    const expo = JSON.parse(fs.readFileSync(APP_JSON, 'utf8')).expo;
    expect(expo.android.adaptiveIcon.backgroundColor).toBe(SPLASH_FILL);
    const splash = (expo.plugins as unknown[]).find(
      (plugin): plugin is [string, { backgroundColor?: string }] =>
        Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );
    expect(splash).toBeDefined();
    expect(splash?.[1].backgroundColor).toBe(SPLASH_FILL);
  });
});
