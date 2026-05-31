/**
 * DeliverablesScreen — PR-13 buyer-facing drip timeline.
 *
 * What we assert:
 *   1. clientPaymentsApi.getPurchaseDrops hits the typed contract path
 *      (the buyer-facing endpoint the backend follow-up prereq must
 *      register). Idempotency-safe — read-only GET.
 *   2. The screen filters failed | canceled | skipped out of the buyer
 *      view (master plan §1 #10: COACH_ALERT goes to the coach, not the
 *      buyer). Pure function unit test on `__test.buyerStatusOf`.
 *   3. Tappability per asset_type — workout_program/_plan + meal_plan +
 *      auto_message tappable when the row has a `materialised_ref`; pdf
 *      / video non-tappable today (PR-12 viewers OOS). Unit test on
 *      `__test.isTappableDelivered`.
 *   4. The screen renders Delivered + Upcoming sections from a healthy
 *      response, the empty state when both lists are empty, the error
 *      state with a retry button on a transport failure, the
 *      not_configured state on 501, and a skeleton while loading.
 *   5. Tapping a delivered drop calls navigation.navigate with the right
 *      route + params per asset_type (the row of viewer wiring).
 *   6. The ClientPackagesScreen exposes a "View what's included" entry
 *      that navigates to Deliverables with the purchase_id (so the
 *      buyer can actually reach the new surface — Rule 21 no-orphan).
 *   7. ClientNavigator registers the Deliverables screen + types its
 *      params (Rule 27 typed nav).
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
}

// ─── Pure helper unit tests (buyer-visibility filter, tappability) ────────────

import { __test as DeliverablesTest } from '../screens/client/DeliverablesScreen';
import type { ScheduledDropView } from '../api/clientPaymentsApi';

const baseDrop = (overrides: Partial<ScheduledDropView> = {}): ScheduledDropView => ({
  id: 'drop_x',
  asset_type: 'workout_program',
  asset_id: 'prog_1',
  asset_revision_id: null,
  cadence_kind: 'immediate',
  display_title: 'Sample',
  display_caption: null,
  fire_at: null,
  fired_at: null,
  status: 'pending',
  materialised_ref: null,
  ...overrides,
});

describe('buyer-visibility filter (master plan §1 #10)', () => {
  it('classifies status=fired as delivered', () => {
    expect(DeliverablesTest.buyerStatusOf(baseDrop({ status: 'fired' }))).toBe(
      'delivered',
    );
  });

  it('classifies status in (pending|due) as upcoming', () => {
    expect(DeliverablesTest.buyerStatusOf(baseDrop({ status: 'pending' }))).toBe(
      'upcoming',
    );
    expect(DeliverablesTest.buyerStatusOf(baseDrop({ status: 'due' }))).toBe(
      'upcoming',
    );
  });

  it('HIDES failed / canceled / skipped (coach gets COACH_ALERT, not buyer)', () => {
    expect(DeliverablesTest.buyerStatusOf(baseDrop({ status: 'failed' }))).toBeNull();
    expect(DeliverablesTest.buyerStatusOf(baseDrop({ status: 'canceled' }))).toBeNull();
    expect(DeliverablesTest.buyerStatusOf(baseDrop({ status: 'skipped' }))).toBeNull();
  });
});

describe('tappability per asset_type', () => {
  it('workout_program is tappable iff materialised_ref present', () => {
    expect(
      DeliverablesTest.isTappableDelivered(
        baseDrop({ status: 'fired', asset_type: 'workout_program', materialised_ref: 'a_1' }),
      ),
    ).toBe(true);
    expect(
      DeliverablesTest.isTappableDelivered(
        baseDrop({ status: 'fired', asset_type: 'workout_program', materialised_ref: null }),
      ),
    ).toBe(false);
  });

  it('workout_plan + meal_plan are tappable with materialised_ref', () => {
    expect(
      DeliverablesTest.isTappableDelivered(
        baseDrop({ status: 'fired', asset_type: 'workout_plan', materialised_ref: 'a_2' }),
      ),
    ).toBe(true);
    expect(
      DeliverablesTest.isTappableDelivered(
        baseDrop({ status: 'fired', asset_type: 'meal_plan', materialised_ref: '2026-05-01' }),
      ),
    ).toBe(true);
  });

  it('auto_message is tappable even without materialised_ref (opens Messages list)', () => {
    expect(
      DeliverablesTest.isTappableDelivered(
        baseDrop({ status: 'fired', asset_type: 'auto_message', materialised_ref: null }),
      ),
    ).toBe(true);
  });

  it('pdf + video are NOT tappable today (PR-12 viewers OOS)', () => {
    expect(
      DeliverablesTest.isTappableDelivered(
        baseDrop({ status: 'fired', asset_type: 'pdf', materialised_ref: 'm_1' }),
      ),
    ).toBe(false);
    expect(
      DeliverablesTest.isTappableDelivered(
        baseDrop({ status: 'fired', asset_type: 'video', materialised_ref: 'm_2' }),
      ),
    ).toBe(false);
  });

  it('non-delivered status is never tappable', () => {
    expect(
      DeliverablesTest.isTappableDelivered(
        baseDrop({ status: 'pending', asset_type: 'workout_program', materialised_ref: 'a_1' }),
      ),
    ).toBe(false);
  });
});

describe('upcoming caption fallbacks', () => {
  it('uses display_caption for on_completion', () => {
    const c = DeliverablesTest.upcomingCaption(
      baseDrop({
        status: 'pending',
        cadence_kind: 'on_completion',
        fire_at: null,
        display_caption: 'Week 1',
      }),
    );
    expect(c).toBe('Unlocks when you complete Week 1');
  });

  it('falls back to neutral copy for on_milestone without display_caption', () => {
    const c = DeliverablesTest.upcomingCaption(
      baseDrop({
        status: 'pending',
        cadence_kind: 'on_milestone',
        fire_at: null,
        display_caption: null,
      }),
    );
    expect(c).toBe('Unlocks at the next milestone');
  });

  it('uses relative-date copy when fire_at is set', () => {
    const fireAt = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
    const c = DeliverablesTest.upcomingCaption(
      baseDrop({
        status: 'pending',
        cadence_kind: 'relative_to_purchase',
        fire_at: fireAt,
      }),
    );
    // numeric:'auto' produces "in 3 days" (or locale equivalent). We assert
    // the wording starts with "Unlocks " and references "day" so the test
    // is locale-tolerant.
    expect(c).toMatch(/^Unlocks /);
    expect(c.toLowerCase()).toMatch(/day|tomorrow|today|hour|may|jun/);
  });
});

// ─── Source guards ────────────────────────────────────────────────────────────

describe('DeliverablesScreen — source guards', () => {
  const SRC = readSrc('screens/client/DeliverablesScreen.tsx');
  // PR-15B refactor: the per-asset_type routing table + DropRow live in
  // a shared module so the unpack screen and the deliverables screen
  // cannot drift. The route-string guards now read from the shared
  // module location.
  const SHARED = readSrc('screens/client/deliverables/dropRow.tsx');

  it('routes workout_program / workout_plan to WorkoutAssignmentDetail', () => {
    expect(SHARED).toMatch(/WorkoutAssignmentDetail/);
    expect(SHARED).toMatch(/assignmentId/);
  });

  it('routes meal_plan to ClientDailyMealPlan', () => {
    expect(SHARED).toMatch(/ClientDailyMealPlan/);
  });

  it('routes auto_message to Messages (via parent Home stack)', () => {
    expect(SHARED).toMatch(/Messages/);
  });

  it('DeliverablesScreen imports the shared DropRow + routeForDrop (PR-15B)', () => {
    // The screen itself should be a thin shell: it imports the shared
    // routing helpers rather than re-implementing them, so PR-13 and
    // PR-15B can never diverge on per-asset_type destinations.
    expect(SRC).toMatch(/from\s+['"]\.\/deliverables\/dropRow['"]/);
    expect(SRC).toMatch(/\brouteForDrop\b/);
    expect(SRC).toMatch(/\bDropRow\b/);
  });

  it('uses useTheme().colors (no hardcoded hex)', () => {
    expect(SRC).toMatch(/useTheme/);
    const withoutComments = SRC.replace(/\/\/[^\n]*/g, '').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(withoutComments).not.toMatch(/"#[0-9A-Fa-f]{3,6}"/);
  });

  it('has RefreshControl for pull-to-refresh', () => {
    expect(SRC).toMatch(/RefreshControl/);
  });

  it('renders a SkeletonScreen while loading', () => {
    expect(SRC).toMatch(/SkeletonScreen/);
  });

  it('does NOT render raw axios error.message verbatim (Rule 9 / Rule 17)', () => {
    // PR-13 audit fix (P2-1): the error state must never show
    // `result.message` directly — that would surface "Request failed
    // with status code 404" or similar server internals to the buyer.
    expect(SRC).not.toMatch(/<Text[^>]*>\s*\{result\.message\}/);
    expect(SRC).not.toMatch(/style=\{styles\.emptyBody\}\s*>\s*\{result\.message\}/);
  });

  it('uses a valid React Native accessibilityRole (no "summary")', () => {
    // RN does not document a "summary" role; audit P3.
    expect(SRC).not.toMatch(/accessibilityRole=['"]summary['"]/);
  });
});

// ─── Navigation wiring guards ────────────────────────────────────────────────

describe('navigation wiring — Deliverables', () => {
  const clientNav = readSrc('navigation/ClientNavigator.tsx');
  const packagesScreen = readSrc('screens/client/ClientPackagesScreen.tsx');

  it('ClientNavigator registers Deliverables with the DeliverablesScreen component', () => {
    expect(clientNav).toMatch(/name="Deliverables"\s+component=\{DeliverablesScreen\}/);
  });

  it('Deliverables route is typed with purchaseId + optional packageName (Rule 27)', () => {
    expect(clientNav).toMatch(
      /Deliverables:\s*\{\s*purchaseId:\s*string;\s*packageName\?:\s*string\s*\}/,
    );
  });

  it('ClientPackagesScreen exposes a "View what\'s included" entry to Deliverables', () => {
    // Rule 21 — no orphan routes. The buyer needs a reachable navigate()
    // call into Deliverables; the Current plan card is that entry point.
    expect(packagesScreen).toMatch(/'Deliverables'/);
    expect(packagesScreen).toMatch(/view-deliverables-cta/);
    expect(packagesScreen).toMatch(/purchase_id/);
  });

  it('Deliverables CTA is feature-flag gated (audit P2-1)', () => {
    // The CTA must be hidden in production until the backend route lands.
    // We expect a `featureFlags.deliverables` gate in the conditional.
    expect(packagesScreen).toMatch(/featureFlags\.deliverables/);
  });

  it('featureFlags exposes a `deliverables` flag that defaults OFF in prod', () => {
    const flags = readSrc('config/featureFlags.ts');
    // The flag must read EXPO_PUBLIC_FF_DELIVERABLES so ops can flip it.
    expect(flags).toMatch(/deliverables:\s*readFlag\(['"]EXPO_PUBLIC_FF_DELIVERABLES['"]/);
    // Default value should be isDev (or false) — not a literal `true`.
    expect(flags).not.toMatch(
      /deliverables:\s*readFlag\(['"]EXPO_PUBLIC_FF_DELIVERABLES['"],\s*true\b/,
    );
  });
});

// ─── RTL mount tests ──────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();

let mockRouteParams: { purchaseId: string; packageName?: string } = {
  purchaseId: 'purchase_42',
  packageName: '1:1 Coaching',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    getParent: () => ({ navigate: mockParentNavigate }),
  }),
  useRoute: () => ({ params: mockRouteParams }),
  // No-op the focus effect in tests so the load count is deterministic.
  // The useEffect(load) path on first mount already exercises the same
  // code path; refetch-on-focus belongs to a navigation integration test.
  useFocusEffect: (_cb: () => void) => {
    // intentionally empty
  },
}));

// Theme mock — vends the real design-token module + light semantic tokens so
// the screen's `useTheme().semanticColors` / `tokens` access resolves against
// the same shapes production uses (Phase-11 semantic migration, PR-18 M1).
jest.mock('../theme/ThemeProvider', () => {
  const tokensModule = jest.requireActual('../theme/tokens');
  const realTokens = tokensModule.default;
  const CanonicalColors = jest.requireActual('../constants/colors').default;
  // Legacy flat `colors` map (still consumed by non-scoped child components
  // that have not yet migrated) PLUS the Phase-11 semantic tokens the scoped
  // PR-18 M1 screens now use.
  const colors = {
    ...CanonicalColors,
    dark: CanonicalColors.textPrimary,
    white: CanonicalColors.textOnPrimary,
    gold: CanonicalColors.warning,
    orange: CanonicalColors.error,
  };
  return {
    useTheme: () => ({
      colors,
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      tierColors: {
        accentBorder: realTokens.colors.forest,
        accentBg: 'rgba(44,74,54,0.06)',
        accentFg: realTokens.colors.forest,
        badgeShadow: realTokens.shadows.sm,
      },
      colorScheme: 'light',
    }),
  };
});

// Replace clientPaymentsApi.getPurchaseDrops with a mock we can control
// per-test. We keep the rest of the module intact (other call sites still
// use it elsewhere in this test file).
const mockGetPurchaseDrops = jest.fn();
jest.mock('../api/clientPaymentsApi', () => {
  const actual = jest.requireActual('../api/clientPaymentsApi');
  return {
    ...actual,
    clientPaymentsApi: {
      ...actual.clientPaymentsApi,
      getPurchaseDrops: (...args: unknown[]) => mockGetPurchaseDrops(...args),
    },
  };
});

import DeliverablesScreen from '../screens/client/DeliverablesScreen';

describe('DeliverablesScreen — RTL mount', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockParentNavigate.mockReset();
    mockGetPurchaseDrops.mockReset();
    mockRouteParams = { purchaseId: 'purchase_42', packageName: '1:1 Coaching' };
  });

  it('renders a loading skeleton on first mount', async () => {
    // Never-resolving promise so the component stays in the loading branch.
    mockGetPurchaseDrops.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<DeliverablesScreen />);
    expect(getByTestId('deliverables-skeleton')).toBeTruthy();
  });

  it('renders delivered + upcoming sections from a healthy response', async () => {
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd1',
          asset_type: 'workout_program',
          asset_id: 'prog_1',
          asset_revision_id: null,
          cadence_kind: 'immediate',
          display_title: 'Week 1',
          display_caption: 'Foundations',
          fire_at: null,
          fired_at: '2026-05-01T10:00:00Z',
          status: 'fired',
          materialised_ref: 'assignment_1',
        },
        {
          id: 'u1',
          asset_type: 'meal_plan',
          asset_id: 'mp_1',
          asset_revision_id: null,
          cadence_kind: 'relative_to_purchase',
          display_title: 'Week 2 plan',
          display_caption: null,
          fire_at: new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString(),
          fired_at: null,
          status: 'pending',
          materialised_ref: null,
        },
        {
          id: 'hidden',
          asset_type: 'pdf',
          asset_id: 'pdf_1',
          asset_revision_id: null,
          cadence_kind: 'immediate',
          display_title: 'Should not render',
          display_caption: null,
          fire_at: null,
          fired_at: null,
          status: 'failed',
          materialised_ref: null,
        },
      ],
    });
    const { getByTestId, queryByText, getByText } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('deliverables-list')).toBeTruthy());
    expect(getByText('Delivered')).toBeTruthy();
    expect(getByText('Upcoming')).toBeTruthy();
    // Failed drop must be hidden (master plan §1 #10).
    expect(queryByText('Should not render')).toBeNull();
  });

  it('renders the empty state when there are no buyer-visible drops', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: [] });
    const { getByTestId, getByText } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('deliverables-empty')).toBeTruthy());
    expect(getByText('No deliverables yet')).toBeTruthy();
  });

  it('renders the error state with a Retry button when the request fails (no raw axios message)', async () => {
    // Audit P2-1: even when the API returns a raw axios message like
    // "Request failed with status code 404" (or "Network Error"), the
    // screen must NEVER render it verbatim. The buyer sees a friendly,
    // action-oriented copy; the technical message stays in the result
    // object for the logger only.
    mockGetPurchaseDrops.mockResolvedValue({
      ok: false,
      reason: 'error',
      message: 'Request failed with status code 502',
    });
    const { getByTestId, getByText, queryByText } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('deliverables-error')).toBeTruthy());
    // The raw axios message must NOT appear anywhere on screen.
    expect(queryByText('Request failed with status code 502')).toBeNull();
    // A friendly, scrubbed copy is rendered instead.
    expect(getByText(/Check your connection and try again/i)).toBeTruthy();
    expect(getByTestId('deliverables-retry')).toBeTruthy();
  });

  it('renders the empty (not error) state when the endpoint is not configured (501)', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: false, reason: 'not_configured' });
    const { getByTestId, queryByTestId } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('deliverables-empty')).toBeTruthy());
    // PR-15B audit P2-1: 501 is the ONLY path to the calm empty state
    // for this envelope — the companion 404 test below asserts the
    // error banner. The two must remain distinguishable downstream of
    // `getPurchaseDrops`.
    expect(queryByTestId('deliverables-error')).toBeNull();
  });

  it('renders the error (not empty) state for a real transport failure that maps to error (PR-15B audit P2-1)', async () => {
    // A 404 from the now-real PR-15A endpoint maps to reason: 'error'
    // (see deliverablesApi.test.ts), and that envelope must reach the
    // user as the retry banner — not the silent "No deliverables yet"
    // empty state. Pairs with the 501 → empty test above.
    mockGetPurchaseDrops.mockResolvedValue({
      ok: false,
      reason: 'error',
      message: 'Request failed with status code 404',
    });
    const { getByTestId, queryByTestId } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('deliverables-error')).toBeTruthy());
    expect(getByTestId('deliverables-retry')).toBeTruthy();
    expect(queryByTestId('deliverables-empty')).toBeNull();
  });

  it('tapping a delivered workout drop navigates to WorkoutAssignmentDetail with the assignmentId', async () => {
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd1',
          asset_type: 'workout_program',
          asset_id: 'prog_1',
          asset_revision_id: null,
          cadence_kind: 'immediate',
          display_title: 'Week 1',
          display_caption: null,
          fire_at: null,
          fired_at: '2026-05-01T10:00:00Z',
          status: 'fired',
          materialised_ref: 'assignment_1',
        },
      ],
    });
    const { getByTestId } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('drop-row-d1')).toBeTruthy());
    fireEvent.press(getByTestId('drop-row-d1'));
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutAssignmentDetail', {
      assignmentId: 'assignment_1',
    });
  });

  it('tapping a delivered meal_plan drop navigates to ClientDailyMealPlan with the date AND the destination honors it', async () => {
    // Audit P2-2: the destination screen (ClientDailyMealPlanScreen)
    // must actually USE the `date` param — asserting only the
    // navigate() call would be self-fulfilling. We assert both: (a)
    // navigate is called with `date`, and (b) source-grep proves the
    // destination wires the param into `useMealPlanToday(dateParam)`.
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd2',
          asset_type: 'meal_plan',
          asset_id: 'mp_1',
          asset_revision_id: null,
          cadence_kind: 'immediate',
          display_title: 'Plan',
          display_caption: null,
          fire_at: null,
          fired_at: '2026-05-01T10:00:00Z',
          status: 'fired',
          materialised_ref: '2026-05-01',
        },
      ],
    });
    const { getByTestId } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('drop-row-d2')).toBeTruthy());
    fireEvent.press(getByTestId('drop-row-d2'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientDailyMealPlan', {
      date: '2026-05-01',
    });
    // Destination-honors-the-param guard (defense against self-fulfilling
    // mock — see audit P2-2 finding):
    const mealPlanScreenSrc = readSrc('screens/client/ClientDailyMealPlanScreen.tsx');
    expect(mealPlanScreenSrc).toMatch(/useRoute/);
    expect(mealPlanScreenSrc).toMatch(/route\.params\?\.date/);
    expect(mealPlanScreenSrc).toMatch(/useMealPlanToday\(\s*dateParam\s*\)/);
  });

  it('tapping a delivered auto_message drop opens Messages via parent navigator', async () => {
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd3',
          asset_type: 'auto_message',
          asset_id: 'am_1',
          asset_revision_id: null,
          cadence_kind: 'immediate',
          display_title: 'Welcome',
          display_caption: null,
          fire_at: null,
          fired_at: '2026-05-01T10:00:00Z',
          status: 'fired',
          materialised_ref: null,
        },
      ],
    });
    const { getByTestId } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('drop-row-d3')).toBeTruthy());
    fireEvent.press(getByTestId('drop-row-d3'));
    expect(mockParentNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  });

  it('a delivered workout drop without a materialised_ref renders non-tappable (graceful degrade)', async () => {
    // Master plan rule 18: never fabricate success when the operation
    // can't complete. The row still shows but is rendered as a plain
    // View, not a TouchableOpacity. We assert that by inspecting the
    // host node's type — RTL exposes the React element type on `.type`.
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd4',
          asset_type: 'workout_program',
          asset_id: 'prog_1',
          asset_revision_id: null,
          cadence_kind: 'immediate',
          display_title: 'Orphan workout',
          display_caption: null,
          fire_at: null,
          fired_at: '2026-05-01T10:00:00Z',
          status: 'fired',
          materialised_ref: null,
        },
      ],
    });
    const { getByTestId, getByText } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('drop-row-d4')).toBeTruthy());
    expect(getByText('Orphan workout')).toBeTruthy();
    // The row should have no `onPress` prop because the React tree
    // renders a plain View when the drop is non-tappable.
    const row = getByTestId('drop-row-d4');
    expect(row.props.onPress).toBeUndefined();
    // And the helper agrees:
    expect(
      DeliverablesTest.isTappableDelivered({
        id: 'd4',
        asset_type: 'workout_program',
        asset_id: 'prog_1',
        asset_revision_id: null,
        cadence_kind: 'immediate',
        display_title: 'Orphan workout',
        display_caption: null,
        fire_at: null,
        fired_at: '2026-05-01T10:00:00Z',
        status: 'fired',
        materialised_ref: null,
      }),
    ).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('pull-to-refresh refetches getPurchaseDrops', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: [] });
    const { getByTestId } = render(<DeliverablesScreen />);
    await waitFor(() => expect(getByTestId('deliverables-empty')).toBeTruthy());
    expect(mockGetPurchaseDrops).toHaveBeenCalledTimes(1);
    const sv = getByTestId('deliverables-empty');
    // RefreshControl's onRefresh is wired to <ScrollView refreshControl={...}>.
    await act(async () => {
      const refreshControl = sv.props.refreshControl;
      expect(refreshControl).toBeTruthy();
      // Invoke the onRefresh handler directly — RN's RefreshControl is
      // a host component in test, so we go through the prop the same way
      // the platform would.
      await refreshControl.props.onRefresh();
    });
    expect(mockGetPurchaseDrops).toHaveBeenCalledTimes(2);
  });
});
