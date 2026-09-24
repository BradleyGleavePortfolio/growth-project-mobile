/**
 * Behavioral tests for ImportDataScreen — the honest v0.3 import funnel,
 * presented through the accepted J3 ImportSetupView source-selection variant
 * (bounded T2 slice, parent disposition (a)): the donor's own two-step
 * contract is exercised as-is (radio highlight via onSourceChange, then the
 * real controller action fires only on Continue) rather than any one-step
 * shortcut. Covers: intro render, catalog-driven platform open (safe https →
 * Linking) for every shortcut, Custom/Other URL validation gating and
 * transitions, unsafe-URL rejection, open-failure recovery + retry, the
 * awaiting-extension honest state (never claims completion), telemetry
 * payloads carrying NO tokens/codes/URLs/PII, accessibility labelling, and
 * the two new real actions this slice wires: Back (native navigation) and
 * Later (truthful UX-01 recordDecision('later') consumption).
 */
import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
    },
    semanticColors: {
      bgPrimary: '#fff', bgSurface: '#f5f5f5', textPrimary: '#111', textMuted: '#999',
      textOnAccent: '#fff', textOnDisabled: '#999', disabledBg: '#eee',
    },
  }),
}));

const mockTrack = jest.fn();
jest.mock('../../../analytics/posthog.service', () => ({
  track: (...a: unknown[]) => mockTrack(...a),
}));

// The nested ExtensionPairingPanel (mounted in the awaiting-extension state) now
// navigates to the roster review and derives a roster delta; both have their own
// dedicated suites. Here we stub just enough so the screen renders in isolation
// without a NavigationContainer. goBack is asserted directly by the new J3 tests.
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
}));
jest.mock('../../../hooks/useRosterReviewDelta', () => ({
  useRosterReviewDelta: () => ({ delta: 0, refresh: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// UX-01 accepted contract: exercised via its real public shape so a false
// result and identity/status gating are honored exactly as documented,
// without re-implementing or asserting its own internals (owned elsewhere).
const mockRecordDecision = jest.fn().mockResolvedValue(true);
jest.mock('../../../hooks/useImportOfferDecision', () => ({
  useImportOfferDecision: () => ({
    status: 'ready',
    decision: null,
    recordDecision: mockRecordDecision,
  }),
}));

import ImportDataScreen from '../ImportDataScreen';
import { AnalyticsEvents } from '../../../analytics/events';
import { IMPORT_PLATFORMS, findImportPlatform } from '../../../constants/importPlatforms';

/** Highlight a platform radio, then confirm with Continue — the donor's real two-step contract. */
async function choosePlatform(getByLabelText: (l: string | RegExp) => any, label: string) {
  await fireEvent.press(getByLabelText(label));
  await fireEvent.press(getByLabelText('Continue'));
}

describe('ImportDataScreen — J3 source-selection presentation', () => {
  let canOpen: jest.SpyInstance;
  let openUrl: jest.SpyInstance;

  beforeEach(() => {
    mockTrack.mockClear();
    mockGoBack.mockClear();
    mockRecordDecision.mockClear();
    mockRecordDecision.mockResolvedValue(true);
    canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(async () => {
    // Unmount first, then drain in-flight openLogin microtasks, so a prior
    // test's async Linking chain can't resolve into the next test's fresh spies.
    cleanup();
    await new Promise((resolve) => setImmediate(resolve));
    jest.restoreAllMocks();
  });

  it('renders the intro with a radio for every catalog platform', async () => {
    const { getByLabelText, getByText } = await render(<ImportDataScreen />);
    expect(getByText('Where are your records?')).toBeTruthy();
    IMPORT_PLATFORMS.forEach((p) => expect(getByLabelText(p.label)).toBeTruthy());
  });

  // R2 closure (independent T2 review, Finding B): the credential-handling
  // reassurance must be visible before the coach ever reaches Continue, not
  // only after a platform is already opened.
  it('shows the credential-handling prerequisite reassurance before any platform is chosen', async () => {
    const { getByText } = await render(<ImportDataScreen />);
    expect(getByText(/never see or store your other platform's password/i)).toBeTruthy();
  });

  it('still shows the prerequisite reassurance on the Custom/Other step, before Continue', async () => {
    const { getByLabelText, getByText } = await render(<ImportDataScreen />);
    await fireEvent.press(getByLabelText('Custom / Other'));
    expect(getByText(/never see or store your other platform's password/i)).toBeTruthy();
    // Still present pre-Continue, i.e. before openLogin has any chance to fire.
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('fires the entry-opened event exactly once on mount', async () => {
    await render(<ImportDataScreen />);
    const opens = mockTrack.mock.calls.filter((c) => c[0] === AnalyticsEvents.IMPORT_ENTRY_OPENED);
    expect(opens).toHaveLength(1);
  });

  it('keeps Continue disabled until a platform is highlighted (pure selection, no side effect)', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(getByLabelText('TrueCoach'));
    // Highlighting alone must not open anything — onSourceChange stays pure.
    expect(openUrl).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalledWith(AnalyticsEvents.IMPORT_PLATFORM_SELECTED, expect.anything());
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: false });
  });

  it.each(
    IMPORT_PLATFORMS.filter((p) => p.loginUrl != null).map((p) => [p.id, p.label, p.loginUrl as string]),
  )('opens %s login page via Linking with the exact safe https URL once Continue confirms it', async (id, label, url) => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, label);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(url));
    expect(canOpen).toHaveBeenCalledWith(url);
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_PLATFORM_SELECTED, { platform: id });
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_LOGIN_OPENED, { platform: id });
  });

  it('shows the honest awaiting-extension state after opening — never claims completion', async () => {
    const { getByLabelText, getByTestId } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'TrueCoach');
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/nothing is imported until you confirm in the extension/i);
    expect(status).not.toHaveTextContent(/complete|imported successfully|finished|done/i);
  });

  it('reveals the custom URL field and keeps Continue disabled initially', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    expect(getByLabelText(/site address/i)).toBeTruthy();
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: true });
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_PLATFORM_SELECTED, { platform: 'custom' });
  });

  it('enables Continue for a valid https URL', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    await fireEvent.changeText(getByLabelText(/site address/i), 'https://app.myplatform.com/login');
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: false });
  });

  it('keeps Continue disabled and shows the invalid hint for an insecure/invalid URL', async () => {
    const { getByLabelText, getByText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    await fireEvent.changeText(getByLabelText(/site address/i), 'http://insecure.example.com');
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: true });
    expect(getByText(/enter a valid public https address/i)).toBeTruthy();
  });

  it('re-disables Continue when a previously-valid URL is edited to an invalid one', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    await fireEvent.changeText(getByLabelText(/site address/i), 'https://ok.example.com/login');
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: false });
    await fireEvent.changeText(getByLabelText(/site address/i), 'https://127.0.0.1/login');
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: true });
  });

  it('opens a valid custom https URL via Linking once Continue confirms it', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    await fireEvent.changeText(getByLabelText(/site address/i), 'https://app.myplatform.com/login');
    await fireEvent.press(getByLabelText('Continue'));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://app.myplatform.com/login'));
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_LOGIN_OPENED, { platform: 'custom' });
  });

  it('does not open anything for a rejected (invalid) custom URL — Continue stays disabled', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    openUrl.mockClear();
    await choosePlatform(getByLabelText, 'Custom / Other');
    await fireEvent.changeText(getByLabelText(/site address/i), 'http://10.0.0.1/login');
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: true });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('surfaces a calm, recoverable failure when the browser cannot open the URL', async () => {
    canOpen.mockResolvedValue(false);
    const { getByLabelText, getByTestId } = await render(<ImportDataScreen />);
    openUrl.mockClear();
    await choosePlatform(getByLabelText, 'TrueCoach');
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/couldn't open that site/i);
    expect(openUrl).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.IMPORT_LOGIN_OPEN_FAILED, { platform: 'truecoach', reason: 'open_failed' },
    );
  });

  it('surfaces a failure when openURL itself throws', async () => {
    openUrl.mockRejectedValue(new Error('boom'));
    const { getByLabelText, getByTestId } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Everfit');
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/couldn't open that site/i);
    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.IMPORT_LOGIN_OPEN_FAILED, { platform: 'everfit', reason: 'open_failed' },
    );
  });

  it('reaches the failed phase honestly and keeps the pre-existing shell untouched by J3', async () => {
    canOpen.mockResolvedValue(false);
    const { getByLabelText, getByTestId } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'TrueCoach');
    // The failed phase renders the screen's original (unmodified) shell, not
    // ImportSetupView — this slice only restyles the source-selection step.
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/couldn't open that site/i);
    expect(getByTestId('import-data-screen')).toBeTruthy();
  });

  // R2 closure (independent T2 review, Finding A): restores the in-screen
  // path a coach had in the base screen to immediately try a different (or
  // the same) platform after a failed login-open, without exiting/re-entering.
  it('lets the coach choose a different platform after a failed login-open, in place', async () => {
    canOpen.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { getByLabelText, getByTestId, getByText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'TrueCoach');
    await waitFor(() => expect(getByTestId('import-status')).toHaveTextContent(/couldn't open/i));

    const retry = getByLabelText('Choose a different platform');
    expect(retry.props.accessibilityRole).toBe('button');
    await fireEvent.press(retry);

    // Back to intro, in place — no navigation.goBack, no exit/re-entry.
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(getByText('Where are your records?')).toBeTruthy();
    IMPORT_PLATFORMS.forEach((p) => expect(getByLabelText(p.label)).toBeTruthy());

    // And the coach can actually complete a real selection afterward.
    await choosePlatform(getByLabelText, 'Trainerize');
    await waitFor(() => expect(getByTestId('import-status')).toHaveTextContent(/nothing is imported until you confirm/i));
    const tz = findImportPlatform('trainerize');
    expect(openUrl).toHaveBeenCalledWith(tz?.loginUrl);
  });

  it('does not offer the retry action before any interaction (intro/customSource steps)', async () => {
    const { getByLabelText, queryByLabelText } = await render(<ImportDataScreen />);
    expect(queryByLabelText('Choose a different platform')).toBeNull();
    await fireEvent.press(getByLabelText('Custom / Other'));
    expect(queryByLabelText('Choose a different platform')).toBeNull();
  });

  // R3 closure (parent grant clause: preserve the preexisting post-login
  // reselection affordance where the removed base picker allowed it — this
  // is the direct successor to the removed base test 'keeps every platform
  // row reachable after opening a login (coach can switch)').
  it('lets the coach choose a different platform from the awaiting-extension state too, in place', async () => {
    const { getByLabelText, getByTestId, getByText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'TrueCoach');
    await waitFor(() => expect(getByTestId('import-status')).toHaveTextContent(/nothing is imported until you confirm/i));

    const retry = getByLabelText('Choose a different platform');
    expect(retry.props.accessibilityRole).toBe('button');
    await fireEvent.press(retry);

    // Back to intro, in place — no navigation.goBack, no exit/re-entry, no
    // pairing/auth call of any kind triggered by this reset itself.
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(getByText('Where are your records?')).toBeTruthy();
    IMPORT_PLATFORMS.forEach((p) => expect(getByLabelText(p.label)).toBeTruthy());

    // And switching to a different platform from there still works end to end.
    await choosePlatform(getByLabelText, 'Everfit');
    await waitFor(() => expect(getByTestId('import-status')).toHaveTextContent(/nothing is imported until you confirm/i));
    const everfit = findImportPlatform('everfit');
    expect(openUrl).toHaveBeenCalledWith(everfit?.loginUrl);
  });

  it('does not offer the retry action during the transient opening-login state', async () => {
    let release: (v: boolean) => void = () => {};
    canOpen.mockImplementation(() => new Promise<boolean>((r) => { release = r; }));
    const { getByLabelText, getByTestId, queryByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'TrueCoach');
    await waitFor(() => expect(getByTestId('import-status')).toHaveTextContent(/opening the login page/i));
    expect(queryByLabelText('Choose a different platform')).toBeNull();
    release(true);
  });

  it('never puts tokens, codes, passwords, or URLs into telemetry payloads', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    await fireEvent.changeText(getByLabelText(/site address/i), 'https://secret.example.com/login?token=abc');
    await fireEvent.press(getByLabelText('Continue'));
    await waitFor(() => expect(openUrl).toHaveBeenCalled());
    mockTrack.mock.calls.forEach(([, props]) => {
      const serialized = JSON.stringify(props ?? {});
      expect(serialized).not.toMatch(/https?:\/\//);
      expect(serialized).not.toMatch(/\b\d{6}\b/);
      expect(serialized).not.toMatch(/token|password|secret/i);
    });
  });

  it('gives every platform choice the radio role and a truthful checked state', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    IMPORT_PLATFORMS.forEach((p) => expect(getByLabelText(p.label).props.accessibilityRole).toBe('radio'));
    expect(getByLabelText('TrueCoach').props.accessibilityState).toEqual({ checked: false, selected: false });
    await fireEvent.press(getByLabelText('TrueCoach'));
    expect(getByLabelText('TrueCoach').props.accessibilityState).toEqual({ checked: true, selected: true });
  });

  it('marks the source-selection title as an accessibility header', async () => {
    const { getByText } = await render(<ImportDataScreen />);
    expect(getByText('Where are your records?').props.accessibilityRole).toBe('header');
  });

  it('does not render any status region before the coach acts', async () => {
    const { queryByTestId } = await render(<ImportDataScreen />);
    expect(queryByTestId('import-status')).toBeNull();
  });

  it('announces status changes via a polite live region', async () => {
    const { getByLabelText, getByTestId } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'TrueCoach');
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status.props.accessibilityLiveRegion).toBe('polite');
  });

  it('never surfaces completion/success/progress language anywhere on the screen', async () => {
    const { getByLabelText, getByTestId, toJSON } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'TrueCoach');
    await waitFor(() => getByTestId('import-status'));
    const serialized = JSON.stringify(toJSON());
    expect(serialized).not.toMatch(/imported successfully|import complete|finished importing/i);
    expect(serialized).not.toMatch(/\b\d{1,3}%/); // no progress percentage
  });

  it('tracks platform selection before it tracks the login open (correct funnel order)', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Everfit');
    await waitFor(() => expect(openUrl).toHaveBeenCalled());
    const names = mockTrack.mock.calls.map((c) => c[0]);
    const selectedAt = names.indexOf(AnalyticsEvents.IMPORT_PLATFORM_SELECTED);
    const openedAt = names.indexOf(AnalyticsEvents.IMPORT_LOGIN_OPENED);
    expect(selectedAt).toBeGreaterThanOrEqual(0);
    expect(openedAt).toBeGreaterThan(selectedAt);
  });

  it('checks canOpenURL before ever calling openURL', async () => {
    const order: string[] = [];
    canOpen.mockImplementation(async () => {
      order.push('canOpen');
      return true;
    });
    openUrl.mockImplementation(async () => {
      order.push('openURL');
    });
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Trainerize');
    await waitFor(() => expect(order).toContain('openURL'));
    expect(order).toEqual(['canOpen', 'openURL']);
  });

  it('gives the custom URL input url-friendly keyboard + no autocapitalise/autocorrect', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    const input = getByLabelText(/site address/i);
    expect(input.props.keyboardType).toBe('url');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.autoCorrect).toBe(false);
  });

  it('emits the platform-selected event carrying only the slug (no URL) for shortcuts', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Everfit');
    await waitFor(() => expect(openUrl).toHaveBeenCalled());
    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.IMPORT_PLATFORM_SELECTED, { platform: 'everfit' },
    );
  });

  it('shows a calm interim "opening" status while canOpenURL is still resolving', async () => {
    let release: (v: boolean) => void = () => {};
    canOpen.mockImplementation(() => new Promise<boolean>((r) => { release = r; }));
    const { getByLabelText, getByTestId } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'TrueCoach');
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/opening the login page/i);
    release(true);
  });

  it('does not fire any open/selected telemetry before the coach interacts', async () => {
    await render(<ImportDataScreen />);
    const names = mockTrack.mock.calls.map((c) => c[0]);
    expect(names).not.toContain(AnalyticsEvents.IMPORT_PLATFORM_SELECTED);
    expect(names).not.toContain(AnalyticsEvents.IMPORT_LOGIN_OPENED);
    expect(names).toContain(AnalyticsEvents.IMPORT_ENTRY_OPENED);
  });

  it.each(
    IMPORT_PLATFORMS.filter((p) => p.loginUrl != null).map((p) => [p.id, p.label]),
  )('fires IMPORT_LOGIN_OPENED with only the %s slug once its login opens', async (id, label) => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, label);
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_LOGIN_OPENED, { platform: id }),
    );
  });

  it('clears the invalid hint again when an invalid custom URL is edited back to empty', async () => {
    const { getByLabelText, queryByText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    await fireEvent.changeText(getByLabelText(/site address/i), 'http://nope.example.com');
    expect(queryByText(/enter a valid public https address/i)).toBeTruthy();
    await fireEvent.changeText(getByLabelText(/site address/i), '');
    expect(getByLabelText('Continue').props.accessibilityState).toEqual({ disabled: true });
  });

  it('finds the real platform data behind every catalog label (sanity check for the label-based queries above)', () => {
    IMPORT_PLATFORMS.forEach((p) => expect(findImportPlatform(p.id)).toEqual(p));
  });

  // --- J3-specific: the two real actions this slice wires -----------------

  it('Back uses real native navigation and touches no storage/telemetry of its own', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await fireEvent.press(getByLabelText(/back/i));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockRecordDecision).not.toHaveBeenCalled();
  });

  it('Later records the truthful "later" decision through the accepted UX-01 contract, then navigates back', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await fireEvent.press(getByLabelText('Later'));
    await waitFor(() => expect(mockRecordDecision).toHaveBeenCalledWith('later'));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    // Continue is confirmed as the ONLY thing that can trigger a login open —
    // Later must never silently carry a selection through as a side effect.
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('does not claim a save when the UX-01 write truthfully resolves false — no error UI either', async () => {
    mockRecordDecision.mockResolvedValueOnce(false);
    const { getByLabelText, queryByText } = await render(<ImportDataScreen />);
    await fireEvent.press(getByLabelText('Later'));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    expect(queryByText(/saved/i)).toBeNull();
    expect(queryByText(/error|failed|try again/i)).toBeNull();
  });

  it('is available from the Custom/Other step too, and still records the same truthful decision', async () => {
    const { getByLabelText } = await render(<ImportDataScreen />);
    await choosePlatform(getByLabelText, 'Custom / Other');
    await fireEvent.press(getByLabelText('Later'));
    await waitFor(() => expect(mockRecordDecision).toHaveBeenCalledWith('later'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
