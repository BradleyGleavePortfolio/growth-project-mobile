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
 *      Linking.openURL with its URL; a failed open shows an alert.
 *   5. The unsupported data-residency and "only meals and workouts" claims
 *      are gone.
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

describe('TrustCenterScreen render', () => {
  // Imported after the mocks above are registered.
  const TrustCenterScreen = require('../TrustCenterScreen').default;
  let openUrl: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    openUrl.mockRestore();
    alertSpy.mockRestore();
  });

  it('shows the three links and opens each URL', async () => {
    const screen = await render(<TrustCenterScreen navigation={{ goBack: jest.fn() }} />);
    await waitFor(() => expect(screen.getByTestId('trust-link-privacy')).toBeTruthy());

    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    expect(screen.getByText('Consumer Health Data Privacy Policy')).toBeTruthy();
    expect(screen.getByText('Visit the help centre')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('trust-link-privacy'));
    await fireEvent.press(screen.getByTestId('trust-link-consumer-health'));
    await fireEvent.press(screen.getByTestId('trust-link-help'));
    expect(openUrl.mock.calls.map((c) => c[0])).toEqual([
      'https://app.trygrowthproject.com/privacy',
      'https://app.trygrowthproject.com/consumer-health-privacy',
      helpUrl(),
    ]);
  });

  it('shows the Roman privacy line and no data-residency row', async () => {
    const screen = await render(<TrustCenterScreen navigation={{ goBack: jest.fn() }} />);
    await waitFor(() => expect(screen.getByTestId('trust-link-privacy')).toBeTruthy());
    expect(
      screen.getByText(
        'Not your coach — your Roman conversations, which are deleted after 180 days',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Data residency')).toBeNull();
    expect(screen.queryByText('US East')).toBeNull();
  });

  it('alerts when a policy page cannot be opened', async () => {
    openUrl.mockRejectedValueOnce(new Error('no browser'));
    const screen = await render(<TrustCenterScreen navigation={{ goBack: jest.fn() }} />);
    await waitFor(() =>
      expect(screen.getByTestId('trust-link-consumer-health')).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId('trust-link-consumer-health'));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Policy unavailable',
        'Could not open this page right now. Please try again later.',
      ),
    );
  });
});
