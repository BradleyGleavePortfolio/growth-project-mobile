/**
 * SC-M1 (agent 168): communitySpaceChat. Off (the default): SpaceTree opens today's CommunitySpace and the coach space
 * list opens CoachCommunityCohortDetail, and neither stack registers CommunitySpaceChat. On: both open the chat, and the
 * Community tab is the chat-capable Community Home even with communityHomeV2 off (FX-871, Sol B1 on m#871).
 */
import * as fs from 'fs';
import * as path from 'path';
import { renderHook } from '@testing-library/react-native';

const mockFlags = { communitySpaceChat: false };
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockNav = { navigate: jest.fn(), replace: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
jest.mock('../../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));

const { useOpenSpaceTarget } = require('../../components/community/SpaceTree');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

beforeEach(() => { mockNav.navigate.mockReset(); mockNav.replace.mockReset(); });

it('defaults off and is read from its literal key', () => {
  expect(read('config/featureFlags.ts')).toContain("communitySpaceChat: readFlag('EXPO_PUBLIC_FF_COMMUNITY_SPACE_CHAT', false)");
});

it('both stacks register the chat only behind the flag', () => {
  for (const nav of ['navigation/CommunityNavigator.tsx', 'navigation/CoachCommunityNavigator.tsx']) {
    const lines = read(nav).split('\n').filter((l) => l.includes('name="CommunitySpaceChat"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\{featureFlags\.communitySpaceChat \? </);
  }
});

it('flag off: a space opens today\'s screen; flag on: it opens the chat (drawer replaces)', async () => {
  const open = (await renderHook(() => useOpenSpaceTarget(false))).result.current;
  const drawer = (await renderHook(() => useOpenSpaceTarget(true))).result.current;
  open({ kind: 'space', id: 'c1' });
  drawer({ kind: 'space', id: 'c1' });
  expect(mockNav.navigate).toHaveBeenCalledWith('CommunitySpace', { space: 'cohort', cohortId: 'c1' });
  expect(mockNav.replace).toHaveBeenCalledWith('CommunitySpace', { space: 'cohort', cohortId: 'c1' });
  mockFlags.communitySpaceChat = true;
  open({ kind: 'space', id: 'c2' });
  drawer({ kind: 'space', id: 'c2' });
  expect(mockNav.navigate).toHaveBeenLastCalledWith('CommunitySpaceChat', { cohortId: 'c2' });
  expect(mockNav.replace).toHaveBeenLastCalledWith('CommunitySpaceChat', { cohortId: 'c2' });
  mockFlags.communitySpaceChat = false;
});

it('the coach space list keeps CoachCommunityCohortDetail when off', () => {
  const src = read('screens/community/CoachCommunityCohortsScreen.tsx');
  expect(src).toMatch(/featureFlags\.communitySpaceChat\s*\?\s*navigation\.navigate\('CommunitySpaceChat', \{ cohortId: item\.id \}\)\s*:\s*navigation\.navigate\('CoachCommunityCohortDetail'/);
});

it('flag on selects the chat-capable Community Home, so no space opens inline or through the old space page', () => {
  const lines = read('navigation/CommunityNavigator.tsx').split('\n').filter((l) => l.includes('name="CommunityTab"'));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('component={featureFlags.communityHomeV2 || featureFlags.communitySpaceChat ? CommunityHomeScreen : CommunityTabScreen}');
});

it('FR-871R5 (m#879 Opus B2): the tab bar steps aside while the space chat is open (full screen, GOAL 05b)', () => {
  const nav = read('navigation/ClientNavigator.tsx');
  const tab = nav.slice(nav.indexOf('name="CommunityTab"'), nav.indexOf('</Tab.Navigator>'));
  expect(tab).toMatch(/options=\{\(\{ route \}\) => \(\{/);
  expect(tab).toContain("...(getFocusedRouteNameFromRoute(route) === 'CommunitySpaceChat' ? { tabBarStyle: { display: 'none' as const } } : {}),");
  expect(nav).toContain("import { getFocusedRouteNameFromRoute } from '@react-navigation/native';");
});
