/**
 * Settings > Privacy > Roman and AI (D2; Opus A-05 on #310).
 *
 * Shows the box 2 choice from GET /me/ai-consent, allows it
 * (POST /me/ai-consent/roman) or withdraws it (DELETE) after a
 * confirmation, says "unavailable right now" while the ledger is not
 * deployed (404 / 503), and points to Delete account for stopping all
 * collection.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert, AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RomanAiConsentScreen, { actionNoticeOf, choiceOf, headOf, RomanAiConsentApi, ROMAN_AI_COPY } from '../RomanAiConsentScreen';
import { captureError } from '../../../services/sentry';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH } from '../../../lib/consultation/copy';
import { logger } from '../../../utils/logger';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#123456' }),
  }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

/** A #622 status body. Defaults to "not granted". */
function status(over: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    purpose: 'client_ai_processing',
    processor: 'anthropic',
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: 'client-ai-v3',
    needs_reconsent: false,
    copy: null,
    ...over,
  };
}
const ALLOWED = status({ granted: true, state: 'granted', version: 'client-ai-v3', granted_at: '2026-10-01T10:00:00Z' });
const WITHDRAWN = status({ state: 'withdrawn', version: 'client-ai-v3', withdrawn_at: '2026-10-01T11:00:00Z' });

function makeApi(first: AiConsentOutcome, over: Partial<Record<keyof RomanAiConsentApi, jest.Mock>> = {}) {
  return {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => first),
    grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: ALLOWED })),
    withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: WITHDRAWN })),
    ...over,
  };
}

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const renderScreen = (api: RomanAiConsentApi) =>
  render(<RomanAiConsentScreen navigation={navigation as never} api={api} />);

/** Press the confirm button of the most recent Alert. */
function confirmLastAlert(label: string) {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1][2] as AlertButton[];
  const b = buttons.find((x) => x.text === label);
  if (!b?.onPress) throw new Error(`no ${label} button`);
  b.onPress();
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  navigation.navigate.mockClear();
  (logger.warn as jest.Mock).mockClear();
});
afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

describe('RomanAiConsentScreen', () => {
  it('allowed: shows the state and the D2 paragraph; Withdraw asks first, then DELETEs', async () => {
    const api = makeApi({ kind: 'ok', status: ALLOWED });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(r.getByTestId('roman-ai-state').props.children).toBe('Allowed');
    expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    expect(r.queryByTestId('roman-ai-allow')).toBeNull();

    await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
    expect(Alert.alert).toHaveBeenCalledWith(ROMAN_AI_COPY.confirmWithdrawTitle, ROMAN_AI_COPY.confirmWithdrawBody, expect.any(Array));
    expect(api.withdrawRoman).not.toHaveBeenCalled(); // nothing until confirmed

    confirmLastAlert('Withdraw');
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    expect(api.withdrawRoman).toHaveBeenCalledTimes(1);
    expect(r.getByTestId('roman-ai-state').props.children).toBe('Not allowed');
  });

  it('cancelling the confirmation changes nothing', async () => {
    const api = makeApi({ kind: 'ok', status: ALLOWED });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
    const calls = (Alert.alert as jest.Mock).mock.calls;
    const cancel = (calls[calls.length - 1][2] as AlertButton[]).find((b) => b.style === 'cancel');
    expect(cancel?.text).toBe('Cancel');
    expect(api.withdrawRoman).not.toHaveBeenCalled();
    expect(r.getByTestId('roman-ai-allowed')).toBeTruthy();
  });

  it('not allowed: Allow asks first, then POSTs this build\u2019s version and copy hash', async () => {
    const api = makeApi({ kind: 'ok', status: status() });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    expect(r.queryByTestId('roman-ai-withdraw')).toBeNull();
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    expect(api.grantRoman).not.toHaveBeenCalled();
    confirmLastAlert('Allow');
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(api.grantRoman).toHaveBeenCalledWith({ version: 'client-ai-v3', copy_sha256: AI_CONSENT_COPY_SHA256, platform: 'ios' });
  });

  it.each([404, 503])('endpoint %s: "unavailable right now", nothing recorded, retry reloads', async () => {
    const api = makeApi({ kind: 'unavailable' });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-unavailable'));
    expect(r.getByText(ROMAN_AI_COPY.unavailable)).toBeTruthy();
    expect(r.queryByTestId('roman-ai-allow')).toBeNull();
    expect(r.queryByTestId('roman-ai-withdraw')).toBeNull();
    // The account line is still there.
    expect(r.getByTestId('roman-ai-account-line').props.children).toMatch(/Settings > Account > Delete account/);
    api.getStatus.mockResolvedValueOnce({ kind: 'ok', status: ALLOWED });
    await fireEvent.press(r.getByTestId('roman-ai-retry'));
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(api.grantRoman).not.toHaveBeenCalled();
  });

  it('owner rule 13:34: a load failure offline says so and offers a retry; nothing goes to Sentry', async () => {
    (captureError as jest.Mock).mockClear();
    const api = makeApi({ kind: 'error', status: null });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-error'));
    expect(r.getByText(ROMAN_AI_COPY.loadOffline)).toBeTruthy();
    expect(r.getByTestId('roman-ai-retry')).toBeTruthy();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('owner rule 13:34: an unexpected load failure shows a short reference and support, and goes to Sentry', async () => {
    (captureError as jest.Mock).mockClear();
    const api = makeApi({ kind: 'error', status: 500, requestId: '3f9c2a71-0000-4000-8000-000000000000' });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-error'));
    const text = ROMAN_AI_COPY.loadServer('3f9c2a71');
    expect(r.getByText(text)).toBeTruthy();
    expect(text).toMatch(/reference 3f9c2a71/);
    expect(text).toMatch(/Bradley@Bradleytgpcoaching\.com/);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect((captureError as jest.Mock).mock.calls[0][1]).toMatchObject({ status: 500, request_id: '3f9c2a71-0000-4000-8000-000000000000' });
  });

  it('owner rule 13:34: every action failure says what happened and what to do; none is generic', () => {
    const cases: Array<[Extract<AiConsentOutcome, { kind: 'error' }>, string]> = [
      [{ kind: 'error', status: null }, ROMAN_AI_COPY.actionOffline],
      [{ kind: 'error', status: 429 }, ROMAN_AI_COPY.actionBusy],
      [{ kind: 'error', status: 409, code: 'AI_CONSENT_CONFLICT' }, ROMAN_AI_COPY.actionConflict],
      [{ kind: 'error', status: 500, requestId: 'abcdef12-zz' }, ROMAN_AI_COPY.actionServer('abcdef12')],
      [{ kind: 'error', status: 400 }, ROMAN_AI_COPY.actionServer(null)],
    ];
    for (const [out, expected] of cases) {
      const msg = actionNoticeOf(out, 'withdraw');
      expect(msg).toBe(expected);
      expect(msg).not.toMatch(/went wrong|did not go through/i);
      expect(msg).not.toMatch(/^Please try again\.?$/);
    }
    for (const v of Object.values(ROMAN_AI_COPY)) {
      const text = typeof v === 'function' ? v('abc12345') : v;
      expect(text).not.toMatch(/!|went wrong/);
    }
  });

  it('a failed or unavailable action re-reads the state, keeps it, and shows a specific notice', async () => {
    const api = makeApi(
      { kind: 'ok', status: ALLOWED },
      { withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'error', status: 500 })) },
    );
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
    confirmLastAlert('Withdraw');
    await waitFor(() => r.getByTestId('roman-ai-notice'));
    expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.actionServer(null));
    expect(r.getByTestId('roman-ai-allowed')).toBeTruthy();
    expect(api.getStatus).toHaveBeenCalledTimes(2);

    api.withdrawRoman.mockResolvedValueOnce({ kind: 'unavailable' });
    await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
    confirmLastAlert('Withdraw');
    await waitFor(() => expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.unavailable));
  });

  it('409 CONSENT_VERSION_MISMATCH on Allow asks for an app update', async () => {
    const api = makeApi(
      { kind: 'ok', status: status() },
      { grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'version_mismatch' })) },
    );
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    confirmLastAlert('Allow');
    await waitFor(() => expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.updateApp));
    // #622: the 409 carries no version, so the screen re-reads the state.
    expect(api.getStatus).toHaveBeenCalledTimes(2);
  });

  it('a newer server version: no Allow from this build, but a live grant can still be withdrawn', async () => {
    const newer = status({ state: 'needs_reconsent', needs_reconsent: true, version: 'client-ai-v3', granted_at: '2026-10-01T10:00:00Z', current_version: 'client-ai-v4' });
    const r = await renderScreen(makeApi({ kind: 'ok', status: newer }));
    await waitFor(() => r.getByTestId('roman-ai-update_app'));
    expect(r.queryByTestId('roman-ai-allow')).toBeNull();
    expect(r.getByTestId('roman-ai-withdraw')).toBeTruthy();
  });

  it('a grant of earlier copy needs re-consent: Allow is offered, Withdraw too', async () => {
    const old = status({ state: 'needs_reconsent', version: 'client-ai-v2', granted_at: '2026-09-01T10:00:00Z', needs_reconsent: true });
    const r = await renderScreen(makeApi({ kind: 'ok', status: old }));
    await waitFor(() => r.getByTestId('roman-ai-reconsent'));
    expect(r.getByTestId('roman-ai-allow')).toBeTruthy();
    expect(r.getByTestId('roman-ai-withdraw')).toBeTruthy();
  });

  it('C-310-2: a newer server version with no live grant reads Not allowed', async () => {
    const newer = status({ state: 'needs_reconsent', needs_reconsent: true, granted: false, version: 'client-ai-v3', granted_at: '2026-10-01T10:00:00Z', current_version: 'client-ai-v4' });
    const r = await renderScreen(makeApi({ kind: 'ok', status: newer }));
    await waitFor(() => r.getByTestId('roman-ai-update_app'));
    expect(r.getByTestId('roman-ai-state').props.children).toBe('Not allowed');
  });

  it('C-310-2: a grant of earlier copy reads Not allowed', async () => {
    const old = status({ state: 'needs_reconsent', needs_reconsent: true, granted: false, version: 'client-ai-v2', granted_at: '2026-09-01T10:00:00Z' });
    const r = await renderScreen(makeApi({ kind: 'ok', status: old }));
    await waitFor(() => r.getByTestId('roman-ai-reconsent'));
    expect(r.getByTestId('roman-ai-state').props.children).toBe('Not allowed');
    expect(headOf(old)).toBe('Not allowed');
    expect(headOf(ALLOWED)).toBe('Allowed');
  });

  it('C-310-2: granted at the server\'s newer version (another device) reads Allowed', async () => {
    const live = status({ state: 'granted', granted: true, version: 'client-ai-v4', granted_at: '2026-10-01T10:00:00Z', current_version: 'client-ai-v4' });
    const r = await renderScreen(makeApi({ kind: 'ok', status: live }));
    await waitFor(() => r.getByTestId('roman-ai-update_app'));
    expect(r.getByTestId('roman-ai-state').props.children).toBe('Allowed');
  });

  it('C-310-4: the whole screen is excluded from analytics autocapture', async () => {
    const r = await renderScreen(makeApi({ kind: 'ok', status: ALLOWED }));
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(r.getByTestId('roman-ai-screen').props['ph-no-capture']).toBe(true);
  });

  it('points to Delete account for stopping all collection', async () => {
    const r = await renderScreen(makeApi({ kind: 'ok', status: ALLOWED }));
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(r.getByTestId('roman-ai-account-line').props.children).toBe(ROMAN_AI_COPY.accountLine);
    await fireEvent.press(r.getByTestId('roman-ai-delete-account'));
    expect(navigation.navigate).toHaveBeenCalledWith('DeleteAccount');
  });

  it('C-9: warns when the server copy for this version is not the app copy (hash or text)', async () => {
    const copy = (over: object = {}) => ({
      version: 'client-ai-v3',
      paragraph: { text: AI_CONSENT_PARAGRAPH, sha256: 'x' },
      box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: 'y' },
      sha256: AI_CONSENT_COPY_SHA256,
      ...over,
    });
    for (const [c, warns] of [
      [copy(), false],
      [copy({ sha256: 'f'.repeat(64) }), true],
      [copy({ paragraph: { text: 'Different words', sha256: 'x' } }), true],
    ] as const) {
      (logger.warn as jest.Mock).mockClear();
      const r = await renderScreen(makeApi({ kind: 'ok', status: { ...ALLOWED, copy: c } }));
      await waitFor(() => r.getByTestId('roman-ai-allowed'));
      expect((logger.warn as jest.Mock).mock.calls.length).toBe(warns ? 1 : 0);
      await r.unmount();
    }
  });

  it('copy is plain: no exclamation marks, no medical claims', () => {
    for (const v of Object.values(ROMAN_AI_COPY)) {
      const t = typeof v === 'function' ? v('abc12345') : v;
      expect(t).not.toMatch(/!/);
      expect(t).not.toMatch(/diagnos|treat|cure/i);
    }
  });

  it('choiceOf: a revoked grant is not allowed', () => {
    expect(choiceOf(WITHDRAWN)).toEqual({ choice: 'not_allowed', withdrawable: false });
    expect(choiceOf(ALLOWED)).toEqual({ choice: 'allowed', withdrawable: true });
  });
});

describe('Settings entry and route', () => {
  const root = path.resolve(__dirname, '../../..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('section and row labels match the approved copy: Settings > Privacy, Settings > Account > Delete account', () => {
    const settings = read('screens/client/SettingsScreen.tsx');
    expect(settings).toMatch(/<Text style=\{styles\.sectionLabel\}>Privacy<\/Text>/);
    expect(settings).not.toMatch(/Data & Privacy/);
    expect(settings).not.toMatch(/Delete my account/);
    // The Delete account row sits in the Account section (before the next section label).
    const account = settings.indexOf('<Text style={styles.sectionLabel}>Account</Text>');
    const del = settings.indexOf('>Delete account</Text>');
    const next = settings.indexOf('<Text style={styles.sectionLabel}>', account + 1);
    expect(account).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(account);
    expect(del).toBeLessThan(next);
    // Roman and AI sits in the Privacy section.
    const privacy = settings.indexOf('<Text style={styles.sectionLabel}>Privacy</Text>');
    expect(settings.indexOf("navigate('RomanAiConsent')")).toBeGreaterThan(privacy);
    expect(ROMAN_AI_COPY.accountLine).toMatch(/Settings > Account > Delete account\.$/);
    expect(ROMAN_AI_COPY.deleteAccount).toBe('Delete account');
  });

  it('the Privacy row opens RomanAiConsent, only in builds where the choice exists', () => {
    const settings = read('screens/client/SettingsScreen.tsx');
    const gate = settings.search(/\{featureFlags\.consultationOnboarding \|\| featureFlags\.romanChat \? \(/);
    const row = settings.search(/navigation\.navigate\('RomanAiConsent'\)/);
    expect(gate).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(gate);
    expect(settings).toMatch(/testID="settings-roman-ai"/);
  });

  it('the More stack registers the screen next to DeleteAccount', () => {
    const nav = read('navigation/ClientNavigator.tsx');
    expect(nav).toMatch(/name="RomanAiConsent" component=\{RomanAiConsentScreen\}/);
    expect(nav).toMatch(/name="DeleteAccount"/);
  });
});
