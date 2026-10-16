/**
 * Settings > Privacy > Coach sharing (B-SHARE-127, SHARE-UNWIND). Owner
 * #SHARE-SIMPLE / #SHARE-JOIN: no switches, no owner-account line, nothing is
 * written. Each log shows what GET /consent/me says the coach reads, against
 * both servers: backend #1061 (all four granted for the current coach) and an
 * older backend that still withholds a log the client turned off, which must
 * never read Shared. The TGP owner account reads every log.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockHealthConnectBuild = false;
jest.mock('../../../config/healthConnect', () => ({ isAndroidHealthConnectEnabled: () => mockHealthConnectBuild }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));

import * as sharingApi from '../../../api/coachSharingApi';
import CoachSharingScreen from '../CoachSharingScreen';

const SCOPES = sharingApi.COACH_SHARING_SCOPES;
const body = (granted: string[], extra: Record<string, unknown> = {}) => ({
  data: {
    client_id: 'client-1',
    coach_id: 'coach-1',
    consents: [{ scope: 'fitness.profile', granted: false }, ...SCOPES.map((scope) => ({ scope, granted: granted.includes(scope) }))],
    ...extra,
  },
});
const http400 = Object.assign(new Error('HTTP 400'), { response: { status: 400 } });
const S = 'Shared';
const N = 'Not shared';

/** What each server can send, and what the Workouts, Food logs, Weigh-ins and Check-ins and habits rows must say. */
const MATRIX: [string, ReturnType<typeof body>, string[]][] = [
  ['backend #1061: all four granted', body([...SCOPES], { owner_access: false }), [S, S, S, S]],
  ['older backend: food logs and check-ins withheld', body(['fitness.workouts', 'fitness.body_metrics'], { owner_access: false }), [S, N, S, N]],
  ['older backend: every log withheld', body([], { owner_access: false }), [N, N, N, N]],
  ['older backend, owner account coach: reads every log', body([], { owner_access: true }), [S, S, S, S]],
  ['older backend, no owner_access field', body(['fitness.workouts']), [S, N, N, N]],
];

const originalOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  setOS(originalOS);
  mockHealthConnectBuild = false;
});

it.each(MATRIX)('read boundary, %s', (_name, res, rows) => {
  expect(sharingApi.parseCoachSharing(res.data)).toEqual({
    coachId: 'coach-1',
    shared: Object.fromEntries(SCOPES.map((scope, i) => [scope, rows[i] === S])),
  });
  expect(sharingApi.parseCoachSharing({ coach_id: 'coach-1' })).toBeNull();
  expect('setCoachSharing' in sharingApi).toBe(false);
});

it.each(MATRIX)('page, %s: each row says what the coach reads, with no switch and no write', async (_name, res, rows) => {
  setOS('ios');
  mockGet.mockResolvedValueOnce(res);
  await render(<CoachSharingScreen />);
  expect(await screen.findByTestId(`coach-sharing-state-${SCOPES[0]}`)).toHaveTextContent(rows[0]);
  SCOPES.forEach((scope, i) => {
    expect(screen.getByText(sharingApi.COACH_SHARING_LABELS[scope])).toBeTruthy();
    expect(screen.getByTestId(`coach-sharing-state-${scope}`)).toHaveTextContent(rows[i]);
  });
  expect(mockGet).toHaveBeenCalledWith('/consent/me');
  expect(screen.queryAllByRole('switch')).toEqual([]);
  expect(screen.queryAllByTestId(/^coach-sharing-(toggle|owner)/)).toEqual([]);
  expect(screen.queryAllByText(/owner account|turned off|could not be updated|Choose which/)).toEqual([]);
  await fireEvent.press(screen.getByLabelText('Connected devices'));
  expect(mockNavigate).toHaveBeenCalledWith('Connections');
  expect(mockPost).not.toHaveBeenCalled();
});

it('a failed load offers a retry; no coach says so', async () => {
  mockGet.mockRejectedValueOnce(new Error('Network Error'));
  const first = await render(<CoachSharingScreen />);
  expect(await screen.findByText('Coach sharing could not load. Check the connection and try again.')).toBeTruthy();
  mockGet.mockResolvedValueOnce(body([...SCOPES], { owner_access: false }));
  await fireEvent.press(screen.getByLabelText('Try again'));
  expect(await screen.findByTestId('coach-sharing-state-fitness.workouts')).toHaveTextContent(S);
  await first.unmount();

  mockGet.mockRejectedValueOnce(http400);
  await render(<CoachSharingScreen />);
  expect(await screen.findByText('Coach sharing applies once a coach is connected to this account.')).toBeTruthy();
  expect(screen.queryByTestId('coach-sharing-state-fitness.workouts')).toBeNull();
  expect(screen.queryByTestId('coach-sharing-devices')).toBeNull();
  expect(mockPost).not.toHaveBeenCalled();
});

it('the Connected devices target sits on the same More stack as Coach sharing (no dead row)', () => {
  const nav = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
  const more = Array.from(nav.matchAll(/<MoreStackNav\.Screen\s+name="(\w+)"/g), (m) => m[1]);
  expect(more).toEqual(expect.arrayContaining(['CoachSharing', 'Connections']));
});

it.each([
  ['an Android build with Health Connect: Connected devices shown', true],
  ['an Android build without Health Connect (More has no Connected devices row): hidden', false],
])('%s', async (_name, healthConnect) => {
  setOS('android');
  mockHealthConnectBuild = healthConnect;
  mockGet.mockResolvedValueOnce(body([...SCOPES], { owner_access: false }));
  await render(<CoachSharingScreen />);
  expect(await screen.findByTestId('coach-sharing-state-fitness.workouts')).toHaveTextContent(S);
  expect(screen.queryByLabelText('Connected devices') != null).toBe(healthConnect);
});
