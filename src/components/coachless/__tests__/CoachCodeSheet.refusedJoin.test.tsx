/**
 * 1TO1-FU-M (#185-S1 op 1, LS-1TO1R3 C1): the code sheet's refused join says the coach is not taking
 * new clients, not that code entry is paused; the switch-off 404 still says paused.
 */
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

const NOT_ACCEPTING =
  'This coach is not taking new clients right now. Enter another coach code, or check back in a few days.';
const PAUSED = 'Coach code entry is paused right now. Check Home again in a little while.';

let redeemAnswer: { status: number; data?: Record<string, unknown> };

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachSharingNoticeForTests();
  mockPolicy.mockResolvedValue({ data: { invite_code_required: true, providers: ['email'] } });
  mockPost.mockImplementation(async (url: string) => {
    if (url === '/coachless/coach-code/check') return { data: { valid: true, coach: COACH } };
    if (url === '/coachless/coach-code/redeem') throw { response: redeemAnswer };
    throw new Error(`unexpected POST ${url}`);
  });
});

async function joinAndReadLine(): Promise<string> {
  render(
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
  await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('coach-code-join'));
  await waitFor(() => expect(screen.getByTestId('coach-code-refusal')).toBeTruthy());
  return String(screen.getByTestId('coach-code-refusal').props.children);
}

it.each<[string, number, Record<string, unknown>]>([
  ['today: 404 PACKAGE_NOT_FOUND', 404, { statusCode: 404, error: 'PACKAGE_NOT_FOUND', message: 'Package not available', request_id: 'r-1' }],
  ['after 1TO1-FU-BE: coach_not_accepting', 409, { code: 'coach_not_accepting', request_id: 'r-1' }],
  ['after 1TO1-FU-BE: coach_not_accepting_clients', 409, { code: 'coach_not_accepting_clients', request_id: 'r-1' }],
])('a refused join (%s) says the coach is not taking new clients', async (_name, status, data) => {
  redeemAnswer = { status, data };
  const line = await joinAndReadLine();
  expect(line).toBe(NOT_ACCEPTING);
  expect(line).not.toBe(PAUSED);
});

it.each<[string, Record<string, unknown> | undefined]>([
  ['coachless_disabled', { statusCode: 404, code: 'coachless_disabled' }],
  ['a bare 404', { statusCode: 404, error: 'Not Found' }],
])('a join answered with the switch off (%s) still says code entry is paused', async (_name, data) => {
  redeemAnswer = { status: 404, data };
  expect(await joinAndReadLine()).toBe(PAUSED);
});
