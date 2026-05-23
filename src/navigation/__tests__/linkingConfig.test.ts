// R26: All RootNavigator linking coverage drives REAL URLs through
// `linking.getStateFromPath()` and asserts the resulting navigation state.
// No source/config file reads; no regex matching against source strings.

import { INVITE_UNIVERSAL_HOST } from '../../utils/deepLink';

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
