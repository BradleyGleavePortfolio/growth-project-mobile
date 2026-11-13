/**
 * LS-938R2 B1: the server's existing space links must reach the chat.
 * Real URL parser, push queue, role routing and notification normalization.
 * Only the navigator and build-time flags are doubled. No network calls.
 */
import { incomingLinkPath, resolveAppLink } from '../incomingLinks';
import {
  __resetPushTapRouterForTests, attachPushNavigator, routeAppLink,
  routePushTap, setPushSession,
} from '../../services/pushTapRouter';
import { normalizeNotification } from '../../services/notificationsApi';

const mockFlags = {
  communityTab: true, coachCommunity: true, communitySpaceChat: true,
  communityEvents: true, coachTabsV2: true,
};
jest.mock('../../config/featureFlags', () => ({
  get featureFlags() { return mockFlags; },
}));

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MESSAGE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const nav = {
  isReady: () => true,
  getRootState: () => ({
    routeNames: ['Home', 'CommunityTab', 'ClientsStack', 'CommunityStack'],
  }),
  navigate: jest.fn(),
};

beforeEach(() => {
  __resetPushTapRouterForTests();
  nav.navigate.mockReset();
  attachPushNavigator(nav);
});

it('positive control: a supported existing thread URL reaches its thread', () => {
  setPushSession({ kind: 'app', role: 'student', userId: 'viewer' });
  routeAppLink(`community/thread/${MESSAGE}`);
  expect(nav.navigate).toHaveBeenCalledWith('CommunityTab', {
    screen: 'CommunityThread', params: { postId: MESSAGE }, initial: false,
  });
});

it.each(['student', 'coach'] as const)(
  'LS938R2 B1: %s opening a backend cohort URL reaches that space chat',
  (role) => {
    const path = incomingLinkPath(`tgp://community/cohorts/${SPACE}`)!;
    expect(resolveAppLink(path, role)).toMatchObject({
      root: role === 'student' ? 'CommunityTab' : 'CommunityStack',
      screen: 'CommunitySpaceChat', params: { cohortId: SPACE },
    });
  },
);

it.each(['student', 'coach'] as const)(
  'LS938R2 B1: %s reply push keeps the backend message query parameter',
  (role) => {
    setPushSession({ kind: 'app', role, userId: 'viewer' });
    // community-space-push.service.ts:140: replies and high alerts carry ?message=.
    routePushTap('Community', undefined, 'space-push', `tgp://community/cohorts/${SPACE}?message=${MESSAGE}`);
    expect(nav.navigate).toHaveBeenCalledWith(
      role === 'student' ? 'CommunityTab' : 'CommunityStack',
      expect.objectContaining({
        screen: 'CommunitySpaceChat', params: { cohortId: SPACE, messageId: MESSAGE },
      }),
    );
  },
);

it('LS938R2 B1: an in-app space notification opens the message, not the Community root', () => {
  setPushSession({ kind: 'app', role: 'student', userId: 'viewer' });
  const notice = normalizeNotification({
    id: 'notice', kind: 'community_message_received', body: 'A new space message.',
    payload: {}, deep_link: `tgp://community/cohorts/${SPACE}?message=${MESSAGE}`,
    created_at: '2026-11-05T20:00:00Z', read_at: null,
  })!;
  // NotificationCenterScreen.tsx:86-89 dispatches this same tuple.
  routePushTap(notice.actionScreen, notice.actionParams, undefined, notice.deepLink);
  expect(nav.navigate).toHaveBeenCalledWith('CommunityTab', expect.objectContaining({
    screen: 'CommunitySpaceChat', params: { cohortId: SPACE, messageId: MESSAGE },
  }));
});
