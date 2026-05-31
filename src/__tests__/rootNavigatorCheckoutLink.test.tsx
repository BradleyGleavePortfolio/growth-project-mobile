/**
 * RootNavigator — Stripe Checkout return deep-link config (PR-18 M1, R2 P1).
 *
 * The buyer's primary checkout return path is the in-app webview
 * short-circuit (BrandedCheckoutWebViewScreen), but a platform / browser /
 * WebView fallback can deliver the Stripe return through React Navigation's
 * app-link path instead. packagesApi mints the return URLs on the
 * `com.growthproject.app://` scheme:
 *
 *   com.growthproject.app://checkout/success?session_id=cs_xxx
 *   com.growthproject.app://checkout/cancel
 *
 * For that fallback to land the buyer on CheckoutReturn, two things must hold:
 *   1. `linking.prefixes` must accept the `com.growthproject.app://` scheme
 *      (otherwise React Navigation discards the URL before parsing the path).
 *   2. The path `checkout/<outcome>` must resolve to the CheckoutReturn screen
 *      with the parsed `outcome` + `session_id` params.
 *
 * React Navigation strips the matching prefix before calling
 * `getStateFromPath`, so we assert (1) on the exported prefix list and (2) by
 * driving the post-prefix path through the exported `linking.getStateFromPath`.
 */

import { getActionFromState } from '@react-navigation/native';

// The PackageCheckout route's share-token guard calls into the screenshot-mode
// helper transitively; stub it inert so the linking config is in real-build mode.
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));

// RootNavigator transitively imports the full navigator tree, which pulls in
// native-only modules (expo-video etc.) that fail to load under Jest. We only
// need the exported `linking` config, so stub the heaviest leaves to inert
// components / mocks — mirrors rootNavigatorAcceptLink.test.tsx.
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn() }),
  VideoView: () => null,
}));
jest.mock('../navigation/AuthNavigator', () => () => null);
jest.mock('../navigation/ClientNavigator', () => () => null);
jest.mock('../navigation/CoachNavigator', () => () => null);
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/LeanOnboardingNavigator', () => () => null);

// eslint-disable-next-line import/first
import { linking } from '../navigation/RootNavigator';

function findCheckoutReturn(state: unknown): Record<string, unknown> | null {
  // Walk the nested navigation state for a route named CheckoutReturn.
  const stack: unknown[] = [state];
  while (stack.length) {
    const node = stack.pop() as { routes?: Array<Record<string, unknown>> } | null;
    if (!node?.routes) continue;
    for (const route of node.routes) {
      if (route.name === 'CheckoutReturn') return route;
      if (route.state) stack.push(route.state);
    }
  }
  return null;
}

describe('RootNavigator linking — Stripe checkout return scheme (P1)', () => {
  it('accepts the com.growthproject.app:// scheme as a linking prefix', () => {
    // Without this prefix, an app-link-delivered Stripe return on the minted
    // scheme would be discarded before the path is ever parsed.
    expect(linking.prefixes).toContain('com.growthproject.app://');
    // Existing prefixes must remain so other deep links keep working.
    expect(linking.prefixes).toContain('tgp://');
    expect(linking.prefixes).toContain('https://app.trygrowthproject.com');
  });

  it('routes checkout/success?session_id=... to CheckoutReturn with parsed params', () => {
    const getState = linking.config?.screens
      ? // React Navigation strips the prefix; we pass the post-prefix path.
        linking.getStateFromPath!
      : null;
    expect(getState).toBeTruthy();

    const state = getState!('checkout/success?session_id=cs_test_123', {
      screens: (linking.config!.screens as never),
    });
    const route = findCheckoutReturn(state);
    expect(route).toBeTruthy();
    expect((route!.params as Record<string, unknown>)?.outcome).toBe('success');
    expect((route!.params as Record<string, unknown>)?.session_id).toBe('cs_test_123');
    // Sanity: the parsed state yields a navigable action.
    expect(state && getActionFromState(state as never)).toBeTruthy();
  });

  it('routes checkout/cancel to CheckoutReturn with outcome=cancel', () => {
    const state = linking.getStateFromPath!('checkout/cancel', {
      screens: (linking.config!.screens as never),
    });
    const route = findCheckoutReturn(state);
    expect(route).toBeTruthy();
    expect((route!.params as Record<string, unknown>)?.outcome).toBe('cancel');
  });
});
