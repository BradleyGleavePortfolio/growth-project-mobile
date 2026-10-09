/**
 * CLIENT-POLISH-134 item 5 (B22/B24) and B1 (owner ruling 10-08 23:5x: no
 * client is ever locked out of basic functions). The server lets EVERY client
 * use their own logging, workouts, plans, fasting, macros, check-ins and Roman
 * guidance without a package (routes marked @OpenToCoachlessClient()). The app
 * must never put "Logging comes with coaching", a plan gate or an access line
 * in front of those, whatever the entitlement check says (inactive, failed,
 * pending, a stray 402), for a coachless client or a coached one with a free
 * package, no package or a lapsed plan. Screens the coach sells keep the gate.
 *
 * The real EntitlementProvider, withProtectedScreen, ProtectedScreen and
 * PaywallSheet run; only the network, the user, the user cache and the iOS
 * purchase flag are mocked.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { AppState, AppStateStatus, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import type { CurrentUser } from '../hooks/useCurrentUser';

let mockUser: CurrentUser;
let mockHidden = false;

jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#2C4A36' }),
    tokens: {
      typography: {
        h2: { fontSize: 24 }, h4: { fontSize: 17 }, body: { fontSize: 16 },
        bodyMd: { fontSize: 16, fontWeight: '500' }, bodySmall: { fontSize: 14 },
      },
    },
  }),
}));
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    getEntitlement: jest.fn(),
    getPackages: jest.fn().mockResolvedValue({ ok: true, data: [] }),
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../lib/userCache', () => ({ readUserCacheSync: () => null, patchUserCache: async () => undefined }));
jest.mock('../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../config/purchaseSurfaces', () => ({
  ...jest.requireActual('../config/purchaseSurfaces'),
  nonP2PPurchasesHidden: () => mockHidden,
}));

import { EntitlementProvider } from '../entitlements/EntitlementProvider';
import { entitlementEvents } from '../entitlements/entitlementEvents';
import { withProtectedScreen } from '../entitlements/withProtectedScreen';
import { COACH_MANAGED_TITLE, COACHLESS_BODY, COACHLESS_CTA, COACHLESS_TITLE } from '../entitlements/PaywallSheet';
import { clientPaymentsApi } from '../api/clientPaymentsApi';

const getEntitlement = clientPaymentsApi.getEntitlement as jest.Mock;
const INACTIVE = { ok: true, data: { active: false } };
const WEAK_SIGNAL = { ok: false, reason: 'error', message: 'timeout of 30000ms exceeded' };
const COACHED: CurrentUser = { id: 'client-1', email: 'client@example.test', role: 'student', coach_id: 'coach-1' };
const COACHLESS: CurrentUser = { id: 'client-2', email: 'solo@example.test', role: 'student' };
const OLD_LINES = ['Logging comes with coaching', 'Food and water logging need active access.'];

function FoodLog() {
  return <Text testID="food-log">Breakfast</Text>;
}
function CommunityFeed() {
  return <Text testID="community-feed">Wins</Text>;
}
const OwnFood = withProtectedScreen(FoodLog, { openToCoachless: true });
const CoachOnly = withProtectedScreen(CommunityFeed);

function mount(child: React.ReactElement) {
  return render(<EntitlementProvider onMessageCoach={jest.fn()}>{child}</EntitlementProvider>);
}

beforeEach(() => {
  getEntitlement.mockReset();
  mockHidden = false;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    ((_t: string, _h: (s: AppStateStatus) => void) => ({ remove: jest.fn() })) as typeof AppState.addEventListener,
  );
});
afterEach(() => jest.restoreAllMocks());

describe('coachless client on its own logging screens', () => {
  it.each([
    ['Android, inactive', false, INACTIVE],
    ['iOS, inactive', true, INACTIVE],
    ['Android, the check failed', false, WEAK_SIGNAL],
    ['iOS, the check failed', true, WEAK_SIGNAL],
  ])('%s: the screen opens with no gate', async (_label, hidden, answer) => {
    mockHidden = hidden;
    mockUser = COACHLESS;
    getEntitlement.mockResolvedValue(answer);
    const r = await mount(<OwnFood />);
    expect(r.getByTestId('food-log')).toBeTruthy();
    for (const id of ['protected-screen-coach-managed', 'protected-screen-paywall', 'protected-screen-loading']) {
      expect(r.queryByTestId(id)).toBeNull();
    }
    for (const line of OLD_LINES) expect(r.queryByText(line)).toBeNull();
  });

  it('opens while the first check is still running (no spinner, offline start)', async () => {
    mockUser = COACHLESS;
    getEntitlement.mockReturnValue(new Promise(() => {}));
    const r = await mount(<OwnFood />);
    expect(r.getByTestId('food-log')).toBeTruthy();
    expect(r.queryByTestId('protected-screen-loading')).toBeNull();
  });

  it('a stray 402 from a coach-only route does not close logging, and the sheet never speaks of logging', async () => {
    mockUser = COACHLESS;
    getEntitlement.mockResolvedValue(INACTIVE);
    const r = await mount(<OwnFood />);
    await act(async () => {
      entitlementEvents.emitRequired({ status: 402, code: 'CLIENT_ENTITLEMENT_REQUIRED', message: 'Choose a plan.' });
    });
    expect(r.getByTestId('food-log')).toBeTruthy();
    expect(r.getByTestId('paywall-coach-managed')).toBeTruthy();
    expect(r.getByText(COACHLESS_TITLE)).toBeTruthy();
    for (const line of OLD_LINES) expect(r.queryByText(line)).toBeNull();
  });
});

describe('coached client with no package, a free package or a lapsed plan, on its own logging screens (B1)', () => {
  it.each([
    ['Android, inactive', false, INACTIVE],
    ['iOS, inactive', true, INACTIVE],
    ['Android, the check failed', false, WEAK_SIGNAL],
    ['iOS, the check failed', true, WEAK_SIGNAL],
  ])('%s: the screen opens with no gate', async (_label, hidden, answer) => {
    mockHidden = hidden;
    mockUser = COACHED;
    getEntitlement.mockResolvedValue(answer);
    const r = await mount(<OwnFood />);
    expect(r.getByTestId('food-log')).toBeTruthy();
    for (const id of ['protected-screen-coach-managed', 'protected-screen-paywall', 'protected-screen-loading', 'protected-screen-check-failed']) {
      expect(r.queryByTestId(id)).toBeNull();
    }
    for (const line of [...OLD_LINES, 'Choose a Plan', COACH_MANAGED_TITLE]) expect(r.queryByText(line)).toBeNull();
  });

  it('opens while the first check is still running (no spinner)', async () => {
    mockUser = COACHED;
    getEntitlement.mockReturnValue(new Promise(() => {}));
    const r = await mount(<OwnFood />);
    expect(r.getByTestId('food-log')).toBeTruthy();
    expect(r.queryByTestId('protected-screen-loading')).toBeNull();
  });

  it('a 402 from a paid route does not close logging', async () => {
    mockUser = COACHED;
    getEntitlement.mockResolvedValue(INACTIVE);
    const r = await mount(<OwnFood />);
    await act(async () => {
      entitlementEvents.emitRequired({ status: 402, code: 'CLIENT_ENTITLEMENT_REQUIRED', message: 'Choose a plan.' });
    });
    expect(r.getByTestId('food-log')).toBeTruthy();
  });
});

describe('the gate that remains (screens the coach sells)', () => {
  it.each([false, true])('a coached client without access keeps the gate on a coach-only screen (hidden=%s)', async (hidden) => {
    mockHidden = hidden;
    mockUser = COACHED;
    getEntitlement.mockResolvedValue(INACTIVE);
    const r = await mount(<CoachOnly />);
    expect(r.queryByTestId('community-feed')).toBeNull();
    expect(r.getByText(hidden ? COACH_MANAGED_TITLE : 'Choose a Plan')).toBeTruthy();
  });

  it('a coached client with active access opens a coach-only screen', async () => {
    mockUser = COACHED;
    getEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    const r = await mount(<CoachOnly />);
    expect(r.getByTestId('community-feed')).toBeTruthy();
  });

  it('a coachless client on a coach-only screen sees the coach line, not a logging line', async () => {
    mockUser = COACHLESS;
    getEntitlement.mockResolvedValue(INACTIVE);
    const r = await mount(<CoachOnly />);
    expect(r.queryByTestId('community-feed')).toBeNull();
    expect(r.getByText('This part comes with a coach')).toBeTruthy();
    expect(r.getByText(COACHLESS_BODY)).toBeTruthy();
    expect(r.getByText(COACHLESS_CTA)).toBeTruthy();
    for (const line of [COACHLESS_TITLE, COACHLESS_BODY]) expect(line).not.toMatch(/log/i);
  });
});

describe('ClientNavigator wiring (from the code)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
  const wrapped = (name: string) => new RegExp(`withProtectedScreen\\(${name}(,\\s*OWN)?\\)`).exec(src);

  it.each([
    'WorkoutScreen', 'ActiveWorkoutScreen', 'WorkoutHistoryEditScreen', 'ClientWorkoutViewerScreen',
    'WorkoutAssignmentDetailScreen', 'PlanScreen', 'ClientDailyMealPlanScreen', 'FastingScreen',
    'LogScreen', 'ClientMacrosScreen', 'AIGuideScreen',
  ])('%s is open to every client', (name) => {
    expect(wrapped(name)?.[1]).toBeTruthy();
  });

  it.each([
    'withCommunityTerms\\(CommunityScreen\\)', 'ClientUpcomingSessionsScreen',
    'CalendarHomeScreen', 'CalendarBookScreen', 'CalendarSessionScreen',
  ])('%s keeps the gate (coach-only server routes)', (name) => {
    const match = wrapped(name);
    expect(match).toBeTruthy();
    expect(match?.[1]).toBeUndefined();
  });

  it('OWN means openToCoachless', () => {
    expect(src).toMatch(/const OWN = \{ openToCoachless: true \} as const;/);
  });
});
