/**
 * Settings > Privacy > Coach sharing (B-SHARE-127). Failing before (#451, Sol
 * B-451-1): an absent owner_access read as false and the owner line was hidden.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), warningTap: jest.fn() }));

import { COACH_SHARING_SCOPES, parseCoachSharing } from '../../../api/coachSharingApi';
import CoachSharingScreen from '../CoachSharingScreen';

type Row = { scope: string; granted: boolean; granted_at: string | null; revoked_at: string | null };
const T = '2026-10-07T00:00:00Z';
const none = (scope: string): Row => ({ scope, granted: false, granted_at: null, revoked_at: null });
const on = (scope: string): Row => ({ scope, granted: true, granted_at: T, revoked_at: null });
const body = (rows: Row[], extra: Record<string, unknown> = {}) => ({
  data: { client_id: 'client-1', coach_id: 'coach-1', consents: [none('fitness.profile'), ...rows], ...extra },
});
const shared = (extra?: Record<string, unknown>) => body(COACH_SHARING_SCOPES.map(on), extra);
const http400 = Object.assign(new Error('HTTP 400'), { response: { status: 400 } });

const OWNER = 'Your coach uses the TGP owner account, which can see these logs even when they are turned off here.';
const OWNER_UNKNOWN =
  'If your coach uses the TGP owner account, that account can see these logs even when they are turned off here.';

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: {} });
});

it('reads owner_access as true, false, or not reported (never assumed false)', () => {
  expect(parseCoachSharing(shared().data)?.ownerAccess).toBeNull();
  expect(parseCoachSharing(shared({ owner_access: true }).data)?.ownerAccess).toBe(true);
  expect(parseCoachSharing(shared({ owner_access: false }).data)?.ownerAccess).toBe(false);
  expect(parseCoachSharing(shared({ owner_access: 'yes' }).data)?.ownerAccess).toBeNull();
  expect(parseCoachSharing(body([on('fitness.workouts')]).data)?.shared).toMatchObject({ 'fitness.workouts': true, 'fitness.food_macros': false });
});

it.each([
  ['absent (current production): stated as a condition', {}, OWNER_UNKNOWN],
  ['true: stated plainly', { owner_access: true }, OWNER],
])('owner_access %s', async (_name, extra, line) => {
  mockGet.mockResolvedValueOnce(shared(extra));
  await render(<CoachSharingScreen />);
  expect(await screen.findByTestId('coach-sharing-owner-note')).toHaveTextContent(line);
  expect(mockGet).toHaveBeenCalledWith('/consent/me');
});

it('owner_access false: no owner line', async () => {
  mockGet.mockResolvedValueOnce(shared({ owner_access: false }));
  await render(<CoachSharingScreen />);
  expect(await screen.findByTestId('coach-sharing-state-fitness.workouts')).toHaveTextContent('Shared');
  expect(screen.queryByTestId('coach-sharing-owner-note')).toBeNull();
});

it('turning a log off revokes that one scope; a failed save goes back with a specific line', async () => {
  mockGet.mockResolvedValueOnce(shared({ owner_access: false }));
  await render(<CoachSharingScreen />);
  expect(await screen.findByTestId('coach-sharing-state-fitness.food_macros')).toHaveTextContent('Shared');
  await fireEvent(screen.getByTestId('coach-sharing-toggle-fitness.food_macros'), 'valueChange', false);
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/consent/revoke', { coach_id: 'coach-1', scope: 'fitness.food_macros' }));
  expect(screen.getByTestId('coach-sharing-state-fitness.food_macros')).toHaveTextContent('Not shared');

  mockPost.mockRejectedValueOnce(new Error('Network Error'));
  await fireEvent(screen.getByTestId('coach-sharing-toggle-fitness.workouts'), 'valueChange', false);
  expect(await screen.findByText('Workouts could not be updated. Check the connection and try again.')).toBeTruthy();
  expect(screen.getByTestId('coach-sharing-state-fitness.workouts')).toHaveTextContent('Shared');
});

it('a failed load offers a retry; no coach says so', async () => {
  mockGet.mockRejectedValueOnce(new Error('Network Error'));
  const first = await render(<CoachSharingScreen />);
  expect(await screen.findByText('Coach sharing could not load. Check the connection and try again.')).toBeTruthy();
  mockGet.mockResolvedValueOnce(shared({ owner_access: false }));
  await fireEvent.press(screen.getByLabelText('Try again'));
  expect(await screen.findByTestId('coach-sharing-state-fitness.workouts')).toHaveTextContent('Shared');
  await first.unmount();

  mockGet.mockRejectedValueOnce(http400);
  await render(<CoachSharingScreen />);
  expect(await screen.findByText('Coach sharing applies once a coach is connected to this account.')).toBeTruthy();
});
