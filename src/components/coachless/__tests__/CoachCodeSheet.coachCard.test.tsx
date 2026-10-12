// COACH-CARD-134 follow-up: the coach-code sheet (Settings "Add a coach code",
// the Home and Messages coach-code sheet) shows the coach's headline and
// specialties under "Coach: {name}" when the check carries them (backend
// b#898), and no rows when absent (older backend or a coach who skipped K1/K2).
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: (...a: unknown[]) => mockPost(...a) },
  authApi: { getSignupPolicy: async () => ({ data: { invite_code_required: true, providers: ['email'] } }) },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ refreshEntitlement: jest.fn() }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({ patchUserCache: async () => undefined }));

import CoachCodeSheet from '../CoachCodeSheet';
import { resetCoachSharingNoticeForTests } from '../../../lib/coachSharingNotice';

const BASE = { id: 'coach-1', name: 'Alex Rivera', photo_url: null, business_name: null, bio: null };

function checkReturns(coach: Record<string, unknown>) {
  mockPost.mockImplementation(async (url: string) => {
    if (url === '/coachless/coach-code/check') return { data: { valid: true, coach } };
    throw new Error(`unexpected POST ${url}`);
  });
}

function renderSheet(initialCode = 'GP-ABC234', debounceMs = 0) {
  return render(
    <CoachCodeSheet
      visible
      initialCode={initialCode}
      onClose={jest.fn()}
      onAttached={jest.fn()}
      onChoosePlan={jest.fn()}
      onMessageCoach={jest.fn()}
      debounceMs={debounceMs}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachSharingNoticeForTests();
});

afterEach(() => jest.useRealTimers());

it('checks at most once when a complete generated code is typed one character at a time', async () => {
  jest.useFakeTimers();
  checkReturns(BASE);
  await renderSheet('', 400);
  const code = 'GP-ABC234';
  for (let length = 1; length <= code.length; length++) {
    await fireEvent.changeText(screen.getByTestId('coach-code-input'), code.slice(0, length));
    await act(async () => jest.advanceTimersByTime(400));
    expect(mockPost).toHaveBeenCalledTimes(length === code.length ? 1 : 0);
  }
  expect(mockPost).toHaveBeenCalledWith(
    '/coachless/coach-code/check', { code }, expect.anything(),
  );
  expect(screen.getByText('Coach: Alex Rivera')).toBeTruthy();
});

it.each(['GP-ABC23', 'GP-ABC2345', 'GP-ABC23!', 'GP-BRADLEY'])('does not live-check %s', async (code) => {
  jest.useFakeTimers();
  checkReturns(BASE);
  await renderSheet(code, 400);
  await act(async () => jest.advanceTimersByTime(400));
  expect(mockPost).not.toHaveBeenCalled();
});

it('keeps a short legacy code redeemable only when Join is tapped', async () => {
  jest.useFakeTimers();
  mockPost.mockResolvedValue({ data: {
    status: 'attached', already_attached: false, coach: BASE,
    next: { featured_package: null, packages_available: 0 },
  } });
  await renderSheet('GP-TOP', 400);
  await act(async () => jest.advanceTimersByTime(400));
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('coach-code-join'));
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith(
    '/coachless/coach-code/redeem', { code: 'GP-TOP' }, expect.anything(),
  );
});

it('checks a complete pasted lowercase code with surrounding spaces', async () => {
  jest.useFakeTimers();
  checkReturns(BASE);
  await renderSheet('', 400);
  await fireEvent.changeText(screen.getByTestId('coach-code-input'), ' gp-abc234 ');
  await act(async () => jest.advanceTimersByTime(400));
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith(
    '/coachless/coach-code/check', { code: 'GP-ABC234' }, expect.anything(),
  );
});

it('shows the headline and the specialties sentence under the coach name', async () => {
  checkReturns({ ...BASE, headline: 'Strength for busy parents', specialties: ['strength', 'busy', 'other'] });
  await renderSheet();
  expect(await screen.findByText('Coach: Alex Rivera')).toBeTruthy();
  expect(screen.getByTestId('coach-code-card-headline')).toHaveTextContent('Strength for busy parents');
  expect(screen.getByTestId('coach-code-card-specialties')).toHaveTextContent(
    'Specialises in strength and busy professionals.',
  );
});

it('no blank rows for a coach without the fields (null / [])', async () => {
  checkReturns({ ...BASE, headline: null, specialties: [] });
  await renderSheet();
  expect(await screen.findByText('Coach: Alex Rivera')).toBeTruthy();
  expect(screen.queryByTestId('coach-code-card')).toBeNull();
});

it('an older backend without the fields still validates and shows only the name', async () => {
  checkReturns(BASE);
  await renderSheet();
  expect(await screen.findByText('Coach: Alex Rivera')).toBeTruthy();
  expect(screen.queryByTestId('coach-code-card')).toBeNull();
  expect(screen.getByTestId('coach-code-join')).toBeTruthy();
});
