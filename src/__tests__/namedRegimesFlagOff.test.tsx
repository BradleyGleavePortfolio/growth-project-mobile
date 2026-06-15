/**
 * Flag-off doctrine pin for the F2 Named-Regimes + partial-refund surfaces.
 *
 * When `featureFlags.namedRegimes` is OFF (the unconditional production
 * default) NONE of the F2 surfaces may appear:
 *   • the RegimeList / RegimeEditor routes must NOT register in CoachNavigator;
 *   • RegimeListScreen / RegimeEditorScreen render null (mount nothing);
 *   • RefundDecisionCard renders null (mounts nothing).
 *
 * The route-registration guarantees are asserted STATICALLY by reading the
 * navigator source and pinning the flag gate — the exact pattern used by the
 * existing `navigation/__tests__/coachCommunityFlagOff.test.ts`, which avoids
 * mounting React Navigation (reanimated / gesture-handler) in a unit test. The
 * null-render guarantees are asserted by rendering each component with the flag
 * forced OFF (RNTL v14 `await render(...)`).
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';

// Force the flag OFF for the render-null assertions. The mock returns the SAME
// shape as src/config/featureFlags (a `featureFlags` map + `isFeatureEnabled`)
// with `namedRegimes` pinned false regardless of environment.
jest.mock('../config/featureFlags', () => ({
  featureFlags: { namedRegimes: false },
  isFeatureEnabled: () => false,
}));

// useTheme is mocked to the real light tokens so semanticColors keys resolve
// without standing up the ThemeProvider (mirrors the screen-test harness).
jest.mock('../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

const ROOT = path.resolve(__dirname, '..');

const COACH_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'CoachNavigator.tsx'),
  'utf8',
);
const FLAGS = fs.readFileSync(
  path.join(ROOT, 'config', 'featureFlags.ts'),
  'utf8',
);

describe('Named Regimes routes — flag-gated registration (default OFF)', () => {
  it('registers the RegimeList <Stack.Screen> only behind featureFlags.namedRegimes', () => {
    expect(COACH_NAV).toMatch(/\{featureFlags\.namedRegimes\s*&&/);
    const guardIdx = COACH_NAV.search(/\{featureFlags\.namedRegimes\s*&&/);
    const screenIdx = COACH_NAV.search(
      /name=["']RegimeList["']\s+component=\{RegimeListScreen\}/,
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('registers the RegimeEditor <Stack.Screen> only behind featureFlags.namedRegimes', () => {
    const guardIdx = COACH_NAV.search(/\{featureFlags\.namedRegimes\s*&&/);
    const screenIdx = COACH_NAV.search(
      /name=["']RegimeEditor["']\s+component=\{RegimeEditorScreen\}/,
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('does not register either regime route unconditionally', () => {
    const listOccurrences =
      COACH_NAV.match(/name=["']RegimeList["']\s+component=\{RegimeListScreen\}/g) ?? [];
    const editorOccurrences =
      COACH_NAV.match(/name=["']RegimeEditor["']\s+component=\{RegimeEditorScreen\}/g) ?? [];
    expect(listOccurrences).toHaveLength(1);
    expect(editorOccurrences).toHaveLength(1);
  });
});

describe('Expo feature flag — namedRegimes default OFF', () => {
  it('declares namedRegimes reading EXPO_PUBLIC_FF_NAMED_REGIMES with a false default', () => {
    expect(FLAGS).toMatch(
      /readFlag\([^)]*EXPO_PUBLIC_FF_NAMED_REGIMES[^)]*,\s*false\s*\)/,
    );
  });

  it('exposes a namedRegimes key on the flag map', () => {
    expect(FLAGS).toMatch(/namedRegimes\s*:/);
  });

  it('does not default namedRegimes to isDev', () => {
    expect(FLAGS).not.toMatch(
      /readFlag\([^)]*EXPO_PUBLIC_FF_NAMED_REGIMES[^)]*,\s*isDev\s*\)/,
    );
  });
});

describe('F2 surfaces render nothing when the flag is OFF', () => {
  it('RegimeListScreen mounts no surface', async () => {
    const RegimeListScreen = require('../screens/coach/RegimeListScreen').default;
    const navigation = { navigate: jest.fn() } as never;
    const route = { params: undefined } as never;
    const { queryByTestId, toJSON } = await render(
      <RegimeListScreen navigation={navigation} route={route} />,
    );
    expect(queryByTestId('regime-list-screen')).toBeNull();
    expect(toJSON()).toBeNull();
  });

  it('RegimeEditorScreen mounts no surface', async () => {
    const RegimeEditorScreen = require('../screens/coach/RegimeEditorScreen').default;
    const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
    const route = { params: { regimeId: null } } as never;
    const { queryByTestId, toJSON } = await render(
      <RegimeEditorScreen navigation={navigation} route={route} />,
    );
    expect(queryByTestId('regime-editor-screen')).toBeNull();
    expect(toJSON()).toBeNull();
  });

  it('RefundDecisionCard mounts nothing', async () => {
    const RefundDecisionCard = require('../components/coach/RefundDecisionCard').default;
    const decision = {
      id: 'd1',
      client_purchase_id: 'cp1',
      stripe_refund_id: 're_1',
      decision: 'pending' as const,
      created_at: '2026-06-01T00:00:00.000Z',
      client_user_id: 'u1',
      amount_cents: 2500,
    };
    const { queryByTestId, toJSON } = await render(
      <RefundDecisionCard decision={decision} />,
    );
    expect(queryByTestId('refund-decision-card')).toBeNull();
    expect(toJSON()).toBeNull();
  });
});
