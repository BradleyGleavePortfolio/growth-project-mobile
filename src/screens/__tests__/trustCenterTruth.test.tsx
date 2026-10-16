/**
 * TRUST-COPY-131 (FW-ACCOUNT-128 U2, U3, U4, the Trust Center part of U5, and
 * FW-COACH): Trust & Privacy says only true, state-driven things.
 *  - U2 / FW-COACH: "Who can see your data" follows the real coach link and
 *    what GET /consent/me says that coach reads (SHARE-UNWIND: no switches;
 *    backend #1061 reports all four logs, an older backend may still withhold
 *    some, and a withheld log is never named). A client with no coach and
 *    a coach account get no coach line and no "Not your coach"; a coach
 *    account never calls /consent (student-only on the server).
 *  - U3: no "Last security update" or "Audit policy" rows and no canned
 *    offline values; the Encryption row stays.
 *  - U4: the Terms of Service is linked.
 *  - U5: the export alert names the real Settings row, My data.
 */
import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { TERMS_URL } from '../../config/env';
import type { CurrentUser } from '../../hooks/useCurrentUser';

jest.mock('../../services/sentry', () => ({ captureErrorWithoutPii: jest.fn(), captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../../theme/ThemeProvider', () => {
  const CanonicalColors = jest.requireActual('../../constants/colors').default;
  const { lightTokens } = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ colors: CanonicalColors, semanticColors: lightTokens }) };
});
jest.mock('../../lib/analytics', () => ({ track: jest.fn() }));
const mockGet = jest.fn();
jest.mock('../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));
const mockRequestExport = jest.fn();
jest.mock('../../services/dataExportApi', () => ({
  dataExportApi: { requestExport: (...a: unknown[]) => mockRequestExport(...a) },
}));
let mockUser: CurrentUser | null = null;
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { roman_crisis_alert: false } }) }));

const netinfo = jest.requireMock('@react-native-community/netinfo');
const TrustCenterScreen = require('../TrustCenterScreen').default;
// Required lazily so the render tests below fail on their assertions on a head without the module.
const copyLib = () => require('../trustCenterSharing');

const SCOPES = ['fitness.workouts', 'fitness.food_macros', 'fitness.body_metrics', 'fitness.habits_progress'] as const;
type Scope = (typeof SCOPES)[number];
const CLIENT: CurrentUser = { id: 'client-1', email: 'client@example.test', role: 'student', coach_id: 'coach-1' };

function consentBody(on: Scope[], ownerAccess?: boolean) {
  return {
    client_id: 'client-1',
    coach_id: 'coach-1',
    consents: SCOPES.map((scope) => ({ scope, granted: on.includes(scope) })),
    ...(ownerAccess === undefined ? {} : { owner_access: ownerAccess }),
  };
}
/** GET /consent/me answers with `answer` (a consent body) or fails with it (anything else). */
function serve(answer: object) {
  const ok = 'consents' in answer;
  mockGet.mockImplementation((url: string) => {
    if (url !== '/consent/me') return Promise.reject(new Error(`unexpected GET ${url}`));
    return ok ? Promise.resolve({ data: answer }) : Promise.reject(answer);
  });
}
function shared(on: Scope[]): Record<Scope, boolean> {
  return Object.fromEntries(SCOPES.map((s) => [s, on.includes(s)])) as Record<Scope, boolean>;
}

const BASE = 'Your coach — your consultation answers, data from connected devices, and the logs you share in Coach sharing';
const NONE = 'Your coach — your consultation answers and data from connected devices';
const ALL = 'Your coach — your consultation answers, data from connected devices, and your workouts, food logs, weigh-ins, check-ins and habits';
const SWITCH_WORDS = /switch|turned off|owner account/i;
const ROMAN_WITH_COACH = 'Not your coach — your Roman conversations, which are kept until you delete them or your account. One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.';
const ROMAN = 'Your Roman conversations are kept until you delete them or your account';
const OLD_COACH_LINE = 'Your coach — your consultation answers, logs, check-ins and connected health data';
const OLD_INFO_ROW = /Your answers and logs are shared with your coach/;

async function renderScreen() {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const screen = await render(<TrustCenterScreen navigation={navigation} />);
  await waitFor(() => expect(screen.getByTestId('trust-link-privacy')).toBeTruthy());
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  netinfo.__reset();
  mockUser = null;
  mockGet.mockImplementation(() => Promise.reject(new Error('offline')));
});

describe('coach line copy (U2, FW-COACH, SHARE-UNWIND)', () => {
  const read = (on: Scope[]) => ({ kind: 'read', state: { coachId: 'coach-1', shared: shared(on) } });

  it.each([
    ['backend #1061: all four reach the coach', read([...SCOPES]), ALL],
    ['older backend, two withheld', read(['fitness.workouts', 'fitness.food_macros']), `${BASE}: workouts and food logs`],
    ['older backend, one withheld', read(['fitness.workouts', 'fitness.food_macros', 'fitness.body_metrics']), `${BASE}: workouts, food logs and weigh-ins`],
    ['older backend, food and check-ins only', read(['fitness.food_macros', 'fitness.habits_progress']), `${BASE}: food logs, check-ins and habits`],
    ['older backend, all four withheld', read([]), NONE],
    ['sharing did not load: no log named', { kind: 'unread' }, BASE],
  ])('%s', (_name, view, line) => {
    expect(copyLib().trustCoachLine(view)).toBe(line);
    expect(copyLib().trustCoachLine(view)).not.toMatch(SWITCH_WORDS);
    expect(copyLib().trustRomanLine(view)).toBe(ROMAN_WITH_COACH);
  });

  it('says nothing about a coach while loading, for a client with no coach, or for a coach account', () => {
    for (const view of [{ kind: 'checking' }, { kind: 'no_coach' }]) {
      expect(copyLib().trustCoachLine(view)).toBeNull();
      expect(copyLib().trustRomanLine(view)).toBe(ROMAN);
    }
  });

  it('every variant is plain, impersonal and claims no exclusive access', () => {
    const views = [
      ...[[], ['fitness.workouts'], [...SCOPES]].map((on) => read(on as Scope[])),
      { kind: 'unread' },
      { kind: 'no_coach' },
    ];
    for (const view of views) {
      for (const text of [copyLib().trustCoachLine(view), copyLib().trustRomanLine(view)].filter(Boolean) as string[]) {
        expect(text).not.toMatch(/\b(we|us|our|ours|i|me|my)\b/i);
        expect(text).not.toMatch(/!|only you|always private/i);
      }
    }
  });
});

describe('who can see your data, rendered (U2, FW-COACH)', () => {
  it.each([
    ['sharing loaded', () => consentBody([], false)],
    ['sharing unavailable', () => new Error('offline')],
  ])('shows the full approved Roman exception when %s', async (_name, answer) => {
    mockUser = CLIENT;
    serve(answer());
    const screen = await renderScreen();
    await screen.findByText(/^Your coach —/);
    const line = screen.getByText(ROMAN_WITH_COACH);
    expect(line.props.children).toBe(ROMAN_WITH_COACH);
    expect(line.props.numberOfLines).toBeUndefined();
  });

  // What each server sends: backend #1061 grants all four for the current coach; an older backend may still
  // withhold a log; the TGP owner account reads every log either way.
  it.each([
    ['backend #1061', () => consentBody([...SCOPES], false), ALL],
    ['backend #1061, owner account coach', () => consentBody([...SCOPES], true), ALL],
    ['older backend, owner account coach with logs withheld', () => consentBody([], true), ALL],
    ['older backend, workouts and food logs only', () => consentBody(['fitness.workouts', 'fitness.food_macros'], false), `${BASE}: workouts and food logs`],
    ['older backend, every log withheld', () => consentBody([], false), NONE],
    ['older backend, no owner_access field', () => consentBody(['fitness.workouts']), `${BASE}: workouts`],
  ])('%s: the line names exactly what the coach reads; the old fixed lines are gone', async (_name, body, line) => {
    mockUser = CLIENT;
    serve(body());
    const screen = await renderScreen();
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.getByText(ROMAN_WITH_COACH)).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/consent/me');
    expect(screen.queryByText(SWITCH_WORDS)).toBeNull();
    expect(screen.queryByText(OLD_COACH_LINE)).toBeNull();
    expect(screen.queryByText(OLD_INFO_ROW)).toBeNull();
  });

  it('a client with no coach (the server answers 400): no coach line, and the Roman line names no coach', async () => {
    mockUser = { ...CLIENT, coach_id: undefined };
    serve({ response: { status: 400 } });
    const screen = await renderScreen();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/consent/me'));
    expect(await screen.findByText(ROMAN)).toBeTruthy();
    expect(screen.queryByText(/^Your coach —/)).toBeNull();
    expect(screen.queryByText(/Not your coach/)).toBeNull();
    expect(screen.queryByText(OLD_INFO_ROW)).toBeNull();
  });

  it('a coach account: /consent is never called, no coach line', async () => {
    mockUser = { id: 'coach-9', email: 'coach@example.test', role: 'coach' };
    const screen = await renderScreen();
    expect(await screen.findByText(ROMAN)).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalledWith('/consent/me');
    expect(screen.queryByText(/^Your coach —/)).toBeNull();
    expect(screen.queryByText(/Not your coach/)).toBeNull();
  });

  it('a client with a coach whose sharing did not load: a line that names no log', async () => {
    mockUser = CLIENT;
    serve(new Error('offline'));
    const screen = await renderScreen();
    expect(await screen.findByText(BASE)).toBeTruthy();
    expect(screen.getByText(ROMAN_WITH_COACH)).toBeTruthy();
  });
});

describe('security status (U3)', () => {
  it('keeps the Encryption row only: no invented update date, no audit version, no trust-meta read', async () => {
    const screen = await renderScreen();
    expect(screen.getByText('Encrypted in transit; secure token storage')).toBeTruthy();
    expect(screen.queryByText('Last security update')).toBeNull();
    expect(screen.queryByText('Audit policy')).toBeNull();
    expect(screen.queryByText(/^Version /)).toBeNull();
    expect(screen.queryByText(/ago$|^Today$|^Yesterday$/)).toBeNull();
    expect(mockGet).not.toHaveBeenCalledWith('/system/trust-meta');
  });
});

describe('links (U4)', () => {
  it('the Terms of Service is linked and opens the terms page', async () => {
    const canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    try {
      const screen = await renderScreen();
      const link = screen.getByTestId('trust-link-terms');
      expect(link.props.children).toBe('Terms of Service');
      expect(link.props.accessibilityLabel).toBe('Open the Terms of Service');
      await fireEvent.press(link);
      await waitFor(() => expect(openUrl).toHaveBeenCalledWith(TERMS_URL));
      expect(TERMS_URL).toBe('https://app.trygrowthproject.com/terms');
    } finally {
      canOpen.mockRestore();
      openUrl.mockRestore();
    }
  });
});

describe('export alert (U5, Trust Center part)', () => {
  it('names My data in Settings, the row that exists for clients and coaches', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      mockRequestExport.mockResolvedValue({});
      const screen = await renderScreen();
      await fireEvent.press(screen.getByLabelText('Request data export'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(alertSpy.mock.calls[0][0]).toBe('Export requested');
      expect(alertSpy.mock.calls[0][1]).toBe(
        'Your data export has been queued. Open My data in Settings to track progress and download the file when ready.',
      );
    } finally {
      alertSpy.mockRestore();
    }
  });
});
