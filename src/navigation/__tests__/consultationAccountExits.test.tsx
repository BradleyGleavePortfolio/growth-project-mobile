/**
 * AGEDELETE (App Store 5.1.1(v)): a new sign-up the age gate refuses can
 * delete their account and download their data in the app. Table: every
 * refused path through the consultation (the under-16 stop screen; Finish
 * later on the date-of-birth question; the stop screen, Change my date of
 * birth, then Finish later) reaches both real screens through the real
 * ConsultationOnboardingNavigator, and Go back and Android back return to the
 * same place. Every request on those paths, and every route the two screens
 * can call, is one backend main allows before the age is confirmed
 * (growth-project-backend#1032, @AllowBeforeAgeConfirmed).
 */
jest.mock('axios', () => {
  const calls: string[] = [];
  const reply = (method: string) =>
    jest.fn(async (url: string) => {
      calls.push(`${method} ${url}`);
      const data = method === 'PUT' ? { saved_at: '2026-09-30T19:00:00Z', completed_chapters: [1] } : null;
      return { data, status: 200, headers: {}, config: {} };
    });
  const instance = {
    request: jest.fn(async (c: { method?: string; url: string }) => {
      calls.push(`${(c.method ?? 'get').toUpperCase()} ${c.url}`);
      return { data: null, status: 200, headers: {}, config: {} };
    }),
    get: reply('GET'),
    post: reply('POST'),
    put: reply('PUT'),
    patch: reply('PATCH'),
    delete: reply('DELETE'),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) }, __calls: calls };
});
jest.mock('../../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => 'token-a1'),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../services/authActions', () => ({ signOut: jest.fn(async () => undefined) }));
jest.mock('../../utils/authProviders', () => ({ getSignInProviders: jest.fn(async () => ['email']) }));
jest.mock('../../utils/appleAuth', () => ({ isAppleAuthAvailable: jest.fn(async () => false), reauthenticateWithApple: jest.fn() }));
jest.mock('../../utils/googleReauth', () => ({ reauthenticateWithGoogle: jest.fn() }));
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1', role: 'student' }) }));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn(async () => undefined) }));

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { ActionSheetIOS, Alert, BackHandler, Linking, type AlertButton } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render } from '@testing-library/react-native';
import ConsultationOnboardingNavigator from '../ConsultationOnboardingNavigator';
import { deletionApi } from '../../services/api';
import { dataExportApi, DOWNLOAD_ROUTE } from '../../services/dataExportApi';
import { signOut } from '../../services/authActions';
import { resetStores, seedLocal } from '../../lib/consultation/__fixtures__/flowHarness';
import { fullAnswers } from '../../lib/consultation/__fixtures__/consultFixtures';

const calls: string[] = jest.requireMock('axios').__calls;

/** Backend main (b#1032): the controllers marked @AllowBeforeAgeConfirmed, and PATCH /users/me/push-token alone. */
const ALLOWED_BEFORE_AGE = [
  /^[A-Z]+ \/auth\//,
  /^[A-Z]+ \/me\/onboarding(\/|$)/,
  /^[A-Z]+ \/me\/ai-consent(\/|$)/,
  /^[A-Z]+ \/consent\//,
  /^[A-Z]+ \/profile(\/|$)/,
  /^[A-Z]+ \/me\/delete-account(\/|$)/,
  /^[A-Z]+ \/v1\/me\/data-export\//,
  /^PATCH \/users\/me\/push-token$/,
];
const refused = (list: string[]) => list.filter((c) => !ALLOWED_BEFORE_AGE.some((re) => re.test(c.split('?')[0])));

type R = Awaited<ReturnType<typeof render>>;

async function pickUnder16(r: R) {
  await r.findByTestId('consult-screen-B2');
  await fireEvent(r.getByTestId('wheel-dob-month-scroll', { includeHiddenElements: true }), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: 0 } } });
  for (const w of ['wheel-dob-day', 'wheel-dob-year']) {
    await fireEvent(r.getByTestId(w), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  }
  for (let i = 0; i < 15; i += 1) {
    await fireEvent(r.getByTestId('wheel-dob-year'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  }
  await fireEvent.press(r.getByTestId('consult-continue'));
  expect(r.getByText('TGP Fitness is for ages 16 and up.')).toBeTruthy();
}

const PATHS: Array<[string, string, (r: R) => Promise<void>]> = [
  ['the under-16 stop screen', 'consult-screen-UNDER_AGE', pickUnder16],
  ['Finish later on the date-of-birth question', 'consult-paused', async (r) => {
    await fireEvent.press(await r.findByTestId('consult-finish-later'));
  }],
  ['the stop screen, Change my date of birth, then Finish later', 'consult-paused', async (r) => {
    await pickUnder16(r);
    await fireEvent.press(r.getByTestId('consult-under-age-change'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
  }],
];

let backHandlers: Array<() => boolean | null | undefined> = [];
/** Android back: newest listener first, until one handles it (React Native's order). */
const androidBack = () =>
  act(async () => {
    for (const h of [...backHandlers].reverse()) if (h()) return;
  });

let alert: jest.SpyInstance;
beforeEach(async () => {
  await resetStores();
  calls.length = 0;
  backHandlers = [];
  (signOut as jest.Mock).mockClear();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
    backHandlers.push(h);
    return { remove: () => void (backHandlers = backHandlers.filter((x) => x !== h)) };
  });
});
afterEach(() => jest.restoreAllMocks());

describe('AGEDELETE: every refused path in the consultation reaches Download my data and Delete my account', () => {
  it.each(PATHS)('from %s', async (_name, home, reach) => {
    const a = fullAnswers();
    delete a.B2;
    await seedLocal(a, 'B2');
    const r = await render(
      <NavigationContainer>
        <ConsultationOnboardingNavigator />
      </NavigationContainer>,
    );
    await reach(r);
    expect(r.getByTestId(home)).toBeTruthy();
    // The same five actions as the age step's stop screen, in the same order.
    expect(['consult-data-export', 'consult-delete-account', 'consult-support', 'consult-sign-out'].map((id) => !!r.queryByTestId(id))).toEqual([true, true, true, true]);

    // Download my data: the real screen, and Go back returns here.
    await fireEvent.press(r.getByTestId('consult-data-export'));
    await r.findByTestId('data-export-screen');
    await fireEvent.press(r.getByLabelText('Go back'));
    expect(r.queryByTestId('data-export-screen')).toBeNull();
    expect(r.getByTestId(home)).toBeTruthy();

    // Delete my account: the real screen; Android back closes it, not a question under it.
    await fireEvent.press(r.getByTestId('consult-delete-account'));
    await r.findByText('Delete account');
    await androidBack();
    expect(r.queryByText('Delete account')).toBeNull();
    expect(r.getByTestId(home)).toBeTruthy();

    // Open again from the same place; the top-bar Go back returns too.
    await fireEvent.press(r.getByTestId('consult-delete-account'));
    await r.findByText('Delete account');
    await fireEvent.press(r.getByLabelText('Go back'));
    expect(r.getByTestId(home)).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-data-export'));
    await r.findByTestId('data-export-screen');
    await androidBack();
    expect(r.queryByTestId('data-export-screen')).toBeNull();
    expect(r.getByTestId(home)).toBeTruthy();

    // Sign out asks first, then signs out.
    await fireEvent.press(r.getByTestId('consult-sign-out'));
    const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[];
    await act(async () => buttons.find((b) => b.text === 'Sign out')?.onPress?.());
    expect(signOut).toHaveBeenCalledTimes(1);

    // Both screens read their status; every request on the path is allowed before the age is confirmed.
    expect(calls).toEqual(expect.arrayContaining(['GET /me/delete-account/status', 'GET /v1/me/data-export/status']));
    expect(refused(calls)).toEqual([]);
  }, 30000);
});

describe('AGEDELETE: each route the two account screens call is allowed before the age is confirmed', () => {
  const ROUTES: Array<[string, string, () => Promise<unknown>, string]> = [
    ['DeleteAccountScreen', 'getDeletionStatus', () => deletionApi.getDeletionStatus(), 'GET /me/delete-account/status'],
    ['DeleteAccountScreen', 'issueRecentAuthToken', () => deletionApi.issueRecentAuthToken({ password: 'pw' }), 'POST /auth/recent-auth-token'],
    ['DeleteAccountScreen', 'requestDeletion', () => deletionApi.requestDeletion('recent-token'), 'POST /me/delete-account'],
    ['DeleteAccountScreen', 'cancelDeletion', () => deletionApi.cancelDeletion(), 'POST /me/delete-account/cancel'],
    ['DataExportScreen', 'getStatus', () => dataExportApi.getStatus(), 'GET /v1/me/data-export/status'],
    ['DataExportScreen', 'requestExport', () => dataExportApi.requestExport(), 'POST /v1/me/data-export/request'],
    ['DataExportScreen', 'createDownloadLink', () => dataExportApi.createDownloadLink(), 'POST /v1/me/data-export/download-link'],
  ];

  it.each(ROUTES)('%s %s sends %s, an allowed route', async (_screen, _fn, call, route) => {
    calls.length = 0;
    await call().catch(() => undefined); // a null body is a parse error; the request was sent
    expect(calls).toEqual([route]);
    expect(refused(calls)).toEqual([]);
  });

  it('the download link the export screen opens is an allowed route', () => {
    expect(refused([`GET ${DOWNLOAD_ROUTE}abc`])).toEqual([]);
  });

  it.each([
    ['DeleteAccountScreen', 'deletionApi'],
    ['DataExportScreen', 'dataExportApi'],
  ])('the table covers every %s call', (screen, client) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'settings', `${screen}.tsx`), 'utf8');
    const used = new Set([...src.matchAll(new RegExp(`${client}\\.(\\w+)\\(`, 'g'))].map((m) => m[1]));
    expect([...used].sort()).toEqual(ROUTES.filter(([s]) => s === screen).map(([, fn]) => fn).sort());
    expect(src).not.toMatch(/import api\b|from ['"][./]+api\/\w+['"]/);
  });
});
