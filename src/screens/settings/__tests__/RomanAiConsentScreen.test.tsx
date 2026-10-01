/**
 * Settings > Data & Privacy > Roman and AI (D2; Opus A-05 on #310).
 *
 * Shows the box 2 choice from GET /me/ai-consent, allows it
 * (POST /me/ai-consent/roman) or withdraws it (DELETE) after a
 * confirmation, says "unavailable right now" while the ledger is not
 * deployed (404 / 503), and points to Delete my account for stopping all
 * collection.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert, AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RomanAiConsentScreen, { choiceOf, RomanAiConsentApi, ROMAN_AI_COPY } from '../RomanAiConsentScreen';
import type { AiConsentOutcome, AiConsentStatusResponse, RomanConsentRecord } from '../../../api/aiConsentApi';
import { AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH } from '../../../lib/consultation/copy';
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

function status(over: Partial<RomanConsentRecord> = {}, copy: AiConsentStatusResponse['copy'] = null): AiConsentStatusResponse {
  return {
    roman: {
      granted: false,
      version: null,
      granted_at: null,
      revoked_at: null,
      current_version: 'client-ai-v3',
      needs_reconsent: false,
      ...over,
    },
    copy,
  };
}
const ALLOWED = status({ granted: true, version: 'client-ai-v3', granted_at: '2026-10-01T10:00:00Z' });
const WITHDRAWN = status({ granted: false, version: 'client-ai-v3', granted_at: '2026-10-01T10:00:00Z', revoked_at: '2026-10-01T11:00:00Z' });

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
    expect(r.getByTestId('roman-ai-account-line').props.children).toMatch(/Delete my account/);
    api.getStatus.mockResolvedValueOnce({ kind: 'ok', status: ALLOWED });
    await fireEvent.press(r.getByTestId('roman-ai-retry'));
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(api.grantRoman).not.toHaveBeenCalled();
  });

  it('a load failure says so calmly and offers a retry', async () => {
    const api = makeApi({ kind: 'error', status: 500 });
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-error'));
    expect(r.getByText(ROMAN_AI_COPY.loadError)).toBeTruthy();
  });

  it('a failed or unavailable action keeps the state and shows a notice', async () => {
    const api = makeApi(
      { kind: 'ok', status: ALLOWED },
      { withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'error', status: 500 })) },
    );
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
    confirmLastAlert('Withdraw');
    await waitFor(() => r.getByTestId('roman-ai-notice'));
    expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.actionError);
    expect(r.getByTestId('roman-ai-allowed')).toBeTruthy();

    api.withdrawRoman.mockResolvedValueOnce({ kind: 'unavailable' });
    await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
    confirmLastAlert('Withdraw');
    await waitFor(() => expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.unavailable));
  });

  it('409 CONSENT_VERSION_MISMATCH on Allow asks for an app update', async () => {
    const api = makeApi(
      { kind: 'ok', status: status() },
      { grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'version_mismatch', current_version: 'client-ai-v4' })) },
    );
    const r = await renderScreen(api);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    confirmLastAlert('Allow');
    await waitFor(() => expect(r.getByTestId('roman-ai-notice').props.children).toBe(ROMAN_AI_COPY.updateApp));
  });

  it('a newer server version: no Allow from this build, but a live grant can still be withdrawn', async () => {
    const newer = status({ granted: true, version: 'client-ai-v3', granted_at: '2026-10-01T10:00:00Z', current_version: 'client-ai-v4' });
    const r = await renderScreen(makeApi({ kind: 'ok', status: newer }));
    await waitFor(() => r.getByTestId('roman-ai-update_app'));
    expect(r.queryByTestId('roman-ai-allow')).toBeNull();
    expect(r.getByTestId('roman-ai-withdraw')).toBeTruthy();
  });

  it('a grant of earlier copy needs re-consent: Allow is offered, Withdraw too', async () => {
    const old = status({ granted: true, version: 'client-ai-v2', granted_at: '2026-09-01T10:00:00Z', needs_reconsent: true });
    const r = await renderScreen(makeApi({ kind: 'ok', status: old }));
    await waitFor(() => r.getByTestId('roman-ai-reconsent'));
    expect(r.getByTestId('roman-ai-allow')).toBeTruthy();
    expect(r.getByTestId('roman-ai-withdraw')).toBeTruthy();
  });

  it('points to Delete my account for stopping all collection', async () => {
    const r = await renderScreen(makeApi({ kind: 'ok', status: ALLOWED }));
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(r.getByTestId('roman-ai-account-line').props.children).toBe(ROMAN_AI_COPY.accountLine);
    await fireEvent.press(r.getByTestId('roman-ai-delete-account'));
    expect(navigation.navigate).toHaveBeenCalledWith('DeleteAccount');
  });

  it('C-9: warns when the server copy for this version does not hash to the app copy', async () => {
    const r = await renderScreen(
      makeApi({ kind: 'ok', status: { ...ALLOWED, copy: { version: 'client-ai-v3', sha256: 'f'.repeat(64) } } }),
    );
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await r.unmount();
    const ok = await renderScreen(
      makeApi({ kind: 'ok', status: { ...ALLOWED, copy: { version: 'client-ai-v3', sha256: AI_CONSENT_COPY_SHA256 } } }),
    );
    await waitFor(() => ok.getByTestId('roman-ai-allowed'));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('copy is plain: no exclamation marks, no medical claims', () => {
    for (const t of Object.values(ROMAN_AI_COPY)) {
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

  it('the Data & Privacy row opens RomanAiConsent, only in builds where the choice exists', () => {
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
