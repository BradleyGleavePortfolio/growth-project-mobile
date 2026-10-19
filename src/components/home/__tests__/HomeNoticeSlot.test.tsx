/**
 * The rings Home's one notice slot (UI-1 spec item 9): of the notices due, only the most urgent shows;
 * when it is dismissed or resolved the next one shows. Outside the slot, today's Home stacks them all.
 */
import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

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
import ProfileNudge, { profileNudgeHiddenKey } from '../ProfileNudge';
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

it('one at a time, most urgent first, Finish joining ahead of push (#RINGS-JOIN-FIRST), Finish your profile last; each dismissal shows the next', async () => {
  expect(NOTICE_RANK).toEqual(['invite', 'finishJoining', 'push', 'coachIntro', 'fullMacros', 'tourReoffer', 'profile']);
  await render(<HomeNoticeSlot style={{ marginTop: 24 }}>{everyNotice}</HomeNoticeSlot>);
  for (const id of NOTICE_RANK) {
    expect(visible()).toEqual([id]); // with Finish joining and push both due, only Finish joining
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

it('Finish your profile waits behind push, opens Edit profile, and Not now hides it for 3 days, in the slot only (#RINGS-HIDE-DAYS)', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const real = Date.now;
  let ahead = 0; // how far the phone's clock has moved on since the tap
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => real() + ahead);
  try {
    const slot = () => <HomeNoticeSlot><ProfileNudge hasCoachPlan={false} hasTargets /><PushPermissionCard presentation="section" /></HomeNoticeSlot>;
    await render(slot());
    expect(await screen.findByTestId('push-permission-card')).toBeTruthy();
    expect(screen.queryByText('FINISH YOUR PROFILE')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Not now'));
    const nudge = await screen.findByLabelText(/^Complete your profile\. Missing .+\.$/);
    expect(track).toHaveBeenCalledWith('profile_nudge_shown', expect.objectContaining({ missing_count: expect.any(Number) }));
    await fireEvent.press(nudge);
    expect(track).toHaveBeenCalledWith('profile_edit_opened', { source: 'home_nudge' });
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'EditProfile' });
    const before = Date.now();
    await fireEvent.press(screen.getByLabelText('Not now'));
    const after = Date.now();
    expect(screen.queryByTestId('profile-nudge')).toBeNull();
    const until = Number(mockPrefs.get(profileNudgeHiddenKey('u1')));
    expect(until).toBeGreaterThanOrEqual(before + 3 * DAY); // 3 days, not 7
    expect(until).toBeLessThanOrEqual(after + 3 * DAY);
    await screen.unmount();
    ahead = 3 * DAY - 60_000; // reopened a minute before the 3 days end: still hidden
    await render(slot()); await act(async () => undefined);
    expect(screen.queryByTestId('profile-nudge')).toBeNull();
    await screen.unmount();
    await render(<ProfileNudge hasCoachPlan={false} hasTargets />); // today's Home: as before, no Not now
    expect(screen.getByText('FINISH YOUR PROFILE')).toBeTruthy();
    expect(screen.queryByLabelText('Not now')).toBeNull();
    await screen.unmount();
    ahead = 3 * DAY; // the 3 days are over: it is back
    await render(slot());
    expect(await screen.findByTestId('profile-nudge')).toBeTruthy();
  } finally {
    clock.mockRestore();
  }
});
