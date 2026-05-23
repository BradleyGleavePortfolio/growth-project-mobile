// Cross-check the React Navigation linking config in RootNavigator against
// app.json's intent filters / associatedDomains. The two sources of truth
// must agree or deep links silently break: app.json declares "I will receive
// these URLs", RootNavigator declares "and here is how to route them once
// received".
//
// R26: All RootNavigator coverage in this file drives REAL URLs through
// `linking.getStateFromPath()` and asserts the resulting navigation state.
// No source-file regex matching.

import * as fs from 'fs';
import * as path from 'path';
import {
  INVITE_CUSTOM_SCHEME,
  INVITE_UNIVERSAL_HOST,
  INVITE_PATH,
} from '../../utils/deepLink';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const APP_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

// RootNavigator pulls in a tree of native/Expo dependencies it doesn't need
// for the linking config alone. Mock the components it renders so importing
// `linking` is cheap and side-effect-free.
jest.mock('../AuthNavigator', () => () => null);
jest.mock('../ClientNavigator', () => () => null);
jest.mock('../CoachNavigator', () => () => null);
jest.mock('../OnboardingNavigator', () => () => null);
jest.mock('../LeanOnboardingNavigator', () => () => null);
jest.mock('../../components/OfflineBanner', () => () => null);
jest.mock('../../screens/client/Day1WinScreen', () => () => null);
jest.mock('../../services/support/crisp.service', () => ({
  initCrisp: jest.fn(),
  syncCrispIdentity: jest.fn(),
}));
jest.mock('../../services/firstWinApi', () => ({
  firstWinApi: { getStatus: jest.fn(), markComplete: jest.fn() },
  WinType: {},
}));
jest.mock('../../services/authActions', () => ({ signOut: jest.fn() }));
jest.mock('../../hooks/useLeanOnboardingReconcile', () => ({
  useLeanOnboardingReconcile: () => {},
}));
jest.mock('../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../screenshots', () => ({ isScreenshotMode: () => false }));

import { linking } from '../RootNavigator';

function resolve(url: string) {
  // Strip the prefix the way React Navigation does before calling our
  // getStateFromPath. RN's deep-link receiver removes the scheme/host prefix
  // and feeds the path-and-beyond into the override.
  const prefixes = linking.prefixes;
  let stripped = url;
  for (const p of prefixes) {
    if (url.startsWith(p)) {
      stripped = url.slice(p.length);
      break;
    }
  }
  if (!stripped.startsWith('/')) stripped = '/' + stripped;
  return linking.getStateFromPath!(stripped, linking.config as never);
}

function findRoute(
  state: ReturnType<typeof resolve> | null | undefined,
  name: string,
): { name: string; params?: Record<string, unknown> } | undefined {
  if (!state) return undefined;
  for (const route of state.routes ?? []) {
    if (route.name === name) return route as never;
    const child = (route as { state?: typeof state }).state;
    if (child) {
      const nested = findRoute(child, name);
      if (nested) return nested;
    }
  }
  return undefined;
}

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

describe('app.json declares the /p/<token> package surface', () => {
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
});

describe('RootNavigator linking config — behavioral routing (R26)', () => {
  it('declares both the custom-scheme prefix and the universal-link host', () => {
    expect(linking.prefixes).toEqual(
      expect.arrayContaining(['tgp://', `https://${INVITE_UNIVERSAL_HOST}`]),
    );
  });

  it('routes /join/<code> to CreateAccount with invite_code param', () => {
    const state = resolve(`https://${INVITE_UNIVERSAL_HOST}/join/ABC123`);
    const route = findRoute(state, 'CreateAccount');
    expect(route).toBeDefined();
    expect(route?.params).toMatchObject({ invite_code: 'ABC123' });
  });

  it('routes tgp://join/<code> to CreateAccount with invite_code param', () => {
    const state = resolve('tgp://join/XYZ789');
    const route = findRoute(state, 'CreateAccount');
    expect(route).toBeDefined();
    expect(route?.params).toMatchObject({ invite_code: 'XYZ789' });
  });

  it('routes /p/<token> to PackageCheckout with shareToken param', () => {
    const state = resolve(`https://${INVITE_UNIVERSAL_HOST}/p/abc-123_DEF`);
    const route = findRoute(state, 'PackageCheckout');
    expect(route).toBeDefined();
    expect(route?.params).toMatchObject({ shareToken: 'abc-123_DEF' });
  });

  it('routes tgp://p/<token> to PackageCheckout with shareToken param', () => {
    const state = resolve('tgp://p/uuid-token-9999');
    const route = findRoute(state, 'PackageCheckout');
    expect(route).toBeDefined();
    expect(route?.params).toMatchObject({ shareToken: 'uuid-token-9999' });
  });

  it('rejects an invalid (path-traversal) /p/<token> as no-match (fail closed)', () => {
    const state = resolve(
      `https://${INVITE_UNIVERSAL_HOST}/p/${encodeURIComponent('../etc/passwd')}`,
    );
    expect(findRoute(state, 'PackageCheckout')).toBeUndefined();
  });

  it('rejects an HTML-injection /p/<token> as no-match (fail closed)', () => {
    const state = resolve(
      `https://${INVITE_UNIVERSAL_HOST}/p/${encodeURIComponent('<script>alert(1)</script>')}`,
    );
    expect(findRoute(state, 'PackageCheckout')).toBeUndefined();
  });

  it('rejects an oversized /p/<token> as no-match', () => {
    const big = 'a'.repeat(200);
    const state = resolve(`https://${INVITE_UNIVERSAL_HOST}/p/${big}`);
    expect(findRoute(state, 'PackageCheckout')).toBeUndefined();
  });

  it('rejects a malformed-URI /p/<token> without throwing (URIError fail-closed)', () => {
    // `%E0%A4%A` is an incomplete UTF-8 sequence; decodeURIComponent throws.
    // Linking resolver MUST return no-match instead of crashing.
    expect(() =>
      resolve(`https://${INVITE_UNIVERSAL_HOST}/p/%E0%A4%A`),
    ).not.toThrow();
    const state = resolve(`https://${INVITE_UNIVERSAL_HOST}/p/%E0%A4%A`);
    expect(findRoute(state, 'PackageCheckout')).toBeUndefined();
  });
});
