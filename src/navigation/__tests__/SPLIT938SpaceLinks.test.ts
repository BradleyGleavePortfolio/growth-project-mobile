/**
 * SPLIT-938 part 4 (agent 199), LS-938R2 B1's edges: the space link opens the chat only with the space chat on, only
 * for a coach with the coach community on, keeps ?message= only when it is an id, and a push whose link this build
 * cannot open still lands on its Community screen (the fallback it had before).
 */
import { incomingLinkPath, resolveAppLink } from '../incomingLinks';
import {
  __resetPushTapRouterForTests, attachPushNavigator, routePushTap, setPushSession,
} from '../../services/pushTapRouter';

const mockFlags = { communityTab: true, coachCommunity: true, communitySpaceChat: true, coachTabsV2: true };
jest.mock('../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MESSAGE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const nav = {
  isReady: () => true,
  getRootState: () => ({ routeNames: ['Home', 'CommunityTab', 'ClientsStack', 'CommunityStack'] }),
  navigate: jest.fn(),
};
const link = (url: string) => incomingLinkPath(url)!;

beforeEach(() => {
  Object.assign(mockFlags, { communityTab: true, coachCommunity: true, communitySpaceChat: true });
  __resetPushTapRouterForTests();
  nav.navigate.mockReset();
  attachPushNavigator(nav);
});

it.each([
  ['the space chat off (student)', { communitySpaceChat: false }, 'student'],
  ['the space chat off (coach)', { communitySpaceChat: false }, 'coach'],
  ['the coach community off (coach)', { coachCommunity: false }, 'coach'],
  ['the community tab off (student)', { communityTab: false }, 'student'],
] as const)('no chat target with %s', (_name, flags, role) => {
  Object.assign(mockFlags, flags);
  expect(resolveAppLink(link(`tgp://community/cohorts/${SPACE}?message=${MESSAGE}`), role)).toBeNull();
});

it.each([
  ['a message id', `?message=${MESSAGE}`, { cohortId: SPACE, messageId: MESSAGE }],
  ['no message', '', { cohortId: SPACE }],
  ['a message that is not an id', '?message=../../x', { cohortId: SPACE }],
])('a space link with %s', (_name, query, params) => {
  expect(resolveAppLink(link(`tgp://community/cohorts/${SPACE}${query}`), 'student')?.params).toEqual(params);
  expect(resolveAppLink(link(`https://app.trygrowthproject.com/community/cohorts/${SPACE}${query}`), 'coach')?.params).toEqual(params);
});

it.each([`community/cohorts/not-an-id`, `community/cohorts/${SPACE}/extra`, `community/cohorts`])('no chat target for %s', (path) => {
  expect(resolveAppLink(path, 'student')).toBeNull();
  expect(resolveAppLink(path, 'coach')).toBeNull();
});

it('a student push with the space chat off still opens the Community tab', () => {
  mockFlags.communitySpaceChat = false;
  setPushSession({ kind: 'app', role: 'student', userId: 'viewer' });
  routePushTap('Community', undefined, 'space-push-off', `tgp://community/cohorts/${SPACE}?message=${MESSAGE}`);
  expect(nav.navigate).toHaveBeenCalledTimes(1);
  expect(nav.navigate.mock.calls[0][0]).toBe('CommunityTab');
  expect(nav.navigate.mock.calls[0][1]?.screen).not.toBe('CommunitySpaceChat');
});

it('the same push id opens once', () => {
  setPushSession({ kind: 'app', role: 'student', userId: 'viewer' });
  routePushTap('Community', undefined, 'space-push-twice', `tgp://community/cohorts/${SPACE}`);
  routePushTap('Community', undefined, 'space-push-twice', `tgp://community/cohorts/${SPACE}`);
  expect(nav.navigate).toHaveBeenCalledTimes(1);
});

it('signed out: a space push is dropped, not held for the next account', () => {
  setPushSession({ kind: 'signedOut' });
  routePushTap('Community', undefined, 'space-push-out', `tgp://community/cohorts/${SPACE}`);
  setPushSession({ kind: 'app', role: 'student', userId: 'next' });
  expect(nav.navigate).not.toHaveBeenCalled();
});
