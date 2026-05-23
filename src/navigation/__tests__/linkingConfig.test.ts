// Cross-check the React Navigation linking config in RootNavigator against
// app.json's intent filters / associatedDomains. The two sources of truth must
// agree or deep links silently break: app.json declares "I will receive these
// URLs", RootNavigator declares "and here is how to route them once received".
//
// Pure JS / fs — no NavigationContainer mounted. Keeps the test fast and
// avoids dragging react-native-screens / reanimated into the test harness.

import * as fs from 'fs';
import * as path from 'path';
import {
  INVITE_CUSTOM_SCHEME,
  INVITE_UNIVERSAL_HOST,
  INVITE_PATH,
} from '../../utils/deepLink';
import { isValidPackageShareToken } from '../../utils/packageShare';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const APP_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const ROOT_NAV_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'RootNavigator.tsx'),
  'utf8',
);

describe('app.json declares the invite deep-link surface', () => {
  it('iOS associatedDomains lists applinks for the universal host', () => {
    const ad: string[] = APP_JSON.expo.ios.associatedDomains;
    expect(ad).toContain(`applinks:${INVITE_UNIVERSAL_HOST}`);
  });

  it('Android intent filter routes https://<host>/join with autoVerify', () => {
    const filters = APP_JSON.expo.android.intentFilters;
    const httpsFilter = filters.find((f: any) =>
      (f.data || []).some(
        (d: any) => d.scheme === 'https' && d.host === INVITE_UNIVERSAL_HOST,
      ),
    );
    expect(httpsFilter).toBeDefined();
    expect(httpsFilter.autoVerify).toBe(true);
    const httpsData = httpsFilter.data.find(
      (d: any) => d.scheme === 'https' && d.host === INVITE_UNIVERSAL_HOST,
    );
    expect(httpsData.pathPrefix).toBe(INVITE_PATH);
  });

  it('Android intent filter also routes the tgp:// custom scheme to /join', () => {
    const filters = APP_JSON.expo.android.intentFilters;
    const customFilter = filters.find((f: any) =>
      (f.data || []).some((d: any) => d.scheme === INVITE_CUSTOM_SCHEME),
    );
    expect(customFilter).toBeDefined();
    const data = customFilter.data.find((d: any) => d.scheme === INVITE_CUSTOM_SCHEME);
    expect(data.host).toBe('join');
  });

  it('expo.scheme declares both the legacy tgp scheme and the bundle-id scheme', () => {
    // expo.scheme may be a string (legacy single-scheme) or an array (multiple
    // schemes registered with the OS — required so Stripe's checkout return URL
    // `com.growthproject.app://...` deep-links back into the app while existing
    // `tgp://join/<code>` invite links keep working). Normalise then assert
    // both are present: the legacy scheme (matches INVITE_CUSTOM_SCHEME, used
    // by the deep-link parser) AND the bundle-id scheme (matches
    // expo.android.package / expo.ios.bundleIdentifier, used by Stripe).
    const schemes = Array.isArray(APP_JSON.expo.scheme)
      ? APP_JSON.expo.scheme
      : [APP_JSON.expo.scheme];
    expect(schemes).toContain(INVITE_CUSTOM_SCHEME);
    expect(schemes).toContain(APP_JSON.expo.android.package);
    expect(schemes).toContain(APP_JSON.expo.ios.bundleIdentifier);
  });
});

describe('RootNavigator linking config agrees with app.json', () => {
  it('declares both the custom-scheme prefix and the universal-link host', () => {
    expect(ROOT_NAV_SRC).toMatch(/'tgp:\/\/'/);
    expect(ROOT_NAV_SRC).toMatch(
      new RegExp(`'https:\\/\\/${INVITE_UNIVERSAL_HOST.replace(/\./g, '\\.')}'`),
    );
  });

  it('routes /join/:invite_code to CreateAccount', () => {
    // The linking config uses the path 'join/:invite_code?'. Search for the
    // literal so a typo (`/join/:code` etc.) shows up here instead of in QA.
    expect(ROOT_NAV_SRC).toMatch(/path:\s*'join\/:invite_code\?'/);
  });
});

describe('hosted association templates match app.json', () => {
  it('assetlinks.json package_name matches expo.android.package', () => {
    const al = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'docs', 'well-known', 'assetlinks.json'), 'utf8'),
    );
    const packages = al
      .map((s: any) => s && s.target && s.target.package_name)
      .filter(Boolean);
    expect(packages).toContain(APP_JSON.expo.android.package);
  });

  it('apple-app-site-association covers /join/* and bare /join', () => {
    const aasa = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'docs', 'well-known', 'apple-app-site-association'),
        'utf8',
      ),
    );
    const components = aasa.applinks.details.flatMap((d: any) => d.components || []);
    const paths = components.map((c: any) => c['/']);
    expect(paths).toEqual(expect.arrayContaining(['/join/*', '/join']));
  });
});

// Package share surface — every layer (app.json, RootNavigator, AASA) must
// declare /p/<shareToken> for the universal-link to land in the PackageCheckout
// screen. Regression coverage for the same drift class we already catch on
// /join above.
describe('app.json + RootNavigator + AASA declare the /p/<token> package surface', () => {
  it('Android intent filter routes https://<host>/p with autoVerify', () => {
    const filters = APP_JSON.expo.android.intentFilters;
    const hasHttpsP = filters.some((f: any) =>
      (f.data || []).some(
        (d: any) =>
          d.scheme === 'https' &&
          d.host === INVITE_UNIVERSAL_HOST &&
          d.pathPrefix === '/p',
      ),
    );
    expect(hasHttpsP).toBe(true);
  });

  it('Android intent filter also routes the tgp://p custom scheme', () => {
    const filters = APP_JSON.expo.android.intentFilters;
    const hasCustomP = filters.some((f: any) =>
      (f.data || []).some(
        (d: any) => d.scheme === INVITE_CUSTOM_SCHEME && d.host === 'p',
      ),
    );
    expect(hasCustomP).toBe(true);
  });

  it('RootNavigator linking config routes p/:shareToken', () => {
    expect(ROOT_NAV_SRC).toMatch(/path:\s*'p\/:shareToken'/);
  });

  it('apple-app-site-association covers /p/*', () => {
    const aasa = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'docs', 'well-known', 'apple-app-site-association'),
        'utf8',
      ),
    );
    const components = aasa.applinks.details.flatMap((d: any) => d.components || []);
    const paths = components.map((c: any) => c['/']);
    expect(paths).toEqual(expect.arrayContaining(['/p/*']));
  });
});

// Behavioral coverage for the share-token parser used by the linking
// config. Asserts that a real https://app.trygrowthproject.com/p/<token>
// link is parsed into a usable shareToken, and that malformed paths are
// rejected before they ever reach PackageCheckoutScreen.
describe('package share link parsing', () => {
  function tokenFromUniversalLink(url: string): string | null {
    // Mirrors what React Navigation's URL parser does for the
    // `p/:shareToken` segment in RootNavigator. We strip the prefix the
    // linking config recognises and treat the next path segment as the
    // raw value, then run the same validator the linking config wraps
    // `parse: { shareToken }` with.
    const prefixes = [
      'https://app.trygrowthproject.com/p/',
      'tgp://p/',
    ];
    let raw: string | null = null;
    for (const p of prefixes) {
      if (url.startsWith(p)) {
        raw = url.slice(p.length).split(/[?#/]/)[0];
        break;
      }
    }
    if (raw == null) return null;
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return null;
    }
    return isValidPackageShareToken(raw) ? raw : null;
  }

  it('extracts a valid token from a universal link', () => {
    expect(
      tokenFromUniversalLink(
        'https://app.trygrowthproject.com/p/abc-123_DEF',
      ),
    ).toBe('abc-123_DEF');
  });

  it('extracts a valid token from a custom-scheme link', () => {
    expect(tokenFromUniversalLink('tgp://p/uuid-token-9999')).toBe(
      'uuid-token-9999',
    );
  });

  it('rejects path-traversal and HTML-injection tokens', () => {
    expect(
      tokenFromUniversalLink(
        'https://app.trygrowthproject.com/p/' +
          encodeURIComponent('../etc/passwd'),
      ),
    ).toBeNull();
    expect(
      tokenFromUniversalLink(
        'https://app.trygrowthproject.com/p/' +
          encodeURIComponent('<script>alert(1)</script>'),
      ),
    ).toBeNull();
  });

  it('rejects oversized tokens', () => {
    const big = 'a'.repeat(200);
    expect(
      tokenFromUniversalLink(`https://app.trygrowthproject.com/p/${big}`),
    ).toBeNull();
  });

  it('rejects links from an unrelated host', () => {
    expect(tokenFromUniversalLink('https://evil.example.com/p/abc')).toBeNull();
  });
});
