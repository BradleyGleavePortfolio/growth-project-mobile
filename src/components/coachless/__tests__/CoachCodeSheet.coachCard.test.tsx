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

function renderSheet(initialCode = 'GP-TOP', debounceMs?: number) {
  return render(
    <CoachCodeSheet
      visible
      initialCode={initialCode}
      onClose={jest.fn()}
      onAttached={jest.fn()}
      onChoosePlan={jest.fn()}
      onMessageCoach={jest.fn()}
      debounceMs={debounceMs ?? 0}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachSharingNoticeForTests();
});

afterEach(() => jest.useRealTimers());

const checks = () => mockPost.mock.calls.filter(([url]) => url === '/coachless/coach-code/check');

async function typeQuickly(code: string) {
  for (let i = 1; i <= code.length; i++) {
    await fireEvent.changeText(screen.getByTestId('coach-code-input'), code.slice(0, i));
    await act(async () => jest.advanceTimersByTime(150));
  }
}

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

it('a pre-filled vanity code (featured banner) is checked once, at once, with the preview', async () => {
  jest.useFakeTimers();
  checkReturns(BASE);
  await renderSheet('GP-TOP', 1200);
  await act(async () => jest.advanceTimersByTime(0));
  expect(checks()).toEqual([['/coachless/coach-code/check', { code: 'GP-TOP' }, expect.anything()]]);
  expect(screen.getByText('Coach: Alex Rivera')).toBeTruthy();
});

it('typing GP-ABC234 one character at a time quickly sends one check', async () => {
  jest.useFakeTimers();
  checkReturns(BASE);
  await renderSheet('', 1200);
  await typeQuickly('GP-ABC234');
  await act(async () => jest.advanceTimersByTime(1200));
  expect(checks()).toEqual([['/coachless/coach-code/check', { code: 'GP-ABC234' }, expect.anything()]]);
});

// Owner 26: new coach codes are TGP- + 7. Complete, so checked at once (well inside the pause), never a shorter prefix.
it.each(['TGP-ABC2345', 'tgp-abc2345'])('typing %s quickly sends one check, at once, with the preview', async (typed) => {
  jest.useFakeTimers();
  checkReturns(BASE);
  await renderSheet('', 1200);
  await typeQuickly(typed);
  const once = [['/coachless/coach-code/check', { code: 'TGP-ABC2345' }, expect.anything()]];
  expect(checks()).toEqual(once);
  expect(screen.getByText('Coach: Alex Rivera')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(1200));
  expect(checks()).toEqual(once);
});

// GP-BRADLEY: its prefix GP-BRADLE is not a generated code (L), so it is never checked mid-typing.
it.each(['GP-TOP', 'GP-BRADLEY'])('typing vanity %s sends one check after the pause, with the preview', async (code) => {
  jest.useFakeTimers();
  checkReturns(BASE);
  await renderSheet('', 1200);
  await typeQuickly(code);
  expect(checks()).toHaveLength(0);
  await act(async () => jest.advanceTimersByTime(1200));
  expect(checks()).toEqual([['/coachless/coach-code/check', { code }, expect.anything()]]);
  expect(screen.getByText('Coach: Alex Rivera')).toBeTruthy();
});
