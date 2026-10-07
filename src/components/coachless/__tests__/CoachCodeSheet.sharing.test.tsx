/**
 * B-SHARE-126: joining a coach with a code from coachless Home asks, right
 * after Join, whether to share logs with that coach; then the welcome shows.
 * A client who already chose for this coach goes straight to the welcome.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockPost = jest.fn(async (..._a: unknown[]) => ({ data: {} }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
const COACH = { id: 'coach-1', name: 'Alex Rivera', photo_url: null, business_name: null, bio: null };
jest.mock('../../../api/coachlessApi', () => ({
  ...jest.requireActual('../../../api/coachlessApi'),
  checkCoachCode: async () => ({ valid: true, coach: COACH }),
  redeemCoachCode: async () => ({
    status: 'attached', already_attached: false, coach: COACH, grant: null, replayed: false,
    next: { featured_package: null, packages_available: 0 },
  }),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: async () => undefined }) }));
jest.mock('../../../lib/userCache', () => ({ patchUserCache: async () => undefined }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', role: 'student' }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

import CoachCodeSheet from '../CoachCodeSheet';

const SCOPES = ['fitness.workouts', 'fitness.food_macros', 'fitness.body_metrics', 'fitness.habits_progress'];
const consentMe = (revoked: string | null) => ({
  data: { coach_id: 'coach-1', consents: SCOPES.map((scope) => ({ scope, granted: false, granted_at: null, revoked_at: revoked })) },
});
const join = async () => {
  await render(
    <CoachCodeSheet visible initialCode="GP-ALEX01" onClose={jest.fn()} onAttached={jest.fn()} onChoosePlan={jest.fn()} onMessageCoach={jest.fn()} debounceMs={0} />,
  );
  await fireEvent.press(screen.getByTestId('coach-code-join'));
};

beforeEach(() => jest.clearAllMocks());

it('after Join, asks to share; Share grants the four scopes for that coach, then the welcome shows', async () => {
  mockGet.mockResolvedValue(consentMe(null));
  await join();
  expect(await screen.findByText('Share your logs with Alex Rivera?')).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith('/consent/me', { params: { coach_id: 'coach-1' } });
  expect(screen.queryByTestId('coach-code-welcome')).toBeNull();
  await fireEvent.press(screen.getByTestId('coach-sharing-share'));
  expect(await screen.findByTestId('coach-code-welcome')).toBeTruthy();
  for (const scope of SCOPES) expect(mockPost).toHaveBeenCalledWith('/consent/grant', { coach_id: 'coach-1', scope });
});

it('a client who already chose for this coach goes straight to the welcome', async () => {
  mockGet.mockResolvedValue(consentMe('2026-10-06T00:00:00Z'));
  await join();
  expect(await screen.findByTestId('coach-code-welcome')).toBeTruthy();
  expect(screen.queryByTestId('coach-sharing-card')).toBeNull();
  expect(mockPost).not.toHaveBeenCalledWith('/consent/grant', expect.anything());
});
