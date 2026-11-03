import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { lightTokens } from '../../theme/tokens';
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

/**
 * LO-922 own-PR finding (outside m#922's diff, on mobile main too): a refused claim clears the saved
 * code (4xx), then the banner re-reads storage 1.5 s later and hides, so the refusal line (m#922's
 * not-accepting words, or an expired code's line) is on screen for 1.5 s only and the client is left
 * with no banner, no line and no way to act on "try your code again".
 */
const NOT_ACCEPTING =
  'Your coach is not accepting new clients through the app right now. Let them know, then try your code again.';

it('LO-922 own-PR: the refused-join line is still readable 3 s after Attach', async () => {
  mockAttach.mockRejectedValue({ response: { status: 404, data: { error: 'PACKAGE_NOT_FOUND', message: 'Package not available' } } });
  await writePendingInviteCode('GP-TEST');
  await mount();
  await screen.findByLabelText('Attach invite code');
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(screen.getByText(NOT_ACCEPTING)).toBeTruthy();
  await act(async () => { await new Promise((r) => setTimeout(r, 3000)); });
  expect(screen.queryByText(NOT_ACCEPTING)).toBeTruthy();
});
