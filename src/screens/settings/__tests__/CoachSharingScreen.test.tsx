/**
 * Settings > Privacy > Coach sharing (B-SHARE-127, SHARE-UNWIND). Owner
 * #SHARE-SIMPLE / #SHARE-JOIN: workouts, food logs, weigh-ins, check-ins and
 * habits always reach the current coach, so the page has no switches, no
 * owner-account line and writes nothing (POST /consent/revoke returns 410 for
 * the four removed sharing scopes). It says
 * what the coach sees and how new device data stops (Apple Health on iPhone,
 * Health Connect on Android), with the Connected devices row.
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

/** What GET /consent/me sends since backend #1061: the four as granted for the current coach. */
const SCOPES = ['fitness.workouts', 'fitness.food_macros', 'fitness.body_metrics', 'fitness.habits_progress'];
const consent = () => ({
  data: { client_id: 'client-1', coach_id: 'coach-1', consents: SCOPES.map((scope) => ({ scope, granted: true })) },
});
const http400 = Object.assign(new Error('HTTP 400'), { response: { status: 400 } });
const INTRO = 'Your coach sees your workouts, food logs, weigh-ins, check-ins and habits.';
const devices = (health: string) =>
  `Your coach also sees data from ${health} and other devices you connect. To stop new data, disconnect it in Connected devices or turn TGP Fitness off in your phone's ${health} permissions. Data already shared stays with your coach.`;

const originalOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  setOS(originalOS);
  mockHealthConnectBuild = false;
});

it('reads only the coach; the old switch writer and labels are gone', () => {
  expect(sharingApi.parseCoachSharing(consent().data)).toEqual({ coachId: 'coach-1' });
  expect(sharingApi.parseCoachSharing({ consents: [] })).toBeNull();
  expect(Object.keys(sharingApi).filter((k) => /^(setCoachSharing|COACH_SHARING_(SCOPES|LABELS))$/.test(k))).toEqual([]);
});

it('says what the coach sees, with no switch, no owner-account line and no write', async () => {
  setOS('ios');
  mockGet.mockResolvedValueOnce(consent());
  await render(<CoachSharingScreen />);
  expect(await screen.findByTestId('coach-sharing-intro')).toHaveTextContent(INTRO);
  expect(mockGet).toHaveBeenCalledWith('/consent/me');
  expect(screen.queryAllByTestId(/^coach-sharing-(toggle|state|owner)/)).toEqual([]);
  expect(screen.queryAllByText(/Not shared|^Shared$|owner account|turned off|could not be updated/)).toEqual([]);
  expect(screen.getByText(devices('Apple Health'))).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Connected devices'));
  expect(mockNavigate).toHaveBeenCalledWith('Connections');
  expect(mockPost).not.toHaveBeenCalled();
});

it('a failed load offers a retry; no coach says so', async () => {
  mockGet.mockRejectedValueOnce(new Error('Network Error'));
  const first = await render(<CoachSharingScreen />);
  expect(await screen.findByText('Coach sharing could not load. Check the connection and try again.')).toBeTruthy();
  mockGet.mockResolvedValueOnce(consent());
  await fireEvent.press(screen.getByLabelText('Try again'));
  expect(await screen.findByTestId('coach-sharing-intro')).toHaveTextContent(INTRO);
  await first.unmount();

  mockGet.mockRejectedValueOnce(http400);
  await render(<CoachSharingScreen />);
  expect(await screen.findByText('Coach sharing applies once a coach is connected to this account.')).toBeTruthy();
  expect(screen.queryByTestId('coach-sharing-intro')).toBeNull();
  expect(screen.queryByTestId('coach-sharing-devices')).toBeNull();
});

it('the Connected devices target sits on the same More stack as Coach sharing (no dead row)', () => {
  const nav = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
  const more = Array.from(nav.matchAll(/<MoreStackNav\.Screen\s+name="(\w+)"/g), (m) => m[1]);
  expect(more).toEqual(expect.arrayContaining(['CoachSharing', 'Connections']));
});

it.each([
  ['an Android build with Health Connect: shown, naming Health Connect', true],
  ['an Android build without Health Connect (More has no Connected devices row): hidden', false],
])('%s', async (_name, healthConnect) => {
  setOS('android');
  mockHealthConnectBuild = healthConnect;
  mockGet.mockResolvedValueOnce(consent());
  await render(<CoachSharingScreen />);
  expect(await screen.findByTestId('coach-sharing-intro')).toHaveTextContent(INTRO);
  expect(screen.queryByText(devices('Health Connect')) != null).toBe(healthConnect);
  expect(screen.queryAllByText(/Apple Health/)).toEqual([]);
  expect(screen.queryByLabelText('Connected devices') != null).toBe(healthConnect);
});
