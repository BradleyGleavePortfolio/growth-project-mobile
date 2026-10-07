/** B-SHARE-127: the code sheet's Join is the share; sentence above Join and field on redeem only when advertised. */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPolicy = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  authApi: { getSignupPolicy: () => mockPolicy() },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ refreshEntitlement: async () => undefined }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({ patchUserCache: async () => undefined }));

import CoachCodeSheet from '../CoachCodeSheet';
import { resetCoachSharingNoticeForTests } from '../../../lib/coachSharingNotice';

const COACH = { id: 'coach-1', name: 'Alex Rivera', photo_url: null, business_name: null, bio: null };
const SENTENCE =
  'Joining shares your workouts, food logs, weigh-ins and check-ins with Alex Rivera. Change this any time in Settings > Privacy.';

const REDEEMED = { status: 'attached', already_attached: false, coach: COACH, next: { featured_package: null, packages_available: 0 }, grant: null, replayed: false };

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachSharingNoticeForTests();
  mockPost.mockImplementation(async (url: string) => {
    if (url === '/coachless/coach-code/check') return { data: { valid: true, coach: COACH } };
    if (url === '/coachless/coach-code/redeem') return { data: REDEEMED };
    throw new Error(`unexpected POST ${url}`);
  });
});

function renderSheet() {
  return render(
    <CoachCodeSheet
      visible
      initialCode="GP-TOP"
      onClose={jest.fn()}
      onAttached={jest.fn()}
      onChoosePlan={jest.fn()}
      onMessageCoach={jest.fn()}
      debounceMs={0}
    />,
  );
}

async function joinAndReadBody(): Promise<unknown> {
  await fireEvent.press(screen.getByTestId('coach-code-join'));
  await waitFor(() => expect(mockPost.mock.calls.some((c) => c[0] === '/coachless/coach-code/redeem')).toBe(true));
  return mockPost.mock.calls.find((c) => c[0] === '/coachless/coach-code/redeem')?.[1];
}

it('current production policy: no sentence on the sheet and the old redeem body', async () => {
  mockPolicy.mockResolvedValue({ data: { invite_code_required: true, providers: ['email'] } });
  await renderSheet();
  expect(await screen.findByText('Coach: Alex Rivera')).toBeTruthy();
  await waitFor(() => expect(mockPolicy).toHaveBeenCalled());
  expect(screen.queryByTestId('coach-sharing-notice')).toBeNull();
  expect(await joinAndReadBody()).toEqual({ code: 'GP-TOP' });
});

it('advertised version: the sentence names the coach above Join and the version rides on the redeem', async () => {
  mockPolicy.mockResolvedValue({
    data: { coach_sharing_notice: 'coach_sharing_join_v1', coach_sharing_notice_field: 'coach_sharing_notice' },
  });
  await renderSheet();
  expect(await screen.findByText(SENTENCE)).toBeTruthy();
  expect(await joinAndReadBody()).toEqual({ code: 'GP-TOP', coach_sharing_notice: 'coach_sharing_join_v1' });
});
