/**
 * Trust & Privacy policy links.
 *
 * What we assert:
 *   1. The Privacy Policy link opens the real policy at the site root
 *      (https://app.trygrowthproject.com/privacy), not helpUrl('/privacy'),
 *      which resolved to /help/privacy (store-package review, gap HP15).
 *   2. The Consumer Health Data Privacy Policy is linked from the screen
 *      (RCW 19.373.010/.020: in-app settings link counts as the homepage).
 *   3. The help-centre link still goes to the help centre.
 *   4. Rendering the screen shows all three links and tapping each one calls
 *      Linking.openURL with its URL.
 *   5. The unsupported data-residency and "only meals and workouts" claims
 *      are gone.
 *   6. OR-112-15 (owner rule: no generic error messages, ever): a link that
 *      does not open names the page and says what to do for its cause:
 *      offline -> connect and tap again; the phone cannot open web links
 *      (canOpenURL false / openURL rejects) -> the exact web address, with
 *      Copy web address; anything else -> the address, the support email and
 *      a reference, Email support. Every failure except offline goes to
 *      Sentry with no email address and no query string. No first-person
 *      copy, no "Please try again later".
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import {
  CONSUMER_HEALTH_POLICY_URL,
  PRIVACY_POLICY_URL,
  PUBLIC_SITE_BASE_URL,
  TERMS_URL,
  helpUrl,
} from '../../config/env';
import { trustCenterLinks } from '../trustCenterLinks';

// Link failures must use the no-PII reporter; the plain one (app-wide user
// tag with email) must not be used for them.
const mockCaptureError = jest.fn();
const mockCapturePlain = jest.fn();
jest.mock('../../services/sentry', () => ({
  captureErrorWithoutPii: (...a: unknown[]) => mockCaptureError(...a),
  captureError: (...a: unknown[]) => mockCapturePlain(...a),
}));

const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a: unknown[]) => mockSetString(...a) }));

// The shared NetInfo mock from jest.setup.js (__setState / __reset).
const netinfo = jest.requireMock('@react-native-community/netinfo');

// Required lazily so that, on a head without these modules, the render tests
// below still run and fail on their assertions rather than on an import.
const failureLib = () => require('../trustCenterLinkFailure');
const supportEmail = (): string => require('../../constants/support').SUPPORT_EMAIL;

jest.mock('../../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../../theme/tokens').default;
  const CanonicalColors = jest.requireActual('../../constants/colors').default;
  const colors = {
    ...CanonicalColors,
    dark: CanonicalColors.textPrimary,
    white: CanonicalColors.textOnPrimary,
    gold: CanonicalColors.warning,
    orange: CanonicalColors.error,
  };
  return {
    useTheme: () => ({
      colors,
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      colorScheme: 'light',
    }),
  };
});

jest.mock('../../lib/analytics', () => ({ track: jest.fn() }));

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.reject(new Error('offline'))) },
  deletionApi: { requestDeletion: jest.fn() },
}));

jest.mock('../../services/dataExportApi', () => ({
  dataExportApi: { requestExport: jest.fn() },
}));

const SCREEN_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'TrustCenterScreen.tsx'),
  'utf8',
);

describe('policy URLs', () => {
  it('points the Privacy Policy at the site root, not the help centre', () => {
    expect(PUBLIC_SITE_BASE_URL).toBe('https://app.trygrowthproject.com');
    expect(PRIVACY_POLICY_URL).toBe('https://app.trygrowthproject.com/privacy');
    expect(PRIVACY_POLICY_URL).not.toContain('/help/');
    expect(helpUrl('/privacy')).not.toBe(PRIVACY_POLICY_URL);
  });

  it('points at the consumer health policy and terms on the same host', () => {
    expect(CONSUMER_HEALTH_POLICY_URL).toBe(
      'https://app.trygrowthproject.com/consumer-health-privacy',
    );
    expect(TERMS_URL).toBe('https://app.trygrowthproject.com/terms');
  });
});

describe('trustCenterLinks', () => {
  it('lists Privacy Policy, Consumer Health Data Privacy Policy and the help centre, in that order', () => {
    const links = trustCenterLinks();
    expect(links.map((l) => l.url)).toEqual([
      PRIVACY_POLICY_URL,
      CONSUMER_HEALTH_POLICY_URL,
      helpUrl(),
    ]);
    expect(links.map((l) => l.label)).toEqual([
      'Privacy Policy',
      'Consumer Health Data Privacy Policy',
      'Visit the help centre',
    ]);
    for (const l of links) {
      expect(l.url).toMatch(/^https:\/\//);
      expect(l.label).not.toContain('!');
    }
  });
});

describe('TrustCenterScreen source', () => {
  it('no longer builds the policy link from helpUrl("/privacy")', () => {
    expect(SCREEN_SRC).not.toMatch(/helpUrl\(\s*['"]\/privacy['"]\s*\)/);
    expect(SCREEN_SRC).toContain('trustCenterLinks()');
  });

  it('drops the unsupported data-residency and coach-scope claims', () => {
    expect(SCREEN_SRC).not.toContain('label="Data residency"');
    expect(SCREEN_SRC).not.toContain('Servers located in US East');
    expect(SCREEN_SRC).not.toContain('outside the US without your consent');
    expect(SCREEN_SRC).not.toContain('only what you log (meals + workouts)');
    expect(SCREEN_SRC).not.toContain('we do not sell, share, or license your data');
  });
});

describe('TrustCenterScreen labels (operator ruling 10-01: "Privacy", "Delete account")', () => {
  it('uses the approved Settings labels', () => {
    expect(SCREEN_SRC).toContain('>Delete account</Text>');
    expect(SCREEN_SRC).toContain('accessibilityLabel="Delete account"');
    // Main #313: the row opens the shared Delete account screen (re-auth,
    // exact date, cancel); there is no inline confirmation alert any more.
    expect(SCREEN_SRC).toContain("navigation?.navigate?.('DeleteAccount')");
    expect(SCREEN_SRC).not.toContain('deletionApi.requestDeletion');
    expect(SCREEN_SRC).not.toMatch(/Delete my account|Delete My Account/);
    expect(SCREEN_SRC).toContain('Open Privacy in Settings to track progress');
    expect(SCREEN_SRC).not.toContain('Data & Privacy');
  });

  it('keeps the policy paths the backend serves (#611 PRIVACY_POLICY_PATH / CONSUMER_HEALTH_POLICY_PATH)', () => {
    expect(new URL(PRIVACY_POLICY_URL).pathname).toBe('/privacy');
    expect(new URL(CONSUMER_HEALTH_POLICY_URL).pathname).toBe('/consumer-health-privacy');
  });
});

describe('TrustCenterScreen render', () => {
  // Imported after the mocks above are registered.
  const TrustCenterScreen = require('../TrustCenterScreen').default;
  let openUrl: jest.SpyInstance;
  let canOpen: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeAll(() => process.on('unhandledRejection', onUnhandled));
  afterAll(() => process.off('unhandledRejection', onUnhandled));

  beforeEach(() => {
    unhandled.length = 0;
    netinfo.__reset();
    mockCaptureError.mockReset();
    mockCapturePlain.mockReset();
    mockSetString.mockReset();
    openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    openUrl.mockRestore();
    canOpen.mockRestore();
    alertSpy.mockRestore();
    expect(unhandled).toEqual([]);
    expect(mockCapturePlain).not.toHaveBeenCalled();
  });

  async function renderScreen() {
    const screen = await render(<TrustCenterScreen navigation={{ goBack: jest.fn() }} />);
    await waitFor(() => expect(screen.getByTestId('trust-link-privacy')).toBeTruthy());
    return screen;
  }

  async function tap(screen: Awaited<ReturnType<typeof renderScreen>>, testID: string) {
    await fireEvent.press(screen.getByTestId(testID));
  }

  function shownMessage(screen: Awaited<ReturnType<typeof renderScreen>>): string {
    return screen.getByTestId('trust-link-failure-message').props.children;
  }

  it('shows the three links and opens each URL, with no failure notice and nothing reported', async () => {
    const screen = await renderScreen();

    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    expect(screen.getByText('Consumer Health Data Privacy Policy')).toBeTruthy();
    expect(screen.getByText('Visit the help centre')).toBeTruthy();

    await tap(screen, 'trust-link-privacy');
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    await tap(screen, 'trust-link-consumer-health');
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(2));
    await tap(screen, 'trust-link-help');
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(3));
    expect(openUrl.mock.calls.map((c) => c[0])).toEqual([
      'https://app.trygrowthproject.com/privacy',
      'https://app.trygrowthproject.com/consumer-health-privacy',
      helpUrl(),
    ]);
    expect(screen.queryByTestId('trust-link-failure')).toBeNull();
    expect(mockCaptureError).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('shows the Roman privacy line and no data-residency row', async () => {
    const screen = await renderScreen();
    expect(
      screen.getByText(
        'Not your coach — your Roman conversations, which are kept until you delete them or your account',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Data residency')).toBeNull();
    expect(screen.queryByText('US East')).toBeNull();
  });

  it('never promises a 180-day Roman deletion (owner 10-01 20:32 / OR-110-1: chats are kept until the client deletes them or the account)', async () => {
    const screen = await renderScreen();
    expect(screen.queryByText(/180 days/)).toBeNull();
    expect(SCREEN_SRC).not.toMatch(/180[- ]day|deleted after/);
  });

  it('offline: names the Privacy Policy, says to connect and tap again, does not try to open, reports nothing', async () => {
    netinfo.__setState({ isConnected: false, isInternetReachable: false });
    const screen = await renderScreen();
    await tap(screen, 'trust-link-privacy');
    await waitFor(() => expect(screen.getByTestId('trust-link-failure')).toBeTruthy());

    expect(shownMessage(screen)).toBe(
      'This phone is offline, so the Privacy Policy did not open. Connect to Wi-Fi or mobile data, then tap the link again.',
    );
    expect(screen.getByTestId('trust-link-failure-message').props.accessibilityRole).toBe('alert');
    expect(screen.queryByTestId('trust-link-failure-address')).toBeNull();
    expect(canOpen).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    expect(mockCaptureError).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();

    // Back online: tapping again opens the page and the notice goes away.
    netinfo.__setState({ isConnected: true, isInternetReachable: true });
    await tap(screen, 'trust-link-privacy');
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith('https://app.trygrowthproject.com/privacy'),
    );
    await waitFor(() => expect(screen.queryByTestId('trust-link-failure')).toBeNull());
  });

  it('offline: the help centre notice names the help centre', async () => {
    netinfo.__setState({ isConnected: false });
    const screen = await renderScreen();
    await tap(screen, 'trust-link-help');
    await waitFor(() => expect(screen.getByTestId('trust-link-failure')).toBeTruthy());
    expect(shownMessage(screen)).toBe(
      'This phone is offline, so the help centre did not open. Connect to Wi-Fi or mobile data, then tap the link again.',
    );
  });

  it('a failed reachability probe alone does not block the tap (the browser opens)', async () => {
    netinfo.__setState({ isConnected: true, isInternetReachable: false });
    const screen = await renderScreen();
    await tap(screen, 'trust-link-privacy');
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith('https://app.trygrowthproject.com/privacy'),
    );
    expect(screen.queryByTestId('trust-link-failure')).toBeNull();
  });

  it('open rejected while the internet is unreachable: offline copy, not reported', async () => {
    netinfo.__setState({ isConnected: true, isInternetReachable: false });
    openUrl.mockRejectedValueOnce(new Error('The Internet connection appears to be offline.'));
    const screen = await renderScreen();
    await tap(screen, 'trust-link-consumer-health');
    await waitFor(() => expect(screen.getByTestId('trust-link-failure')).toBeTruthy());
    expect(shownMessage(screen)).toBe(
      'This phone is offline, so the Consumer Health Data Privacy Policy did not open. Connect to Wi-Fi or mobile data, then tap the link again.',
    );
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('the phone cannot open links (canOpenURL false): exact web address, selectable, Copy web address; reported without PII', async () => {
    canOpen.mockResolvedValue(false);
    mockSetString.mockResolvedValue(true);
    const screen = await renderScreen();
    await tap(screen, 'trust-link-consumer-health');
    await waitFor(() => expect(screen.getByTestId('trust-link-failure')).toBeTruthy());

    expect(shownMessage(screen)).toBe(
      'This phone could not open the Consumer Health Data Privacy Policy in a web browser. Open any browser, on this phone or another device, and go to the address below.',
    );
    const address = screen.getByTestId('trust-link-failure-address');
    expect(address.props.children).toBe('https://app.trygrowthproject.com/consumer-health-privacy');
    expect(address.props.selectable).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();
    expect(screen.queryByTestId('trust-link-failure-email')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('trust-link-failure-copy'));
    await waitFor(() =>
      expect(screen.getByTestId('trust-link-failure-copy-status').props.children).toBe(
        'Web address copied. Paste it into any browser.',
      ),
    );
    expect(mockSetString).toHaveBeenCalledWith(
      'https://app.trygrowthproject.com/consumer-health-privacy',
    );

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [, extras] = mockCaptureError.mock.calls[0];
    expect(extras).toEqual({
      where: 'trust_center.link_open',
      link: 'consumer_health_policy',
      cause: 'cannot_open',
      step: 'can_open_url_false',
      reference: null,
      url: 'https://app.trygrowthproject.com/consumer-health-privacy',
    });
  });

  it('the phone cannot open links (openURL rejects): the Privacy Policy address, and the report carries no query string or email', async () => {
    openUrl.mockRejectedValueOnce(
      new Error(
        "Could not open URL 'https://app.trygrowthproject.com/privacy?token=abc123#frag' for jane.doe@realmail.com: No Activity found",
      ),
    );
    const screen = await renderScreen();
    await tap(screen, 'trust-link-privacy');
    await waitFor(() => expect(screen.getByTestId('trust-link-failure')).toBeTruthy());

    expect(shownMessage(screen)).toBe(
      'This phone could not open the Privacy Policy in a web browser. Open any browser, on this phone or another device, and go to the address below.',
    );
    expect(screen.getByTestId('trust-link-failure-address').props.children).toBe(
      'https://app.trygrowthproject.com/privacy',
    );

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [err, extras] = mockCaptureError.mock.calls[0];
    expect(extras).toMatchObject({
      link: 'privacy_policy',
      cause: 'cannot_open',
      step: 'open_url_rejected',
      url: 'https://app.trygrowthproject.com/privacy',
      error_name: 'Error',
    });
    expect(extras.error_message).toBe(
      "Could not open URL 'https://app.trygrowthproject.com/privacy' for [email]: No Activity found",
    );
    const sent = `${String(err.message)} ${JSON.stringify(extras)}`;
    for (const leaked of ['token', 'abc123', 'frag', 'jane.doe', 'realmail', '@', '?']) {
      expect(sent).not.toContain(leaked);
    }
  });

  it('copy failure says how to select the address instead', async () => {
    canOpen.mockResolvedValue(false);
    mockSetString.mockRejectedValue(new Error('clipboard unavailable'));
    const screen = await renderScreen();
    await tap(screen, 'trust-link-privacy');
    await waitFor(() => expect(screen.getByTestId('trust-link-failure-copy')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('trust-link-failure-copy'));
    await waitFor(() =>
      expect(screen.getByTestId('trust-link-failure-copy-status').props.children).toBe(
        'The web address could not be copied. Press and hold the address to select it.',
      ),
    );
  });

  it('anything else (canOpenURL rejects): the address, the support email and a reference that matches the Sentry report; Email support opens a draft', async () => {
    canOpen.mockRejectedValue(new Error('Unable to open URL: https://app.trygrowthproject.com/privacy?x=1'));
    const screen = await renderScreen();
    await tap(screen, 'trust-link-privacy');
    await waitFor(() => expect(screen.getByTestId('trust-link-failure')).toBeTruthy());

    const message = shownMessage(screen);
    const match = /mention reference ([0-9a-f]{8})\.$/.exec(message);
    expect(match).not.toBeNull();
    const reference = match![1];
    expect(message).toBe(
      `The Privacy Policy did not open on this phone. Open any browser and go to the address below. If it still does not open, email ${supportEmail()} and mention reference ${reference}.`,
    );
    expect(screen.getByTestId('trust-link-failure-address').props.children).toBe(
      'https://app.trygrowthproject.com/privacy',
    );
    expect(openUrl).not.toHaveBeenCalled();

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [err, extras] = mockCaptureError.mock.calls[0];
    expect(err.name).toBe('TrustCenterLinkError');
    expect(extras).toMatchObject({
      where: 'trust_center.link_open',
      link: 'privacy_policy',
      cause: 'unexpected',
      step: 'can_open_url_rejected',
      reference,
      url: 'https://app.trygrowthproject.com/privacy',
      error_message: 'Unable to open URL: https://app.trygrowthproject.com/privacy',
    });
    expect(JSON.stringify(extras)).not.toContain(supportEmail());
    expect(JSON.stringify(extras)).not.toContain('?');

    await fireEvent.press(screen.getByTestId('trust-link-failure-email'));
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    expect(openUrl).toHaveBeenCalledWith(
      `mailto:${supportEmail()}?subject=${encodeURIComponent(
        `Trust & Privacy: the Privacy Policy did not open (reference ${reference})`,
      )}`,
    );
    expect(screen.queryByTestId('trust-link-failure-support')).toBeNull();
  });

  it('anything else, and no email app opens: the shared support email fallback shows the address with Copy and Try again', async () => {
    canOpen.mockRejectedValue(new Error('boom'));
    openUrl.mockRejectedValueOnce(new Error('no mail app'));
    const screen = await renderScreen();
    await tap(screen, 'trust-link-help');
    await waitFor(() => expect(screen.getByTestId('trust-link-failure-email')).toBeTruthy());
    expect(shownMessage(screen)).toMatch(/^The help centre did not open on this phone\./);
    await fireEvent.press(screen.getByTestId('trust-link-failure-email'));
    await waitFor(() => expect(screen.getByTestId('trust-link-failure-support')).toBeTruthy());
    expect(screen.getByTestId('trust-link-failure-support-address').props.children).toBe(
      supportEmail(),
    );
    expect(screen.getByTestId('trust-link-failure-support-retry')).toBeTruthy();
  });

  it('the old generic alert copy is gone from the screen', () => {
    expect(SCREEN_SRC).not.toContain('Could not open this page right now');
    expect(SCREEN_SRC).not.toMatch(/try again later/i);
    expect(SCREEN_SRC).toContain('openTrustCenterLink(link)');
  });
});

describe('link failure copy rules (OR-112-15)', () => {
  const causes = ['offline', 'cannot_open', 'unexpected'] as const;

  it('every link and cause names the page, has a next step, and no generic, first-person or exclaiming copy', () => {
    const { linkFailureMessage, LINK_FAILURE_ACTIONS } = failureLib();
    const all: string[] = [...(Object.values(LINK_FAILURE_ACTIONS) as string[])];
    for (const link of trustCenterLinks()) {
      for (const cause of causes) {
        const message: string = linkFailureMessage(link, {
          cause,
          step: 'unexpected',
          reference: cause === 'unexpected' ? 'ab12cd34' : null,
        });
        all.push(message);
        expect(message).toMatch(new RegExp(`\\b[Tt]he ${link.pageName}\\b`));
        if (cause === 'offline') expect(message).toContain('tap the link again');
        if (cause === 'cannot_open') expect(message).toContain('go to the address below');
        if (cause === 'unexpected') {
          expect(message).toContain(supportEmail());
          expect(message).toContain('reference ab12cd34');
        }
      }
    }
    for (const text of all) {
      expect(text).not.toMatch(/please try again later|try again later|could not open this page|something went wrong/i);
      expect(text).not.toMatch(/\b(we|us|our|ours|i|me|my)\b/i);
      expect(text).not.toContain('!');
    }
  });

  it('names each page as it is labelled', () => {
    expect(trustCenterLinks().map((l) => l.pageName)).toEqual([
      'Privacy Policy',
      'Consumer Health Data Privacy Policy',
      'help centre',
    ]);
  });

  it('sentrySafeText drops query strings, fragments and email addresses; addressWithoutQuery keeps the path', () => {
    const { sentrySafeText, addressWithoutQuery, newLinkFailureReference } = failureLib();
    expect(
      sentrySafeText('open https://a.example.org/p?q=1&t=2#x and intent://b/c?d=e for Ann.Lee+x@mail.co.uk'),
    ).toBe('open https://a.example.org/p and intent://b/c for [email]');
    expect(sentrySafeText('x'.repeat(500))).toHaveLength(200);
    expect(addressWithoutQuery('https://app.trygrowthproject.com/privacy?a=1#b')).toBe(
      'https://app.trygrowthproject.com/privacy',
    );
    expect(newLinkFailureReference()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('openTrustCenterLink never rejects, even when the error reporter throws', async () => {
    const { openTrustCenterLink } = failureLib();
    netinfo.__reset();
    const canOpen = jest.spyOn(Linking, 'canOpenURL').mockRejectedValue(new Error('boom'));
    mockCaptureError.mockImplementation(() => {
      throw new Error('sentry down');
    });
    try {
      const failure = await openTrustCenterLink(trustCenterLinks()[0]);
      expect(failure).toMatchObject({ cause: 'unexpected', step: 'can_open_url_rejected' });
      expect(failure.reference).toMatch(/^[0-9a-f]{8}$/);
    } finally {
      canOpen.mockRestore();
      mockCaptureError.mockReset();
    }
  });
});
