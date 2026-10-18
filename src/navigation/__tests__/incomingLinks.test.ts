import { incomingLinkPath, resolveAppLink } from '../incomingLinks';
import {
  __resetPushTapRouterForTests, attachPushNavigator, flushPendingPushTap,
  routeAppLink, routePushTap, setPushSession,
} from '../../services/pushTapRouter';

const ID = '137c1340-c8a2-45d6-a006-7a6e695ed845';
const mockFlags = { clientCalendar: true, communityTab: true, coachBrief: true, coachTabsV2: true };
jest.mock('../../config/featureFlags', () => ({
  get featureFlags() { return mockFlags; },
}));

it.each([
  ['tgp://messages', 'messages'],
  [`tgp://meal-plan/${ID}`, `meal-plan/${ID}`],
  [`tgp:///meal-plan/${ID}`, `meal-plan/${ID}`],
  [`https://app.trygrowthproject.com/meal-plan/${ID}`, `meal-plan/${ID}`],
  ['com.growthproject.app://checkout/cancel', 'checkout/cancel'],
  ['tgp://wearables/connected?ticket=one&provider=OURA', 'wearables/connected?ticket=one&provider=OURA'],
  ['tgp://reset-password#access_token=one', 'reset-password#access_token=one'],
])('normalizes %s without losing a custom-scheme host or return params', (url, path) => {
  expect(incomingLinkPath(url)).toBe(path);
});

it.each([
  'https://unknown.example/messages',
  'https://app.trygrowthproject.com.evil.example/messages',
  'https://user@app.trygrowthproject.com/messages',
  'https://app.trygrowthproject.com:999/messages',
  'https://evil.example/app.trygrowthproject.com/reset-password',
  'http://app.trygrowthproject.com/messages',
  'other://messages', 'not a url', 'tgp://messages\\other',
])('rejects a URL outside the app origins: %s', (url) => {
  expect(incomingLinkPath(url)).toBeNull();
});

it.each([
  [`meal-plan/${ID}`, 'MoreTab', 'ClientDailyMealPlan'],
  [`workouts/${ID}`, 'MoreTab', 'WorkoutAssignmentDetail'],
  ['workouts', 'WorkoutTab', 'WorkoutMain'],
  ['home', 'Home', 'HomeMain'],
  ['plan', 'MoreTab', 'Plan'],
  ['weight', 'MoreTab', 'Progress'],
  ['timeline', 'MoreTab', 'Timeline'],
  ['checkin/today', 'Home', 'Habits'],
  ['messages', 'Home', 'Messages'],
  ['billing/update', 'MoreTab', 'UpdateCard'],
  ['billing/update-card', 'MoreTab', 'UpdateCard'],
  ['p/abc-123_DEF', 'MoreTab', 'PackageCheckout'],
  ['wearables/connected?status=ok&ticket=tk_1', 'MoreTab', 'Connections'],
  ['checkout/success?session_id=cs_1', 'MoreTab', 'CheckoutReturn'],
  ['checkout/cancel', 'MoreTab', 'CheckoutReturn'],
  [`sessions/${ID}`, 'CalendarTab', 'CalendarSession'],
  [`client/sessions/${ID}`, 'CalendarTab', 'CalendarSession'],
  [`community/thread/${ID}`, 'CommunityTab', 'CommunityThread'],
  [`community/dm/${ID}`, 'CommunityTab', 'CommunityDmThread'],
])('routes the client path %s to an existing nested screen', (path, root, screen) => {
  expect(resolveAppLink(path, 'student')).toMatchObject({ root, screen, initial: false });
});

it.each([
  [`coach/clients/${ID}`, 'ClientsStack', 'ClientDetail'],
  [`coach/clients/${ID}/checkins`, 'ClientsStack', 'ClientDetail'],
  [`coach/sessions/${ID}`, 'CalendarStack', 'CoachBookingInbox'],
  ['coach/brief/today', 'SettingsStack', 'CoachBrief'],
  ['messages', 'Messages', 'MessagesInbox'],
])('keeps the coach path %s out of client navigation', (path, root, screen) => {
  expect(resolveAppLink(path, 'coach')).toMatchObject({ root, screen });
  if (path.startsWith('coach/')) expect(resolveAppLink(path, 'student')).toBeNull();
});

it.each(['meal-plan/not-an-id', 'meal-plan/%E0%A4%A', 'meal-plan/%2F', `meal-plan/${ID}/extra`, 'unknown'])(
  'never resolves a malformed or unknown path: %s', (path) => {
    expect(resolveAppLink(path, 'student')).toBeNull();
    expect(resolveAppLink(path, 'coach')).toBeNull();
  },
);

it('passes only the path assignment id, never arbitrary query params, to the meal-plan screen', () => {
  expect(resolveAppLink(`meal-plan/${ID}?assignmentId=another&screen=Login`, 'student')).toEqual({
    root: 'MoreTab', screen: 'ClientDailyMealPlan', params: { assignmentId: ID }, initial: false,
  });
  expect(resolveAppLink(`meal-plan/${ID}`, 'coach')).toBeNull();
});

it('respects feature gates rather than navigating into unmounted tabs', () => {
  mockFlags.clientCalendar = false;
  mockFlags.communityTab = false;
  mockFlags.coachBrief = false;
  expect(resolveAppLink(`sessions/${ID}`, 'student')).toBeNull();
  expect(resolveAppLink('community', 'student')).toBeNull();
  expect(resolveAppLink('coach/brief/today', 'coach')).toBeNull();
  mockFlags.clientCalendar = mockFlags.communityTab = mockFlags.coachBrief = true;
});

describe('shared incoming-link queue identity and readiness', () => {
  const nav = {
    isReady: () => true,
    getRootState: () => ({ routeNames: ['Home', 'MoreTab', 'ClientsStack'] }),
    navigate: jest.fn(),
  };
  beforeEach(() => {
    __resetPushTapRouterForTests();
    nav.navigate.mockClear();
    attachPushNavigator(nav);
  });

  it('holds an app URL until the signed-in app navigator is ready', () => {
    setPushSession({ kind: 'signedOut' });
    routeAppLink(`meal-plan/${ID}`);
    expect(flushPendingPushTap()).toBe(false);
    setPushSession({ kind: 'onboarding', userId: 'one' });
    expect(nav.navigate).not.toHaveBeenCalled();
    setPushSession({ kind: 'app', role: 'student', userId: 'one' });
    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });

  it.each(['sign-out', 'account-switch'])('drops an account-bound URL on %s', (change) => {
    setPushSession({ kind: 'onboarding', userId: 'one' });
    routeAppLink(`meal-plan/${ID}`);
    if (change === 'sign-out') setPushSession({ kind: 'signedOut' });
    setPushSession({ kind: 'app', role: 'student', userId: 'two' });
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('binds a signed-out URL when sign-in begins, so signing out of setup clears it', () => {
    setPushSession({ kind: 'signedOut' });
    routeAppLink(`meal-plan/${ID}`);
    setPushSession({ kind: 'onboarding', userId: 'one' });
    setPushSession({ kind: 'signedOut' });
    setPushSession({ kind: 'app', role: 'student', userId: 'one' });
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('keeps signed-out push taps dropped rather than replaying into another account', () => {
    setPushSession({ kind: 'signedOut' });
    routePushTap('NotificationCenter', undefined, 'push-one', `tgp://meal-plan/${ID}`);
    setPushSession({ kind: 'app', role: 'student', userId: 'one' });
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('deduplicates the same cold/live meal-plan push and preserves specific safety actions', () => {
    setPushSession({ kind: 'app', role: 'student', userId: 'one' });
    routePushTap('NotificationCenter', undefined, 'push-one', `tgp://meal-plan/${ID}`);
    routePushTap('NotificationCenter', undefined, 'push-one', `tgp://meal-plan/${ID}`);
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    routePushTap('Messages', undefined, 'push-two', 'https://unknown.example/messages');
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    setPushSession({ kind: 'app', role: 'coach', userId: 'one' });
    routePushTap('CoachSafetyAlert', { alertId: ID }, 'safety', `tgp://coach/clients/${ID}`);
    expect(nav.navigate).toHaveBeenLastCalledWith('ClientsStack', {
      screen: 'CoachSafetyAlert', params: { alertId: ID }, initial: false,
    });
  });
});
