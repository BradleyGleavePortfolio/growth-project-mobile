import React from 'react';
import { StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { darkTokens, lightTokens } from '../../theme/tokens';
import { queryClient } from '../../services/queryClient';
import { readPendingInviteCode, writePendingInviteCode } from '../../lib/pendingInviteCode';
import PendingInviteBanner from '../PendingInviteBanner';

const mockAttach = jest.fn();
const mockPreview = jest.fn();
const mockPatchUserCache = jest.fn();
const mockRefreshEntitlement = jest.fn();
let mockAttached = false;
let mockSharingVersion: string | null = 'coach_sharing_join_v1';
let mockColors = lightTokens;

jest.mock('../../services/api', () => ({
  authApi: {
    attachInviteCode: (...args: unknown[]) => mockAttach(...args),
    getInvitePreview: (...args: unknown[]) => mockPreview(...args),
  },
}));
jest.mock('../../lib/userCache', () => ({
  patchUserCache: (...args: unknown[]) => mockPatchUserCache(...args),
}));
jest.mock('../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ refreshEntitlement: mockRefreshEntitlement }),
}));
jest.mock('../../lib/coachSharingNotice', () => ({
  ...jest.requireActual('../../lib/coachSharingNotice'),
  useCoachSharingNotice: () => mockSharingVersion,
}));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: mockColors, colors: { textSecondary: mockColors.textMuted } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function HomeProbe() {
  const { data } = useQuery({
    queryKey: ['coachless', 'home'],
    queryFn: async () => ({ eligible: !mockAttached }),
    staleTime: Infinity,
    retry: false,
  });
  return data?.eligible ? <Text>Home: choose a coach</Text> : null;
}

async function mount(withHome = false) {
  await render(
    <QueryClientProvider client={queryClient}>
      <PendingInviteBanner />
      {withHome ? <HomeProbe /> : null}
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  queryClient.clear();
  await AsyncStorage.clear();
  mockAttached = false;
  mockSharingVersion = 'coach_sharing_join_v1';
  mockColors = lightTokens;
  mockAttach.mockImplementation(async () => {
    mockAttached = true;
    return { data: { coach_id: 'coach-1' } };
  });
  mockPreview.mockResolvedValue({ data: { valid: true, coach_name: 'Alex Rivera' } });
  mockPatchUserCache.mockResolvedValue(undefined);
  mockRefreshEntitlement.mockResolvedValue(true);
});

afterEach(() => { queryClient.clear(); });

it('renders nothing and makes no preview or attach call without a saved code', async () => {
  await mount();
  expect(screen.queryByTestId('pending-invite-banner')).toBeNull();
  expect(mockPreview).not.toHaveBeenCalled();
  expect(mockAttach).not.toHaveBeenCalled();
});

it('names the previewed coach and preserves the explicit sharing/Attach control', async () => {
  await writePendingInviteCode('GP-TEST');
  await mount();
  expect(await screen.findByText('Invite from Alex Rivera. Attach "GP-TEST" to your account.')).toBeTruthy();
  expect(mockPreview).toHaveBeenCalledWith('GP-TEST');
  expect(screen.getByText(/Joining shares .* with Alex Rivera\./)).toBeTruthy();
  expect(screen.getByLabelText('Attach invite code')).toBeTruthy();
  expect(screen.getByLabelText('Dismiss invite code')).toBeTruthy();
  expect(mockAttach).not.toHaveBeenCalled();
  expect(mockRefreshEntitlement).not.toHaveBeenCalled();
});

it.each([
  { valid: false, coach_name: 'Not confirmed' },
  { valid: true, coach_name: '  ' },
])('never invents a coach name from an unusable preview (%p)', async (data) => {
  mockPreview.mockResolvedValue({ data });
  await writePendingInviteCode('GP-TEST');
  await mount();
  expect(await screen.findByText('Attach "GP-TEST" to your account.')).toBeTruthy();
  expect(screen.queryByText(/Invite from/)).toBeNull();
});

it('a failed preview leaves Attach usable, without claiming the code automatically', async () => {
  mockPreview.mockRejectedValue(new Error('offline'));
  await writePendingInviteCode('GP-TEST');
  await mount();
  await screen.findByText('Attach "GP-TEST" to your account.');
  expect(mockAttach).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(mockAttach).toHaveBeenCalledWith('GP-TEST', 'coach_sharing_join_v1');
});

it('refreshes the shared entitlement and mounted Home query after a successful explicit attach', async () => {
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  await writePendingInviteCode('GP-TEST');
  await mount(true);
  await screen.findByText('Home: choose a coach');
  await screen.findByLabelText('Attach invite code');
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(mockAttach).toHaveBeenCalledWith('GP-TEST', 'coach_sharing_join_v1');
  expect(mockPatchUserCache).toHaveBeenCalledWith({ coach_id: 'coach-1' });
  expect(mockRefreshEntitlement).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coachless', 'home'] });
  await waitFor(() => expect(screen.queryByText('Home: choose a coach')).toBeNull());
  expect(await readPendingInviteCode()).toBeNull();
  expect(screen.getByText('Invite attached to your account.')).toBeTruthy();
});

it('keeps a failed attach retryable and does not refresh access or Home', async () => {
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  mockAttach.mockRejectedValue({ response: { status: 503 } });
  await writePendingInviteCode('GP-TEST');
  await mount();
  await screen.findByLabelText('Attach invite code');
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(screen.getByText('The invite could not be attached right now. Try Attach again.')).toBeTruthy();
  expect(await readPendingInviteCode()).toBe('GP-TEST');
  expect(mockRefreshEntitlement).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Attach invite code').props.accessibilityState.disabled).toBe(false);
});

it('preserves a specific permanent refusal and the existing clear-on-4xx behavior', async () => {
  mockAttach.mockRejectedValue({ response: { status: 410, data: { message: 'This code has expired.' } } });
  await writePendingInviteCode('GP-TEST');
  await mount();
  await screen.findByLabelText('Attach invite code');
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(screen.getByText('This code has expired.')).toBeTruthy();
  expect(await readPendingInviteCode()).toBeNull();
  expect(mockRefreshEntitlement).not.toHaveBeenCalled();
});

it('a permanent refusal without server copy tells the client to request a new code', async () => {
  mockAttach.mockRejectedValue({ response: { status: 404 } });
  await writePendingInviteCode('GP-TEST');
  await mount();
  await screen.findByLabelText('Attach invite code');
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(screen.getByText('This invite is not available. Ask the coach for a new code.')).toBeTruthy();
  expect(await readPendingInviteCode()).toBeNull();
});

it('a failed entitlement re-read does not turn a successful attachment into an attach error', async () => {
  mockRefreshEntitlement.mockRejectedValue(new Error('refresh unavailable'));
  await writePendingInviteCode('GP-TEST');
  await mount();
  await screen.findByLabelText('Attach invite code');
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(screen.getByText('Invite attached to your account.')).toBeTruthy();
  expect(mockAttach).toHaveBeenCalledTimes(1);
  expect(await readPendingInviteCode()).toBeNull();
});

it('Dismiss clears the code and hides the banner without attaching or refreshing access', async () => {
  await writePendingInviteCode('GP-TEST');
  await mount();
  await screen.findByLabelText('Dismiss invite code');
  await fireEvent.press(screen.getByLabelText('Dismiss invite code'));
  expect(screen.queryByTestId('pending-invite-banner')).toBeNull();
  expect(await readPendingInviteCode()).toBeNull();
  expect(mockAttach).not.toHaveBeenCalled();
  expect(mockRefreshEntitlement).not.toHaveBeenCalled();
});

it('a foreground invite refreshes the mounted banner and its coach preview', async () => {
  await mount();
  await act(async () => { await writePendingInviteCode('GP-NEW'); });
  expect(await screen.findByText('Invite from Alex Rivera. Attach "GP-NEW" to your account.')).toBeTruthy();
  expect(mockPreview).toHaveBeenCalledWith('GP-NEW');
  expect(mockAttach).not.toHaveBeenCalled();
});

it('does not add a sharing version when the production policy advertises none', async () => {
  mockSharingVersion = null;
  await writePendingInviteCode('GP-TEST');
  await mount();
  await screen.findByLabelText('Attach invite code');
  expect(screen.queryByTestId('coach-sharing-notice')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(mockAttach).toHaveBeenCalledWith('GP-TEST', null);
});

it.each([lightTokens, darkTokens])('retains theme colours, readable copy and both 44 pt actions', async (colors) => {
  mockColors = colors;
  await writePendingInviteCode('GP-TEST');
  await mount();
  const copy = await screen.findByText('Invite from Alex Rivera. Attach "GP-TEST" to your account.');
  expect(StyleSheet.flatten(copy.props.style)).toMatchObject({ color: colors.textMuted, fontSize: 14 });
  expect(copy.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(screen.getByText('Attach').props.style).color).toBe(colors.accentText);
  for (const label of ['Attach invite code', 'Dismiss invite code']) {
    expect(StyleSheet.flatten(screen.getByLabelText(label).props.style)).toMatchObject({
      minHeight: 44, minWidth: 44,
    });
  }
});
