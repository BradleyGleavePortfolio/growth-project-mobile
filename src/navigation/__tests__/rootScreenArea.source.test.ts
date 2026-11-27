/**
 * OFFLINE-BAND-ROOT-M (T2): where RootNavigator puts the screen area, read as source (as reachabilityGates.test.ts
 * reads ClientNavigator.tsx). The area wraps every navigator the auth switch mounts and nothing that draws from the
 * window's top: the offline band (inside the area it would read the area's 0 and its words would fall back under the
 * top strip), the cache gate's restoring view and the push slip stay outside on the window's inset. The area is always
 * mounted: no key, and no ternary or && on the network (or anything else) around it, so a navigator never remounts
 * when the signal comes and goes.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'RootNavigator.tsx'), 'utf8');
const count = (re: RegExp) => (src.match(re) ?? []).length;
const open = src.indexOf('<ScreenArea>');
const close = src.indexOf('</ScreenArea>');
const gateTag = /<PersistedQueryCacheGate\b[\s\S]*?\n\s*>\n/.exec(src);
const gateTagEnd = gateTag ? gateTag.index + gateTag[0].length : -1;
const inside = (i: number) => i > open && i < close;
const all = (needle: string) => {
  const at: number[] = [];
  for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) at.push(i);
  return at;
};

describe('RootNavigator: one screen area around the auth switch', () => {
  it('has exactly one <ScreenArea>, with no props (no key), imported from its own module, not the ui barrel', () => {
    expect(count(/<ScreenArea\b/g)).toBe(1);
    expect(count(/<\/ScreenArea>/g)).toBe(1);
    expect(open).toBeGreaterThan(0);
    expect(src).toMatch(/^import \{ ScreenArea \} from '\.\.\/ui\/layout\/ScreenArea';$/m);
  });

  it('opens as the cache gate first child and closes right before the push slip', () => {
    expect(gateTagEnd).toBeGreaterThan(0);
    // Nothing but white space and a comment between the gate's opening tag and the area: no {condition && ...} or
    // ternary around it.
    const bare = (text: string) => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim();
    expect(bare(src.slice(gateTagEnd, open))).toBe('');
    const slipComment = src.indexOf('{/* FOREGROUND-BANNER-M');
    expect(slipComment).toBeGreaterThan(close);
    expect(bare(src.slice(close + '</ScreenArea>'.length, slipComment))).toBe('');
    // The switch closes right before the area does.
    expect(src.slice(src.lastIndexOf(')}', close), close).trim()).toBe(')}');
  });

  it('every navigator the auth switch mounts lies inside the area', () => {
    for (const name of [
      '<AuthNavigator',
      '<ConsultationOnboardingNavigator',
      '<AgeCheckNavigator',
      '<CoachWizardNavigator',
      '<CoachNavigator',
      '<ClientNavigator',
      '<EntitlementProvider',
      '<DunningLockoutProvider',
      '<PackageSelectionSheet',
    ]) {
      const at = all(name);
      expect({ name, found: at.length > 0 }).toEqual({ name, found: true });
      for (const i of at) expect({ name, inside: inside(i) }).toEqual({ name, inside: true });
    }
  });

  it('the band, the restoring view and the push slip stay outside, on the window inset', () => {
    for (const name of ['<OfflineBanner />', 'renderRestoring=', '<ForegroundNotificationBanner />']) {
      const at = all(name);
      expect({ name, found: at.length > 0 }).toEqual({ name, found: true });
      for (const i of at) expect({ name, inside: inside(i) }).toEqual({ name, inside: false });
    }
  });
});
