// COACH-CARD-134 follow-up: the coach-code sheet (Settings "Add a coach code",
// the Home and Messages coach-code sheet) shows the coach's headline and
// specialties under "Coach: {name}" when the check carries them (backend
// b#898), and no rows when absent (older backend or a coach who skipped K1/K2).
import React from 'react';
import { render, screen } from '@testing-library/react-native';

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

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachSharingNoticeForTests();
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
