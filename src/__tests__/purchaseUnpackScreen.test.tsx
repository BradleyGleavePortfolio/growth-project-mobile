/**
 * PurchaseUnpackScreen — PR-15B post-checkout unpack moment.
 *
 * What we assert:
 *   1. The screen renders an "Unlocked now" section for status='fired'
 *      drops and a "Coming up" section for pending|due drops.
 *   2. Per-asset_type tappable destinations are IDENTICAL to the PR-13
 *      DeliverablesScreen routing table (workout → WorkoutAssignmentDetail,
 *      meal_plan → ClientDailyMealPlan, auto_message → Messages,
 *      pdf/video non-tappable).
 *   3. A delivered drop without a `materialised_ref` is non-tappable and
 *      never navigates (rule 18 — no fabricated success).
 *   4. The recurring receipt header shows a "Next charge ..." line; one_time
 *      omits it.
 *   5. The `not_configured` envelope renders the graceful "Purchase
 *      complete" state (never an error banner) so the buyer is never
 *      stranded if PR-15A hasn't deployed yet.
 *   6. Pull-to-refresh refetches getPurchaseDrops.
 *   7. The nav wiring from CheckoutReturnScreen into PurchaseUnpack is
 *      asserted both via source-grep (the wiring lives in a useEffect)
 *      AND via the typed route registration on the navigator
 *      (Rule 27 — typed nav).
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
}

// ─── Pure-helper unit tests ─────────────────────────────────────────────────

import { __test as UnpackTest } from '../screens/client/PurchaseUnpackScreen';
import type {
  ClientCoachPackage,
  ClientPurchase,
} from '../api/clientPaymentsApi';

const basePurchase = (overrides: Partial<ClientPurchase> = {}): ClientPurchase => ({
  id: 'purchase_42',
  package_id: 'pkg_1',
  status: 'paid',
  entitlement_active: true,
  access_expires_at: null,
  current_period_end: '2026-06-29T00:00:00Z',
  cancel_at_period_end: false,
  canceled_at: null,
  created_at: '2026-05-29T00:00:00Z',
  ...overrides,
});

const basePackage = (overrides: Partial<ClientCoachPackage> = {}): ClientCoachPackage => ({
  id: 'pkg_1',
  name: '1:1 Coaching',
  description: null,
  type: 'recurring',
  price: 199,
  currency: 'usd',
  interval: 'month',
  trial_days: null,
  features: [],
  ...overrides,
});

describe('buildReceipt — receipt header reconciliation', () => {
  it('recurring purchase yields next_charge from current_period_end', () => {
    const r = UnpackTest.buildReceipt(
      'purchase_42',
      [basePurchase()],
      [basePackage()],
      null,
    );
    expect(r.packageName).toBe('1:1 Coaching');
    expect(r.amountDisplay).toMatch(/\$199/);
    expect(r.recurring).toBe(true);
    expect(r.nextChargeAt).toBe('2026-06-29T00:00:00Z');
  });

  it('one_time purchase omits next_charge', () => {
    const r = UnpackTest.buildReceipt(
      'purchase_42',
      [basePurchase()],
      [basePackage({ type: 'one_time', interval: null })],
      null,
    );
    expect(r.recurring).toBe(false);
    expect(r.nextChargeAt).toBeNull();
  });

  it('cancel_at_period_end suppresses the next-charge line (no charge coming)', () => {
    const r = UnpackTest.buildReceipt(
      'purchase_42',
      [basePurchase({ cancel_at_period_end: true })],
      [basePackage()],
      null,
    );
    expect(r.recurring).toBe(true);
    expect(r.nextChargeAt).toBeNull();
  });

  it('honours a packageName override (caller pre-fetched it)', () => {
    const r = UnpackTest.buildReceipt(
      'purchase_42',
      [],
      [],
      'Pre-fetched Plan',
    );
    expect(r.packageName).toBe('Pre-fetched Plan');
    expect(r.amountDisplay).toBeNull();
  });
});

describe('formatChargeDate — deterministic year comparison (PR-15B audit P3-3)', () => {
  it('omits the year when the charge falls in the same calendar year as `now`', () => {
    // Inject a fixed `now` so the year-comparison branch is testable.
    const out = UnpackTest.formatChargeDate(
      '2026-06-29T00:00:00Z',
      Date.parse('2026-01-01T00:00:00Z'),
    );
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/2026/);
  });

  it('includes the year when the charge crosses into a different calendar year', () => {
    const out = UnpackTest.formatChargeDate(
      '2027-01-15T00:00:00Z',
      Date.parse('2026-12-01T00:00:00Z'),
    );
    expect(out).toMatch(/2027/);
  });

  it('returns null for null / malformed input', () => {
    expect(UnpackTest.formatChargeDate(null)).toBeNull();
    expect(UnpackTest.formatChargeDate('not-a-date')).toBeNull();
  });
});

// ─── Source guards ──────────────────────────────────────────────────────────

describe('PurchaseUnpackScreen — source guards', () => {
  const SRC = readSrc('screens/client/PurchaseUnpackScreen.tsx');
  const SHARED = readSrc('screens/client/deliverables/dropRow.tsx');

  it('imports the shared DropRow + routeForDrop helpers (no duplication of PR-13 routing)', () => {
    expect(SRC).toMatch(/from\s+['"]\.\/deliverables\/dropRow['"]/);
    expect(SRC).toMatch(/\bDropRow\b/);
    expect(SRC).toMatch(/\brouteForDrop\b/);
  });

  it('renders Unlocked now + Coming up section labels (not Delivered/Upcoming)', () => {
    expect(SRC).toMatch(/Unlocked now/);
    expect(SRC).toMatch(/Coming up/);
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

  it('load is cancel-safe on unmount — guards setState behind an isAlive ref (PR-15B audit P3-2)', () => {
    // A fast back-out during the three parallel fetches must not call
    // setState on an unmounted component. We assert the pattern by
    // source-grep: an `isAliveRef` is declared, the useEffect cleanup
    // flips it to false, and `load` checks `isAlive()` before every
    // setState.
    expect(SRC).toMatch(/isAliveRef/);
    expect(SRC).toMatch(/isAliveRef\.current\s*=\s*false/);
    expect(SRC).toMatch(/if\s*\(\s*!\s*isAlive\(\)\s*\)\s*return/);
  });

  it('shared dropRow module exports the routing helper as a single source of truth', () => {
    // The audit requirement (B2): unpack screen routes must be IDENTICAL
    // to PR-13's table. Both screens import from this one module — proven
    // by source-grep here AND by `DeliverablesScreen` importing the
    // same helpers (asserted below).
    expect(SHARED).toMatch(/export\s+function\s+routeForDrop/);
    expect(SHARED).toMatch(/WorkoutAssignmentDetail/);
    expect(SHARED).toMatch(/ClientDailyMealPlan/);
    expect(SHARED).toMatch(/Messages/);
  });

  it('DeliverablesScreen also imports from the shared module (no drift)', () => {
    const DELIVERABLES = readSrc('screens/client/DeliverablesScreen.tsx');
    expect(DELIVERABLES).toMatch(/from\s+['"]\.\/deliverables\/dropRow['"]/);
    expect(DELIVERABLES).toMatch(/\brouteForDrop\b/);
    expect(DELIVERABLES).toMatch(/\bDropRow\b/);
  });
});

// ─── Navigation wiring guards ───────────────────────────────────────────────

describe('navigation wiring — PurchaseUnpack', () => {
  const clientNav = readSrc('navigation/ClientNavigator.tsx');
  const checkoutReturn = readSrc('screens/client/CheckoutReturnScreen.tsx');

  it('ClientNavigator registers PurchaseUnpack with the PurchaseUnpackScreen component', () => {
    expect(clientNav).toMatch(/name="PurchaseUnpack"\s+component=\{PurchaseUnpackScreen\}/);
  });

  it('PurchaseUnpack route is typed with purchaseId + optional packageName (Rule 27)', () => {
    expect(clientNav).toMatch(
      /PurchaseUnpack:\s*\{\s*purchaseId:\s*string;\s*packageName\?:\s*string\s*\}/,
    );
  });

  it('CheckoutReturnScreen navigates to PurchaseUnpack with the purchase_id on a successful confirm', () => {
    // The wiring lives in a useEffect that fires once the confirm
    // response + reconciliation yields a purchase_id. We source-grep the
    // exact call so a refactor cannot silently delete the handoff.
    expect(checkoutReturn).toMatch(/'PurchaseUnpack'/);
    expect(checkoutReturn).toMatch(/purchaseId:\s*status\.purchase_id/);
  });

  it('CheckoutReturnScreen prefers replace() over navigate() so back-swipe skips the confirm screen (PR-15B audit P3-1)', () => {
    // The handoff should swap PurchaseUnpack IN PLACE of the
    // confirmation screen on stacks that support it (native-stack),
    // with a navigate() fallback for navigators that don't expose
    // replace (e.g. tab parents). Source-grep both.
    expect(checkoutReturn).toMatch(/navAny\.replace\(\s*'PurchaseUnpack'/);
    expect(checkoutReturn).toMatch(/navAny\.navigate\(\s*'PurchaseUnpack'/);
  });

  it('CheckoutReturnScreen gates the PurchaseUnpack nav on featureFlags.deliverables', () => {
    // Same flag the persistent Deliverables surface uses — the unpack
    // screen must not light up in production until ops flips it.
    expect(checkoutReturn).toMatch(/featureFlags\.deliverables/);
  });
});

// ─── RTL mount tests ────────────────────────────────────────────────────────

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
  useFocusEffect: (_cb: () => void) => {
    // No-op — first-mount useEffect covers the load path.
  },
}));

// PurchaseUnpackScreen migrated to semantic tokens (PR-18 M1), so it now
// destructures `semanticColors` and `tokens` from useTheme. Mock against the
// real token module so the full theme surface is present and stays in sync
// with the source of truth instead of a hand-maintained partial.
jest.mock('../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../theme/tokens').default;
  return {
    useTheme: () => ({
      colors: {
        background: '#F5EFE4',
        surface: '#F1E8D5',
        surfaceElevated: '#F1E8D5',
        primary: '#2C4A36',
        primaryPale: 'rgba(44,74,54,0.06)',
        primaryLight: '#2C4A36',
        primaryDark: '#2C4A36',
        primaryTint: 'rgba(44,74,54,0.06)',
        textPrimary: '#1A1A18',
        textSecondary: '#3D3D3A',
        textMuted: '#B1A89F',
        textOnPrimary: '#F5EFE4',
        border: 'rgba(176,141,87,0.2)',
        divider: 'rgba(176,141,87,0.15)',
        success: '#2C4A36',
        warning: '#C5A253',
        error: '#4A0404',
        info: '#1A73E8',
      },
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      colorScheme: 'light',
    }),
  };
});

const mockGetPurchaseDrops = jest.fn();
const mockGetPurchases = jest.fn();
const mockGetPackages = jest.fn();
jest.mock('../api/clientPaymentsApi', () => {
  const actual = jest.requireActual('../api/clientPaymentsApi');
  return {
    ...actual,
    clientPaymentsApi: {
      ...actual.clientPaymentsApi,
      getPurchaseDrops: (...args: unknown[]) => mockGetPurchaseDrops(...args),
      getPurchases: (...args: unknown[]) => mockGetPurchases(...args),
      getPackages: (...args: unknown[]) => mockGetPackages(...args),
    },
  };
});

import PurchaseUnpackScreen from '../screens/client/PurchaseUnpackScreen';

const sampleDrops = (overrides: { fired?: number; pending?: number } = {}) => {
  const fired = overrides.fired ?? 1;
  const pending = overrides.pending ?? 1;
  const out: unknown[] = [];
  for (let i = 0; i < fired; i += 1) {
    out.push({
      id: `f${i}`,
      asset_type: 'workout_program',
      asset_id: `prog_${i}`,
      asset_revision_id: null,
      cadence_kind: 'immediate',
      display_title: `Workout ${i}`,
      display_caption: null,
      fire_at: null,
      fired_at: '2026-05-01T10:00:00Z',
      status: 'fired',
      materialised_ref: `assignment_${i}`,
    });
  }
  for (let i = 0; i < pending; i += 1) {
    out.push({
      id: `p${i}`,
      asset_type: 'meal_plan',
      asset_id: `mp_${i}`,
      asset_revision_id: null,
      cadence_kind: 'relative_to_purchase',
      display_title: `Plan ${i}`,
      display_caption: null,
      fire_at: new Date(Date.now() + (i + 5) * 24 * 60 * 60_000).toISOString(),
      fired_at: null,
      status: 'pending',
      materialised_ref: null,
    });
  }
  return out;
};

describe('PurchaseUnpackScreen — RTL mount', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockParentNavigate.mockReset();
    mockGetPurchaseDrops.mockReset();
    mockGetPurchases.mockReset();
    mockGetPackages.mockReset();
    mockRouteParams = { purchaseId: 'purchase_42', packageName: '1:1 Coaching' };
    mockGetPurchases.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'purchase_42',
          package_id: 'pkg_1',
          status: 'paid',
          entitlement_active: true,
          access_expires_at: null,
          current_period_end: '2026-06-29T00:00:00Z',
          cancel_at_period_end: false,
          canceled_at: null,
          created_at: '2026-05-29T00:00:00Z',
        },
      ],
    });
    mockGetPackages.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'pkg_1',
          name: '1:1 Coaching',
          description: null,
          type: 'recurring',
          price: 199,
          currency: 'usd',
          interval: 'month',
          trial_days: null,
          features: [],
        },
      ],
    });
  });

  it('renders a loading skeleton on first mount', async () => {
    mockGetPurchaseDrops.mockReturnValue(new Promise(() => {}));
    mockGetPurchases.mockReturnValue(new Promise(() => {}));
    mockGetPackages.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    expect(getByTestId('purchase-unpack-skeleton')).toBeTruthy();
  });

  it('splits unlocked-now (fired) vs coming-up (pending) with both sections rendered', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: sampleDrops() });
    const { getByTestId, getByText } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('purchase-unpack-list')).toBeTruthy());
    expect(getByText('Unlocked now')).toBeTruthy();
    expect(getByText('Coming up')).toBeTruthy();
    // Receipt header is visible with package name + amount.
    expect(getByTestId('purchase-unpack-receipt')).toBeTruthy();
    expect(getByText('1:1 Coaching')).toBeTruthy();
  });

  it('recurring purchase shows the Next charge line', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: sampleDrops() });
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() =>
      expect(getByTestId('purchase-unpack-next-charge')).toBeTruthy(),
    );
  });

  it('one_time purchase omits the Next charge line', async () => {
    mockGetPackages.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'pkg_1',
          name: '1:1 Coaching',
          description: null,
          type: 'one_time',
          price: 499,
          currency: 'usd',
          interval: null,
          trial_days: null,
          features: [],
        },
      ],
    });
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: sampleDrops() });
    const { getByTestId, queryByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('purchase-unpack-list')).toBeTruthy());
    expect(queryByTestId('purchase-unpack-next-charge')).toBeNull();
  });

  it('tapping an unlocked workout navigates to WorkoutAssignmentDetail with the assignmentId', async () => {
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: sampleDrops({ fired: 1, pending: 0 }),
    });
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('drop-row-f0')).toBeTruthy());
    await fireEvent.press(getByTestId('drop-row-f0'));
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutAssignmentDetail', {
      assignmentId: 'assignment_0',
    });
  });

  it('tapping an unlocked meal_plan navigates to ClientDailyMealPlan with the date', async () => {
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mp_drop',
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
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('drop-row-mp_drop')).toBeTruthy());
    await fireEvent.press(getByTestId('drop-row-mp_drop'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientDailyMealPlan', {
      date: '2026-05-01',
    });
  });

  it('tapping an unlocked auto_message opens Messages via parent navigator', async () => {
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'am',
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
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('drop-row-am')).toBeTruthy());
    await fireEvent.press(getByTestId('drop-row-am'));
    expect(mockParentNavigate).toHaveBeenCalledWith('Home', {
      screen: 'Messages',
    });
  });

  it('a delivered workout with no materialised_ref renders non-tappable and never navigates (rule 18)', async () => {
    mockGetPurchaseDrops.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'orphan',
          asset_type: 'workout_program',
          asset_id: 'prog_x',
          asset_revision_id: null,
          cadence_kind: 'immediate',
          display_title: 'Orphan',
          display_caption: null,
          fire_at: null,
          fired_at: '2026-05-01T10:00:00Z',
          status: 'fired',
          materialised_ref: null,
        },
      ],
    });
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('drop-row-orphan')).toBeTruthy());
    const row = getByTestId('drop-row-orphan');
    // The row renders as a plain <View> when non-tappable — no onPress
    // prop means there is no path from this row into the routing layer,
    // which is the proof that rule 18 is upheld (never fabricate a
    // success path when the drop can't actually route).
    expect(row.props.onPress).toBeUndefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('501 → not_configured → calm "Purchase complete" state, no Retry button (PR-15B audit P2-1)', async () => {
    // Paired test: only an EXPLICIT 501 from the backend collapses to
    // the calm complete state. The companion 404 test (below) asserts
    // a 404 produces the retryable error banner — PR-1's rule, restored
    // after PR-15A shipped the real route.
    mockGetPurchaseDrops.mockResolvedValue({ ok: false, reason: 'not_configured' });
    const { getByTestId, queryByTestId, getByText } = await render(<PurchaseUnpackScreen />);
    await waitFor(() =>
      expect(getByTestId('purchase-unpack-not-configured')).toBeTruthy(),
    );
    expect(queryByTestId('purchase-unpack-error')).toBeNull();
    expect(queryByTestId('purchase-unpack-retry')).toBeNull();
    expect(getByText('Purchase complete')).toBeTruthy();
  });

  it('404 → retryable error envelope → error banner with Retry (PR-15B audit P2-1)', async () => {
    // The real client maps 404 → reason: 'error' (see
    // deliverablesApi.test.ts). The unpack screen's `error` branch
    // renders the retry banner — proven here by stubbing the envelope
    // a 404 produces and asserting the resulting render is the error
    // state, not the calm complete state.
    mockGetPurchaseDrops.mockResolvedValue({
      ok: false,
      reason: 'error',
      message: 'Request failed with status code 404',
    });
    const { getByTestId, queryByTestId, queryByText } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('purchase-unpack-error')).toBeTruthy());
    expect(getByTestId('purchase-unpack-retry')).toBeTruthy();
    // Never the calm complete state.
    expect(queryByTestId('purchase-unpack-not-configured')).toBeNull();
    // Raw axios message must never reach the buyer (Rule 9 / Rule 17).
    expect(queryByText('Request failed with status code 404')).toBeNull();
  });

  it('renders the error banner with Retry on a real transport failure (5xx)', async () => {
    mockGetPurchaseDrops.mockResolvedValue({
      ok: false,
      reason: 'error',
      message: 'Request failed with status code 502',
    });
    const { getByTestId, queryByText } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('purchase-unpack-error')).toBeTruthy());
    expect(getByTestId('purchase-unpack-retry')).toBeTruthy();
    expect(queryByText('Request failed with status code 502')).toBeNull();
  });

  it('renders the "Your coach is setting things up" empty state when both lists are empty', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: [] });
    const { getByTestId, getByText } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('purchase-unpack-empty')).toBeTruthy());
    expect(getByText('Your coach is setting things up')).toBeTruthy();
  });

  it('pull-to-refresh refetches getPurchaseDrops', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: [] });
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('purchase-unpack-empty')).toBeTruthy());
    expect(mockGetPurchaseDrops).toHaveBeenCalledTimes(1);
    const sv = getByTestId('purchase-unpack-empty');
    await act(async () => {
      const refreshControl = sv.props.refreshControl;
      expect(refreshControl).toBeTruthy();
      await refreshControl.props.onRefresh();
    });
    expect(mockGetPurchaseDrops).toHaveBeenCalledTimes(2);
  });

  it('Go-to-deliverables CTA navigates to Deliverables with the purchase id', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: sampleDrops() });
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() =>
      expect(getByTestId('purchase-unpack-go-to-deliverables')).toBeTruthy(),
    );
    await fireEvent.press(getByTestId('purchase-unpack-go-to-deliverables'));
    expect(mockNavigate).toHaveBeenCalledWith('Deliverables', {
      purchaseId: 'purchase_42',
      packageName: '1:1 Coaching',
    });
  });

  it('Done CTA returns the buyer to Home via the parent navigator', async () => {
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: sampleDrops() });
    const { getByTestId } = await render(<PurchaseUnpackScreen />);
    await waitFor(() => expect(getByTestId('purchase-unpack-done')).toBeTruthy());
    await fireEvent.press(getByTestId('purchase-unpack-done'));
    expect(mockParentNavigate).toHaveBeenCalledWith('Home');
  });
});
