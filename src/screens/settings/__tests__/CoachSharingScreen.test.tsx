/**
 * Settings > Privacy > Coach sharing (B-SHARE-127). Failing before (#451, Sol
 * B-451-1): an absent owner_access read as false and the owner line was hidden.
 * FW-BODY B2 (failing on main): the screen said "Choose what your coach sees"
 * with no word that Apple Health / Health Connect data is outside the switches.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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
  expect(screen.queryByTestId('coach-sharing-devices')).toBeNull();
});

describe('connected devices are outside the switches (FW-BODY B2)', () => {
  const DEVICES =
    'Connected devices, such as Apple Health and Health Connect, are not covered by these switches. Your coach can see the data they bring in, and data already shared stays with your coach after you disconnect.';
  const originalOS = Platform.OS;
  const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  afterEach(() => {
    setOS(originalOS);
    mockHealthConnectBuild = false;
  });

  it('says which logs the switches cover, states connected devices, and opens Connected devices', async () => {
    setOS('ios');
    mockGet.mockResolvedValueOnce(shared({ owner_access: false }));
    await render(<CoachSharingScreen />);
    expect(await screen.findByText('Choose which of these logs your coach sees. Each change saves right away.')).toBeTruthy();
    expect(screen.queryByText('Choose what your coach sees. Each change saves right away.')).toBeNull();
    expect(screen.getByText(DEVICES)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Connected devices'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
  });

  it('the Connected devices target sits on the same More stack as Coach sharing (no dead row)', () => {
    const nav = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
    const more = Array.from(nav.matchAll(/<MoreStackNav\.Screen\s+name="(\w+)"/g), (m) => m[1]);
    expect(more).toEqual(expect.arrayContaining(['CoachSharing', 'Connections']));
  });

  it.each([
    ['an Android build with Health Connect: shown', true],
    ['an Android build without Health Connect (More has no Connected devices row): hidden', false],
  ])('%s', async (_name, healthConnect) => {
    setOS('android');
    mockHealthConnectBuild = healthConnect;
    mockGet.mockResolvedValueOnce(shared({ owner_access: false }));
    await render(<CoachSharingScreen />);
    expect(await screen.findByTestId('coach-sharing-state-fitness.workouts')).toHaveTextContent('Shared');
    expect(screen.queryByText(DEVICES) != null).toBe(healthConnect);
    expect(screen.queryByLabelText('Connected devices') != null).toBe(healthConnect);
  });
});
