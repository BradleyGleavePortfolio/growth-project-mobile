const mockFlags = {
  communityTab: true,
  communityEvents: true,
  coachCommunity: true,
  clientCalendar: true,
  coachBrief: true,
};
jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));

let mockHidden = false;
jest.mock('../../config/purchaseSurfaces', () => ({
  nonP2PPurchasesHidden: () => mockHidden,
}));

import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  decodePushParams,
  flushPendingPushTap,
  MAX_SEEN_IDS,
  pushSessionFor,
  routeInAppNotification,
  routePushTap,
  setPushSession,
  PushNavigator,
} from '../pushTapRouter';

function makeNav(routeNames: string[], ready = true) {
  const nav = {
    ready,
    routeNames,
    navigate: jest.fn(),
    isReady() { return this.ready; },
    getRootState() { return { routeNames: this.routeNames }; },
  };
  return nav as typeof nav & PushNavigator;
}

// Real root route names (ClientNavigator / CoachNavigator tab navigators).
const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab', 'CommunityTab'];
const COACH_TABS = ['CommandCenter', 'ClientsStack', 'Templates', 'Messages', 'CommunityStack', 'SettingsStack'];
const LEAN_ROOT = ['LeanQ1', 'LeanQ2', 'LeanQ3', 'LeanQ4', 'LeanQ5', 'LeanQ6'];
const WIZARD_ROOT = ['CoachWizardStep1', 'CoachWizardStep2', 'CoachWizardStep3', 'CoachWizardStep4', 'CoachWizardStep5', 'CoachWizardStep6'];
const AUTH_ROOT = ['Welcome', 'Login', 'CreateAccount', 'RoleSelection'];

const STUDENT_A = { kind: 'app', userId: 'user-A', role: 'student' } as const;
const COACH_A = { kind: 'app', userId: 'user-A', role: 'coach' } as const;

describe('pushTapRouter', () => {
  beforeEach(() => {
    __resetPushTapRouterForTests();
    mockFlags.communityTab = true;
    mockFlags.communityEvents = true;
    mockFlags.coachCommunity = true;
    mockFlags.clientCalendar = true;
    mockHidden = false;
  });

  describe('client nested destinations (real tab roots)', () => {
    it('Messages -> Home stack', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('Messages', { threadId: 't1' }, 'n1');
      expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', params: { threadId: 't1' } });
    });

    it('Timeline -> More tab', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('Timeline');
      expect(nav.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'Timeline', params: undefined });
    });

    it('CommunityEventDetail -> CommunityTab stack when community + events flags are on', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('CommunityEventDetail', { eventId: 'ev-1' }, 'nE');
      expect(nav.navigate).toHaveBeenCalledWith('CommunityTab', {
        screen: 'CommunityEventDetail',
        params: { eventId: 'ev-1' },
      });
    });

    it('CommunityEventDetail with the events flag off lands on the notification center, not a dead route', () => {
      mockFlags.communityEvents = false;
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('CommunityEventDetail', { eventId: 'ev-1' });
      expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'NotificationCenter', params: { eventId: 'ev-1' } });
    });

    it('unknown destination never does a blind root navigate', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('SomethingNew');
      expect(nav.navigate).toHaveBeenCalledTimes(1);
      expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'NotificationCenter', params: undefined });
    });
  });

  describe('S-SCHED booking pushes', () => {
    it('client CalendarSession -> Calendar tab session view with the session id', () => {
      const nav = makeNav([...CLIENT_TABS, 'CalendarTab']);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('CalendarSession', { sessionId: 's-1' }, 'nb1');
      expect(nav.navigate).toHaveBeenCalledWith('CalendarTab', { screen: 'CalendarSession', params: { sessionId: 's-1' } });
    });

    it('client CalendarSession with the Calendar flag off -> notification center', () => {
      mockFlags.clientCalendar = false;
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('CalendarSession', { sessionId: 's-1' }, 'nb2');
      expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'NotificationCenter', params: { sessionId: 's-1' } });
    });

    it('client CalendarSession when the tab is not mounted -> notification center, not a dead route', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('CalendarSession', { sessionId: 's-1' }, 'nb3');
      expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'NotificationCenter', params: { sessionId: 's-1' } });
    });

    it('in-app center rows use the same role-aware table (client and coach)', () => {
      const clientNav = makeNav([...CLIENT_TABS, 'CalendarTab']);
      attachPushNavigator(clientNav);
      setPushSession(STUDENT_A);
      expect(routeInAppNotification('CalendarSession', { sessionId: 's-9' })).toBe(true);
      expect(clientNav.navigate).toHaveBeenCalledWith('CalendarTab', { screen: 'CalendarSession', params: { sessionId: 's-9' } });

      const coachNav = makeNav(COACH_TABS);
      attachPushNavigator(coachNav);
      setPushSession(COACH_A);
      expect(routeInAppNotification('CoachBookingInbox', { sessionId: 's-9' })).toBe(true);
      expect(coachNav.navigate).toHaveBeenCalledWith('ClientsStack', { screen: 'CoachBookingInbox', params: { sessionId: 's-9' } });
    });

    it('in-app routing refuses when not in the app or the name is not routable', () => {
      const nav = makeNav([...CLIENT_TABS, 'CalendarTab']);
      attachPushNavigator(nav);
      setPushSession({ kind: 'signedOut' });
      expect(routeInAppNotification('CalendarSession', { sessionId: 's-9' })).toBe(false);
      setPushSession(STUDENT_A);
      expect(routeInAppNotification('not a screen', {})).toBe(false);
      expect(routeInAppNotification(undefined, {})).toBe(false);
      expect(nav.navigate).not.toHaveBeenCalled();
      // Not dedupe-bound: the same row can be opened twice.
      expect(routeInAppNotification('CalendarSession', { sessionId: 's-9' })).toBe(true);
      expect(routeInAppNotification('CalendarSession', { sessionId: 's-9' })).toBe(true);
      expect(nav.navigate).toHaveBeenCalledTimes(2);
    });

    it('coach CoachBookingInbox -> Clients stack booking inbox', () => {
      const nav = makeNav(COACH_TABS);
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('CoachBookingInbox', { sessionId: 's-1' }, 'nb4');
      expect(nav.navigate).toHaveBeenCalledWith('ClientsStack', { screen: 'CoachBookingInbox', params: { sessionId: 's-1' } });
    });

    // S-BRIEF-124 (agent 124): the daily brief push opens today's brief and
    // keeps Settings under it; with the flag off the tap is not routed.
    it('coach CoachBrief -> Settings stack brief, Settings kept underneath', () => {
      const nav = makeNav(COACH_TABS);
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('CoachBrief', { briefId: 'b-1' }, 'nbr1');
      expect(nav.navigate).toHaveBeenCalledWith('SettingsStack', {
        screen: 'CoachBrief',
        params: { briefId: 'b-1' },
        initial: false,
      });
    });

    it('coach CoachBrief with the brief flag off does not open the brief', () => {
      mockFlags.coachBrief = false;
      const nav = makeNav(COACH_TABS);
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('CoachBrief', {}, 'nbr2');
      expect(nav.navigate).not.toHaveBeenCalledWith(
        'SettingsStack',
        expect.objectContaining({ screen: 'CoachBrief' }),
      );
      mockFlags.coachBrief = true;
    });
  });

  describe('coach nested destinations (real tab roots)', () => {
    it('Messages is a coach root tab', () => {
      const nav = makeNav(COACH_TABS);
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('Messages', { clientId: 'c1' });
      expect(nav.navigate).toHaveBeenCalledWith('Messages', { clientId: 'c1' });
    });

    it('NotificationCenter -> ClientsStack', () => {
      const nav = makeNav(COACH_TABS);
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('NotificationCenter');
      expect(nav.navigate).toHaveBeenCalledWith('ClientsStack', { screen: 'NotificationCenter', params: undefined });
    });

    it('hidden iOS: an AI budget push never opens the credit checkout; it lands on Settings', () => {
      mockHidden = true;
      const nav = makeNav(COACH_TABS);
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('CreditPackCheckout');
      expect(nav.navigate).toHaveBeenCalledWith('SettingsStack', { screen: 'SettingsHome', params: undefined });
    });

    it('CreditPackCheckout -> SettingsStack checkout when purchases are visible', () => {
      const nav = makeNav(COACH_TABS);
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('CreditPackCheckout');
      expect(nav.navigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CreditPackCheckout', params: undefined });
    });

    it('coach CommunityEventDetail -> CommunityStack events screen', () => {
      const nav = makeNav(COACH_TABS);
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('CommunityEventDetail', { eventId: 'ev-2' });
      expect(nav.navigate).toHaveBeenCalledWith('CommunityStack', {
        screen: 'CoachCommunityEvents',
        params: { eventId: 'ev-2' },
      });
    });

    it('coach community events when the CommunityStack tab is not mounted -> notification center', () => {
      const nav = makeNav(COACH_TABS.filter((n) => n !== 'CommunityStack'));
      attachPushNavigator(nav);
      setPushSession(COACH_A);
      routePushTap('CommunityEventDetail', { eventId: 'ev-2' });
      expect(nav.navigate).toHaveBeenCalledWith('ClientsStack', {
        screen: 'NotificationCenter',
        params: { eventId: 'ev-2' },
      });
    });
  });

  describe('readiness is an explicit app session (Sol B3)', () => {
    it('holds a tap during lean onboarding and delivers it once Home is mounted for the same user', () => {
      const nav = makeNav(LEAN_ROOT);
      attachPushNavigator(nav);
      setPushSession(pushSessionFor('onboarding', 'user-A'));
      routePushTap('Messages', undefined, 'n-lean');
      expect(flushPendingPushTap()).toBe(false);
      expect(nav.navigate).not.toHaveBeenCalled();
      nav.routeNames = CLIENT_TABS;
      setPushSession(pushSessionFor('student', 'user-A'));
      expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', params: undefined });
    });

    it('holds a tap during the coach wizard and delivers it once the coach navigator is mounted', () => {
      const nav = makeNav(WIZARD_ROOT);
      attachPushNavigator(nav);
      setPushSession(pushSessionFor('coach_wizard', 'user-A'));
      routePushTap('Messages', undefined, 'n-wiz');
      expect(nav.navigate).not.toHaveBeenCalled();
      nav.routeNames = COACH_TABS;
      setPushSession(pushSessionFor('coach', 'user-A'));
      expect(nav.navigate).toHaveBeenCalledWith('Messages', undefined);
    });

    it('holds a cold-start tap until the container is ready, then delivers once', () => {
      const nav = makeNav(CLIENT_TABS, false);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('NotificationCenter', undefined, 'cold-1');
      expect(nav.navigate).not.toHaveBeenCalled();
      nav.ready = true;
      expect(flushPendingPushTap()).toBe(true);
      expect(nav.navigate).toHaveBeenCalledTimes(1);
      expect(flushPendingPushTap()).toBe(false);
    });

    it('does not deliver while the role session is set but the old root is still committed', () => {
      const nav = makeNav(LEAN_ROOT);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('Messages', undefined, 'n-frame');
      expect(nav.navigate).not.toHaveBeenCalled();
      nav.routeNames = CLIENT_TABS;
      expect(flushPendingPushTap()).toBe(true);
    });

    it('pushSessionFor maps every onboarding root to a held state', () => {
      for (const s of ['onboarding', 'day1onboarding', 'day1win', 'coach_wizard']) {
        expect(pushSessionFor(s, 'u').kind).toBe('onboarding');
      }
      expect(pushSessionFor('loading', undefined).kind).toBe('unknown');
      expect(pushSessionFor('unauthenticated', null).kind).toBe('signedOut');
      expect(pushSessionFor('package_prompt', 'u')).toEqual({ kind: 'app', userId: 'u', role: 'student' });
      expect(pushSessionFor('coach', 'u')).toEqual({ kind: 'app', userId: 'u', role: 'coach' });
    });
  });

  describe('account isolation (Opus C3)', () => {
    it('a tap that arrives while signed out is dropped, never replayed into the next sign-in', () => {
      const auth = makeNav(AUTH_ROOT);
      attachPushNavigator(auth);
      setPushSession(pushSessionFor('unauthenticated', null));
      // getLastNotificationResponseAsync resolves AFTER the unauthenticated transition.
      routePushTap('Messages', { threadId: 'userA' }, 'late-cold');
      const next = makeNav(CLIENT_TABS);
      attachPushNavigator(next);
      setPushSession(pushSessionFor('student', 'user-B'));
      expect(flushPendingPushTap()).toBe(false);
      expect(next.navigate).not.toHaveBeenCalled();
    });

    it('a tap held during bootstrap is dropped when bootstrap resolves to signed out', () => {
      const nav = makeNav([]);
      attachPushNavigator(nav);
      routePushTap('Messages', undefined, 'boot');
      setPushSession(pushSessionFor('unauthenticated', null));
      nav.routeNames = CLIENT_TABS;
      setPushSession(pushSessionFor('student', 'user-B'));
      expect(nav.navigate).not.toHaveBeenCalled();
    });

    it('a tap held for user A is dropped when a different user B becomes the session', () => {
      const nav = makeNav(LEAN_ROOT);
      attachPushNavigator(nav);
      setPushSession(pushSessionFor('onboarding', 'user-A'));
      routePushTap('Messages', undefined, 'nA');
      nav.routeNames = CLIENT_TABS;
      setPushSession(pushSessionFor('student', 'user-B'));
      expect(nav.navigate).not.toHaveBeenCalled();
      expect(flushPendingPushTap()).toBe(false);
    });

    it('a tap held during bootstrap binds to the first signed-in user and is delivered to them', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      routePushTap('Messages', undefined, 'boot-A');
      setPushSession(pushSessionFor('student', 'user-A'));
      expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', params: undefined });
    });
  });

  describe('payload decoding and dedupe (Sol C2)', () => {
    it('dedupes the cold-start replay against the live listener', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('Messages', undefined, 'same-id');
      routePushTap('Messages', undefined, 'same-id');
      expect(nav.navigate).toHaveBeenCalledTimes(1);
    });

    it('the delivered-id set is bounded (oldest id evicted)', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      for (let i = 0; i <= MAX_SEEN_IDS; i += 1) routePushTap('Messages', undefined, `id-${i}`);
      expect(nav.navigate).toHaveBeenCalledTimes(MAX_SEEN_IDS + 1);
      routePushTap('Messages', undefined, 'id-0'); // evicted, so treated as new
      expect(nav.navigate).toHaveBeenCalledTimes(MAX_SEEN_IDS + 2);
      routePushTap('Messages', undefined, `id-${MAX_SEEN_IDS}`); // still remembered
      expect(nav.navigate).toHaveBeenCalledTimes(MAX_SEEN_IDS + 2);
    });

    it('ignores taps with no or malformed actionScreen', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap(undefined);
      routePushTap('../Admin');
      routePushTap('a'.repeat(100));
      expect(nav.navigate).not.toHaveBeenCalled();
    });

    it('decodePushParams keeps bounded string params only', () => {
      expect(decodePushParams(null)).toBeUndefined();
      expect(decodePushParams(['x'])).toBeUndefined();
      expect(decodePushParams({ a: 'ok', b: { nested: 1 }, 'bad key': 'x', n: 3, long: 'x'.repeat(201) })).toEqual({
        a: 'ok',
        n: '3',
      });
      const many: Record<string, string> = {};
      for (let i = 0; i < 20; i += 1) many[`k${i}`] = 'v';
      expect(Object.keys(decodePushParams(many) ?? {})).toHaveLength(8);
    });

    it('a tap routed with unsafe params delivers only the decoded ones', () => {
      const nav = makeNav(CLIENT_TABS);
      attachPushNavigator(nav);
      setPushSession(STUDENT_A);
      routePushTap('Messages', { threadId: 't1', evil: { $where: 1 } });
      expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', params: { threadId: 't1' } });
    });
  });
});
