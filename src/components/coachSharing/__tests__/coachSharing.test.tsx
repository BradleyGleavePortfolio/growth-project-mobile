/**
 * B-SHARE-126: a client linked to a coach chooses, explicitly, whether the
 * coach sees their workouts, food logs, weigh-ins, and check-ins and habits.
 * Failing before: no app surface called POST /consent/grant, so a coach-role
 * coach saw every client as "not shared".
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn() }));

import { COACH_SHARING_SCOPES, coachToAskAbout, parseCoachSharing } from '../../../api/coachSharingApi';
import CoachSharingCard, { CoachSharingPrompt } from '../CoachSharingCard';
import CoachSharingScreen from '../../../screens/settings/CoachSharingScreen';

type Row = { scope: string; granted: boolean; granted_at: string | null; revoked_at: string | null };
const T = '2026-10-06T00:00:00Z';
const none = (scope: string): Row => ({ scope, granted: false, granted_at: null, revoked_at: null });
const on = (scope: string): Row => ({ scope, granted: true, granted_at: T, revoked_at: null });
const off = (scope: string): Row => ({ scope, granted: false, granted_at: null, revoked_at: T });
const body = (rows: Row[], extra: Record<string, unknown> = {}) => ({
  data: { client_id: 'client-1', coach_id: 'coach-1', consents: [none('fitness.profile'), ...rows], ...extra },
});
const fresh = (extra?: Record<string, unknown>) => body(COACH_SHARING_SCOPES.map(none), extra);
const http400 = Object.assign(new Error('HTTP 400'), { response: { status: 400 } });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockPost.mockResolvedValue({ data: {} });
});

it('parses the four states: no rows = not shared and undecided; a turned-off row is a choice; owner_access absent = false', () => {
  expect(parseCoachSharing(fresh().data)).toMatchObject({ coachId: 'coach-1', decided: false, ownerAccess: false });
  const s = parseCoachSharing(body([on('fitness.workouts'), off('fitness.food_macros')], { owner_access: true }).data);
  expect(s?.shared).toEqual({ 'fitness.workouts': true, 'fitness.food_macros': false, 'fitness.body_metrics': false, 'fitness.habits_progress': false });
  expect(s).toMatchObject({ decided: true, ownerAccess: true });
});

it('asks only with no choice, no Not now and a coach that is not the owner account', async () => {
  mockGet.mockResolvedValueOnce(fresh());
  await expect(coachToAskAbout('client-1')).resolves.toBe('coach-1');
  expect(mockGet).toHaveBeenCalledWith('/consent/me', undefined);
  mockGet.mockResolvedValueOnce(body([off('fitness.workouts')]));
  await expect(coachToAskAbout('client-1', 'coach-1')).resolves.toBeNull();
  mockGet.mockResolvedValueOnce(fresh({ owner_access: true }));
  await expect(coachToAskAbout('client-1')).resolves.toBeNull();
  mockGet.mockRejectedValueOnce(http400);
  await expect(coachToAskAbout('client-1')).resolves.toBeNull();
});

it('the link screen names the four things; Share grants exactly the four scopes; a failed grant stays with a specific line', async () => {
  const onDone = jest.fn();
  mockPost.mockRejectedValueOnce(new Error('Network Error'));
  await render(<CoachSharingCard coachId="coach-1" coachName="Alex Rivera" userId="client-1" onDone={onDone} />);
  expect(screen.getByText('Share your logs with Alex Rivera?')).toBeTruthy();
  expect(screen.getByText('Alex Rivera will see your workouts, food logs, weigh-ins, and check-ins and habits.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('coach-sharing-share'));
  expect(await screen.findByText('Sharing did not finish. Check the connection and try again.')).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();

  mockPost.mockClear();
  await fireEvent.press(screen.getByTestId('coach-sharing-share'));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('shared'));
  expect(mockPost).toHaveBeenCalledTimes(4);
  for (const scope of COACH_SHARING_SCOPES) expect(mockPost).toHaveBeenCalledWith('/consent/grant', { coach_id: 'coach-1', scope });
});

it('the prompt asks once for a linked client; Not now grants nothing and is not asked again', async () => {
  mockGet.mockResolvedValue(fresh());
  await render(<CoachSharingPrompt userId="client-1" />);
  expect(await screen.findByText('Share your logs with your coach?')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('coach-sharing-not-now'));
  await waitFor(() => expect(screen.queryByTestId('coach-sharing-prompt')).toBeNull());
  expect(mockPost).not.toHaveBeenCalled();
  await expect(coachToAskAbout('client-1')).resolves.toBeNull();
});

describe('Settings > Privacy > Coach sharing', () => {
  it('shows state in words; a toggle revokes; a failed save goes back with a specific line', async () => {
    mockGet.mockResolvedValueOnce(body(COACH_SHARING_SCOPES.map(on)));
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

  it('a failed load offers a retry; the owner account note shows; no coach says so', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network Error'));
    const first = await render(<CoachSharingScreen />);
    expect(await screen.findByText('Coach sharing could not load. Check the connection and try again.')).toBeTruthy();
    mockGet.mockResolvedValueOnce(fresh({ owner_access: true }));
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(await screen.findByTestId('coach-sharing-owner-note')).toBeTruthy();
    await first.unmount();

    mockGet.mockRejectedValueOnce(http400);
    await render(<CoachSharingScreen />);
    expect(await screen.findByText('Coach sharing applies once a coach is connected to this account.')).toBeTruthy();
  });
});
