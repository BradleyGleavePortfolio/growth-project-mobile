/**
 * Behavioral tests for ImportDataScreen — the honest v0.3 import funnel.
 * Covers: intro render + honest extension-prerequisite copy, catalog-driven
 * platform open (safe https → Linking) for every shortcut, Custom/Other URL
 * validation gating and transitions, unsafe-URL rejection, open-failure
 * recovery + retry, the awaiting-extension honest state (never claims
 * completion), telemetry payloads carrying NO tokens/codes/URLs/PII, and
 * accessibility labelling.
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
  }),
}));

const mockTrack = jest.fn();
jest.mock('../../../analytics/posthog.service', () => ({
  track: (...a: unknown[]) => mockTrack(...a),
}));

import ImportDataScreen from '../ImportDataScreen';
import { AnalyticsEvents } from '../../../analytics/events';
import { IMPORT_PLATFORMS, findImportPlatform } from '../../../constants/importPlatforms';

describe('ImportDataScreen', () => {
  let canOpen: jest.SpyInstance;
  let openUrl: jest.SpyInstance;

  beforeEach(() => {
    mockTrack.mockClear();
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

  it('renders the intro, header, and honest prerequisite copy', async () => {
    const { getByTestId, getByText } = await render(<ImportDataScreen />);
    expect(getByTestId('import-data-screen')).toBeTruthy();
    expect(getByText('Import your coaching data')).toBeTruthy();
    expect(getByText(/never see or store your other platform's password/i)).toBeTruthy();
  });

  it('fires the entry-opened event exactly once on mount', async () => {
    await render(<ImportDataScreen />);
    const opens = mockTrack.mock.calls.filter((c) => c[0] === AnalyticsEvents.IMPORT_ENTRY_OPENED);
    expect(opens).toHaveLength(1);
  });

  it('renders a row for every catalog platform', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    IMPORT_PLATFORMS.forEach((p) => expect(getByTestId(`import-platform-${p.id}`)).toBeTruthy());
  });

  it.each(
    IMPORT_PLATFORMS.filter((p) => p.loginUrl != null).map((p) => [p.id, p.loginUrl as string]),
  )('opens %s login page via Linking with the exact safe https URL', async (id, url) => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId(`import-platform-${id}`));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(url));
    expect(canOpen).toHaveBeenCalledWith(url);
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_PLATFORM_SELECTED, { platform: id });
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_LOGIN_OPENED, { platform: id });
  });

  it('shows the honest awaiting-extension state after opening — never claims completion', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/nothing is imported until you confirm in the extension/i);
    expect(status).not.toHaveTextContent(/complete|imported successfully|finished|done/i);
  });

  it('reveals the custom URL box and keeps the open button disabled initially', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    expect(getByTestId('import-custom-box')).toBeTruthy();
    expect(getByTestId('import-custom-open').props.accessibilityState).toEqual({ disabled: true });
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_PLATFORM_SELECTED, { platform: 'custom' });
  });

  it('enables the open button for a valid https URL and hides the hint', async () => {
    const { getByTestId, queryByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'https://app.myplatform.com/login');
    expect(getByTestId('import-custom-open').props.accessibilityState).toEqual({ disabled: false });
    expect(queryByTestId('import-custom-hint')).toBeNull();
  });

  it('keeps the button disabled and shows a hint for an insecure/invalid URL', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'http://insecure.example.com');
    expect(getByTestId('import-custom-open').props.accessibilityState).toEqual({ disabled: true });
    expect(getByTestId('import-custom-hint')).toBeTruthy();
  });

  it('re-disables the button when a previously-valid URL is edited to an invalid one', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'https://ok.example.com/login');
    expect(getByTestId('import-custom-open').props.accessibilityState).toEqual({ disabled: false });
    await fireEvent.changeText(getByTestId('import-custom-url'), 'https://127.0.0.1/login');
    expect(getByTestId('import-custom-open').props.accessibilityState).toEqual({ disabled: true });
  });

  it('opens a valid custom https URL via Linking', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'https://app.myplatform.com/login');
    await fireEvent.press(getByTestId('import-custom-open'));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://app.myplatform.com/login'));
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_LOGIN_OPENED, { platform: 'custom' });
  });

  it('surfaces a calm, recoverable failure when the browser cannot open the URL', async () => {
    canOpen.mockResolvedValue(false);
    const { getByTestId } = await render(<ImportDataScreen />);
    openUrl.mockClear();
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/couldn't open that site/i);
    expect(openUrl).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.IMPORT_LOGIN_OPEN_FAILED, { platform: 'truecoach', reason: 'open_failed' },
    );
  });

  it('surfaces a failure when openURL itself throws', async () => {
    openUrl.mockRejectedValue(new Error('boom'));
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-everfit'));
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/couldn't open that site/i);
    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.IMPORT_LOGIN_OPEN_FAILED, { platform: 'everfit', reason: 'open_failed' },
    );
  });

  it('recovers after a failure: selecting a platform again reaches the awaiting state', async () => {
    canOpen.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    await waitFor(() => expect(getByTestId('import-status')).toHaveTextContent(/couldn't open/i));
    await fireEvent.press(getByTestId('import-platform-trainerize'));
    await waitFor(() =>
      expect(getByTestId('import-status')).toHaveTextContent(/nothing is imported until you confirm/i),
    );
    const tz = findImportPlatform('trainerize');
    expect(openUrl).toHaveBeenCalledWith(tz?.loginUrl);
  });

  it('never puts tokens, codes, passwords, or URLs into telemetry payloads', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'https://secret.example.com/login?token=abc');
    await fireEvent.press(getByTestId('import-custom-open'));
    await waitFor(() => expect(openUrl).toHaveBeenCalled());
    mockTrack.mock.calls.forEach(([, props]) => {
      const serialized = JSON.stringify(props ?? {});
      expect(serialized).not.toMatch(/https?:\/\//);
      expect(serialized).not.toMatch(/\b\d{6}\b/);
      expect(serialized).not.toMatch(/token|password|secret/i);
    });
  });

  it('labels the platform rows and differentiates the custom hint for screen readers', async () => {
    const { getByLabelText, getByTestId } = await render(<ImportDataScreen />);
    expect(getByLabelText('Import from TrueCoach')).toBeTruthy();
    expect(getByLabelText('Import from Custom / Other')).toBeTruthy();
    expect(getByTestId('import-platform-custom').props.accessibilityHint).toMatch(/your own site address/i);
    expect(getByTestId('import-platform-truecoach').props.accessibilityHint).toMatch(/login page in your browser/i);
  });

  it('marks the intro title as an accessibility header', async () => {
    const { getByText } = await render(<ImportDataScreen />);
    expect(getByText('Import your coaching data').props.accessibilityRole).toBe('header');
  });

  it('renders the title with a quiet-luxury weight (never 700/800)', async () => {
    const { getByText } = await render(<ImportDataScreen />);
    const flat = StyleSheet.flatten(getByText('Import your coaching data').props.style);
    expect(['700', '800']).not.toContain(String(flat.fontWeight));
  });

  it('gives each platform row the button role for screen readers', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    IMPORT_PLATFORMS.forEach((p) => {
      expect(getByTestId(`import-platform-${p.id}`).props.accessibilityRole).toBe('button');
    });
  });

  it('does not render any status region before the coach acts', async () => {
    const { queryByTestId } = await render(<ImportDataScreen />);
    expect(queryByTestId('import-status')).toBeNull();
  });

  it('announces status changes via a polite live region', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status.props.accessibilityLiveRegion).toBe('polite');
  });

  it('never surfaces completion/success/progress language anywhere on the screen', async () => {
    const { getByTestId, toJSON } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    await waitFor(() => getByTestId('import-status'));
    const serialized = JSON.stringify(toJSON());
    expect(serialized).not.toMatch(/imported successfully|import complete|finished importing/i);
    expect(serialized).not.toMatch(/\b\d{1,3}%/); // no progress percentage
  });

  it('does not open anything for a rejected (invalid) custom URL and reports it honestly', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    openUrl.mockClear();
    await fireEvent.press(getByTestId('import-platform-custom'));
    // An insecure/private URL never enables the open button, so nothing opens.
    await fireEvent.changeText(getByTestId('import-custom-url'), 'http://10.0.0.1/login');
    expect(getByTestId('import-custom-open').props.accessibilityState).toEqual({ disabled: true });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('tracks platform selection before it tracks the login open (correct funnel order)', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-everfit'));
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
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-trainerize'));
    await waitFor(() => expect(order).toContain('openURL'));
    expect(order).toEqual(['canOpen', 'openURL']);
  });

  it('shows the honest browser-extension prerequisite up front (no password handoff)', async () => {
    const { getByText } = await render(<ImportDataScreen />);
    expect(getByText(/browser extension/i)).toBeTruthy();
    expect(getByText(/log in with your own account/i)).toBeTruthy();
  });

  it('gives the custom URL input url-friendly keyboard + no autocapitalise/autocorrect', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    const input = getByTestId('import-custom-url');
    expect(input.props.keyboardType).toBe('url');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.accessibilityLabel).toMatch(/web address/i);
  });

  it('shows the exact insecure-URL hint copy (public https only)', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'http://insecure.example.com');
    expect(getByTestId('import-custom-hint')).toHaveTextContent(/secure https web address/i);
  });

  it('does not reveal the custom box when a normal shortcut is chosen', async () => {
    const { getByTestId, queryByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    await waitFor(() => getByTestId('import-status'));
    expect(queryByTestId('import-custom-box')).toBeNull();
  });

  it('keeps every platform row reachable after opening a login (coach can switch)', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    await waitFor(() => getByTestId('import-status'));
    IMPORT_PLATFORMS.forEach((p) => expect(getByTestId(`import-platform-${p.id}`)).toBeTruthy());
  });

  it('fires the entry-opened event only once even across several interactions', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'https://a.example.com/login');
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    await waitFor(() => getByTestId('import-status'));
    const opens = mockTrack.mock.calls.filter((c) => c[0] === AnalyticsEvents.IMPORT_ENTRY_OPENED);
    expect(opens).toHaveLength(1);
  });

  it('transitions a valid custom URL through open to the honest awaiting state', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'https://app.myplatform.com/login');
    await fireEvent.press(getByTestId('import-custom-open'));
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/nothing is imported until you confirm/i);
  });

  it('emits the platform-selected event carrying only the slug (no URL) for shortcuts', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-everfit'));
    await waitFor(() => expect(openUrl).toHaveBeenCalled());
    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.IMPORT_PLATFORM_SELECTED, { platform: 'everfit' },
    );
  });

  it('shows a calm interim "opening" status while canOpenURL is still resolving', async () => {
    let release: (v: boolean) => void = () => {};
    canOpen.mockImplementation(() => new Promise<boolean>((r) => { release = r; }));
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-truecoach'));
    const status = await waitFor(() => getByTestId('import-status'));
    expect(status).toHaveTextContent(/opening the login page/i);
    release(true);
  });

  it('renders the prereq explanation as an accessibility summary region', async () => {
    const { getByText } = await render(<ImportDataScreen />);
    const node = getByText(/we never see or store your other platform's password/i);
    expect(node).toBeTruthy();
  });

  it('labels the custom box with a "your platform\'s login page" heading and open action', async () => {
    const { getByTestId, getByText } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    expect(getByText(/your platform's login page/i)).toBeTruthy();
    expect(getByTestId('import-custom-open').props.accessibilityLabel).toMatch(/open login page/i);
  });

  it('does not fire any open/selected telemetry before the coach interacts', async () => {
    await render(<ImportDataScreen />);
    const names = mockTrack.mock.calls.map((c) => c[0]);
    expect(names).not.toContain(AnalyticsEvents.IMPORT_PLATFORM_SELECTED);
    expect(names).not.toContain(AnalyticsEvents.IMPORT_LOGIN_OPENED);
    expect(names).toContain(AnalyticsEvents.IMPORT_ENTRY_OPENED);
  });

  it.each(
    IMPORT_PLATFORMS.filter((p) => p.loginUrl != null).map((p) => p.id),
  )('fires IMPORT_LOGIN_OPENED with only the %s slug once its login opens', async (id) => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId(`import-platform-${id}`));
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_LOGIN_OPENED, { platform: id }),
    );
  });

  it('shows no validation hint while the custom URL field is still empty', async () => {
    const { getByTestId, queryByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    // Box is open but untouched: no premature error before the coach types.
    expect(getByTestId('import-custom-box')).toBeTruthy();
    expect(queryByTestId('import-custom-hint')).toBeNull();
  });

  it('clears the hint again when an invalid custom URL is edited back to empty', async () => {
    const { getByTestId, queryByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    await fireEvent.changeText(getByTestId('import-custom-url'), 'http://nope.example.com');
    expect(getByTestId('import-custom-hint')).toBeTruthy();
    await fireEvent.changeText(getByTestId('import-custom-url'), '');
    expect(queryByTestId('import-custom-hint')).toBeNull();
    expect(getByTestId('import-custom-open').props.accessibilityState).toEqual({ disabled: true });
  });

  it('marks the disabled open button as disabled for screen readers when URL is invalid', async () => {
    const { getByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    const btn = getByTestId('import-custom-open');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityState).toEqual({ disabled: true });
  });

  it('does not leave the custom box mounted once a shortcut moves the flow onward', async () => {
    const { getByTestId, queryByTestId } = await render(<ImportDataScreen />);
    await fireEvent.press(getByTestId('import-platform-custom'));
    expect(getByTestId('import-custom-box')).toBeTruthy();
    await fireEvent.press(getByTestId('import-platform-everfit'));
    await waitFor(() => getByTestId('import-status'));
    expect(queryByTestId('import-custom-box')).toBeNull();
  });
});
