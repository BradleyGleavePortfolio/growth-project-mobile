/**
 * The rings Home's one notice slot (UI-1 spec item 9): of the notices due, only the most urgent shows;
 * when it is dismissed or resolved the next one shows. Outside the slot, today's Home stacks them all.
 */
import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
const mockGetPerms = jest.fn(async () => ({ status: 'undetermined', canAskAgain: true }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: () => mockGetPerms() }));
jest.mock('../../../services/pushNotifications', () => ({ registerForPushNotifications: jest.fn() }));
jest.mock('../../../services/api', () => ({ usersApi: { updatePushToken: jest.fn() } }));
const mockPrefs = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  prefsStorage: { getStringAsync: async (k: string) => mockPrefs.get(k), set: async (k: string, v: string) => void mockPrefs.set(k, v) },
}));
const mockUser: { id: string; coach_id: string; profile: Record<string, unknown> } = { id: 'u1', coach_id: '', profile: {} };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

import { HomeNoticeSlot, NOTICE_RANK, useNoticeSlot, type NoticeId } from '../HomeNoticeSlot';
import PushPermissionCard from '../PushPermissionCard';
import FullMacrosIntroCard from '../FullMacrosIntroCard';
import ProfileNudge from '../ProfileNudge';
import { track } from '../../../lib/analytics';
import { __resetMacroDisplayStoreForTests, hydrateMacroDisplay, reportMacroDisplay } from '../../../macros/macroDisplayStore';

/** A stand-in notice: due until tapped (dismissed). */
function Notice({ id }: { id: NoticeId }) {
  const [due, setDue] = useState(true);
  const shown = useNoticeSlot(id, due);
  return shown ? <Pressable onPress={() => setDue(false)}><Text>{id}</Text></Pressable> : null;
}
// In reverse, so the rank decides, not the order they are written in.
const everyNotice = [...NOTICE_RANK].reverse().map((id) => <Notice key={id} id={id} />);
const visible = () => NOTICE_RANK.filter((id) => screen.queryByText(id));

beforeEach(() => {
  jest.clearAllMocks();
  mockPrefs.clear();
  mockUser.profile = {};
  __resetMacroDisplayStoreForTests();
});

it('one at a time, most urgent first: dunning, invite, Finish joining, profile, push, then the rest; each dismissal shows the next', async () => {
  expect(NOTICE_RANK).toEqual(['dunning', 'invite', 'finishJoining', 'profile', 'push', 'coachIntro', 'fullMacros', 'tourReoffer']);
  await render(<HomeNoticeSlot style={{ marginTop: 24 }}>{everyNotice}</HomeNoticeSlot>);
  for (const id of NOTICE_RANK) {
    expect(visible()).toEqual([id]); // with dunning and the invite both due, only dunning
    expect(screen.getByTestId('home-notice-slot').props.style).toEqual({ marginTop: 24 });
    await fireEvent.press(screen.getByText(id));
  }
  expect(visible()).toEqual([]);
  expect(screen.getByTestId('home-notice-slot').props.style).toBeUndefined(); // an empty slot leaves no gap
});

it("outside the slot (today's Home) every notice that is due shows, as before", async () => {
  await render(<>{everyNotice}</>);
  expect(visible()).toEqual([...NOTICE_RANK]);
});

it('the real notices: Not now on the push card shows the next one due, the full macros card', async () => {
  await hydrateMacroDisplay('u1');
  reportMacroDisplay({ macro_display_mode: 'simple', simple_until: '2000-01-01' });
  await render(
    <HomeNoticeSlot>
      <PushPermissionCard presentation="section" />
      <FullMacrosIntroCard carbsG={185} fatG={50} />
    </HomeNoticeSlot>,
  );
  expect(await screen.findByTestId('push-permission-card')).toBeTruthy();
  expect(screen.queryByTestId('full-macros-intro-card')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Not now'));
  expect(await screen.findByTestId('full-macros-intro-card')).toBeTruthy();
  expect(screen.queryByTestId('push-permission-card')).toBeNull();
});

it('Finish your profile outranks push and still opens Edit profile', async () => {
  await render(
    <HomeNoticeSlot>
      <PushPermissionCard presentation="section" />
      <ProfileNudge hasCoachPlan={false} hasTargets />
    </HomeNoticeSlot>,
  );
  const nudge = await screen.findByLabelText(/^Complete your profile\. Missing .+\.$/);
  expect(screen.getByText('FINISH YOUR PROFILE')).toBeTruthy();
  expect(screen.queryByTestId('push-permission-card')).toBeNull();
  expect(track).toHaveBeenCalledWith('profile_nudge_shown', expect.objectContaining({ missing_count: expect.any(Number) }));
  await fireEvent.press(nudge);
  expect(track).toHaveBeenCalledWith('profile_edit_opened', { source: 'home_nudge' });
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'EditProfile' });
});
