// CF-COACH-BILLING-129: Billing & access fed the body production
// GET /coach/billing/status really sends (backend
// src/billing/mobile-coach-billing.controller.ts:43-64): { status, plan_tier,
// current_period_end, cancel_at_period_end, trial_end }, with no `state`.
// Before the fix every case fell to "Something went wrong". axios is mocked, so
// the real coachBillingApi mapping runs.
import React from 'react';
import { render } from '@testing-library/react-native';

const mockBody: { current: unknown } = { current: undefined };
jest.mock('axios', () => {
  const instance = {
    get: jest.fn((url: string) =>
      Promise.resolve({
        data: url === '/coach/billing/status' ? mockBody.current : { subscription: null, invoices: [] },
      }),
    ),
    post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(), request: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) } };
});
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
  openAuthSessionAsync: jest.fn(),
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
const mockColors = new Proxy({}, { get: () => '#000000' });
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: mockColors }) }));

import CoachBillingScreen from '../CoachBillingScreen';
import { BillingSection } from '../settings/BillingSection';
import ErrorBoundary from '../../../components/ErrorBoundary';

const body = (status: unknown, extra: Record<string, unknown> = {}) => ({
  status,
  plan_tier: null,
  current_period_end: null,
  cancel_at_period_end: false,
  trial_end: null,
  ...extra,
});

const screen = () => (
  <ErrorBoundary>
    <CoachBillingScreen navigation={{ goBack: jest.fn() } as never} />
  </ErrorBoundary>
);

let errSpy: jest.SpyInstance;
beforeEach(() => {
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

describe('CoachBillingScreen with the real backend body', () => {
  it.each<[string | undefined, string]>([
    ['unprovisioned', 'No subscription'],
    ['active', 'Active'],
    ['trialing', 'Trial'],
    ['past_due', 'Past due'],
    ['unpaid', 'Past due'],
    ['paused', 'Paused'],
    ['canceled', 'Canceled'],
    ['incomplete', 'No subscription'],
    ['incomplete_expired', 'No subscription'],
    ['a_future_value', 'No subscription'],
    ['constructor', 'No subscription'],
    [undefined, 'No subscription'],
  ])('status %s shows "%s" and never crashes', async (status, label) => {
    mockBody.current = body(status);
    const view = await render(screen());
    expect(await view.findByText(label)).toBeTruthy();
    expect(view.queryByText('Something went wrong')).toBeNull();
  });

  it('shows the date the backend sends, as an end date when canceling', async () => {
    mockBody.current = body('active', {
      current_period_end: '2026-11-01T12:00:00.000Z',
      cancel_at_period_end: true,
    });
    const view = await render(screen());
    expect(await view.findByText('Ends on')).toBeTruthy();
    expect(view.getByText('Nov 1, 2026')).toBeTruthy();
  });
});

describe('Coach Settings', () => {
  it('shows no Subscription row, since coaching needs no coach plan', async () => {
    const view = await render(
      <BillingSection onOpenTeamProfile={jest.fn()} colors={mockColors as never} styles={{} as never} />,
    );
    expect(view.getByText('Business profile')).toBeTruthy();
    expect(view.queryByText('Billing & access')).toBeNull();
    expect(view.queryByText('Subscription')).toBeNull();
  });
});
