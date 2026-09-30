import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  clearPendingPushTap,
  flushPendingPushTap,
  routePushTap,
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

const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab'];

describe('pushTapRouter', () => {
  beforeEach(() => __resetPushTapRouterForTests());

  it('routes a client Messages tap into the Home tab stack', () => {
    const nav = makeNav(CLIENT_TABS);
    attachPushNavigator(nav);
    routePushTap('Messages', { threadId: 't1' }, 'n1');
    expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', params: { threadId: 't1' } });
  });

  it('routes Timeline into the More tab', () => {
    const nav = makeNav(CLIENT_TABS);
    attachPushNavigator(nav);
    routePushTap('Timeline');
    expect(nav.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'Timeline', params: undefined });
  });

  it('navigates directly when the root navigator owns the route (coach)', () => {
    const nav = makeNav(['CoachTabs', 'Messages']);
    attachPushNavigator(nav);
    routePushTap('Messages', { clientId: 'c1' });
    expect(nav.navigate).toHaveBeenCalledWith('Messages', { clientId: 'c1' });
  });

  it('holds a cold-start tap until the navigator is ready, then delivers once', () => {
    const nav = makeNav(CLIENT_TABS, false);
    attachPushNavigator(nav);
    routePushTap('NotificationCenter', undefined, 'cold-1');
    expect(nav.navigate).not.toHaveBeenCalled();
    nav.ready = true;
    expect(flushPendingPushTap()).toBe(true);
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(flushPendingPushTap()).toBe(false);
  });

  it('holds while the auth stack is mounted (signed out / signing in)', () => {
    const nav = makeNav(['Welcome', 'Login', 'CreateAccount']);
    attachPushNavigator(nav);
    routePushTap('Messages');
    expect(nav.navigate).not.toHaveBeenCalled();
    nav.routeNames = CLIENT_TABS;
    expect(flushPendingPushTap()).toBe(true);
    expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', params: undefined });
  });

  it('dedupes the cold-start replay against the live listener', () => {
    const nav = makeNav(CLIENT_TABS);
    attachPushNavigator(nav);
    routePushTap('Messages', undefined, 'same-id');
    routePushTap('Messages', undefined, 'same-id');
    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });

  it('ignores taps with no actionScreen', () => {
    const nav = makeNav(CLIENT_TABS);
    attachPushNavigator(nav);
    routePushTap(undefined);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('C3: a tap held while signed out is dropped at sign-out and never replays into the next session', () => {
    const auth = makeNav(['Welcome', 'Login']);
    attachPushNavigator(auth);
    routePushTap('Messages', { threadId: 'userA' }, 'nA');
    expect(auth.navigate).not.toHaveBeenCalled();
    clearPendingPushTap(); // RootNavigator does this on authState 'unauthenticated'
    const next = makeNav(CLIENT_TABS);
    attachPushNavigator(next);
    expect(flushPendingPushTap()).toBe(false);
    expect(next.navigate).not.toHaveBeenCalled();
  });

  it('a community event tap reaches CommunityEventDetail with its params (the screen owns the purchase-link gate)', () => {
    const nav = makeNav(['CoachTabs', 'CommunityEventDetail']);
    attachPushNavigator(nav);
    routePushTap('CommunityEventDetail', { eventId: 'ev-1' }, 'nE');
    expect(nav.navigate).toHaveBeenCalledWith('CommunityEventDetail', { eventId: 'ev-1' });
  });
});
