/**
 * DES-BB-127: privacy and data screens. Calm look (no card fills, shadows,
 * legacy palette; radius <= 4; Cormorant <= 500; text >= 13 pt), true copy,
 * and Trust Center action parity.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../services/sentry', () => ({
  captureErrorWithoutPii: jest.fn(),
  captureError: jest.fn(),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../../theme/ThemeProvider', () => {
  const CanonicalColors = jest.requireActual('../../constants/colors').default;
  return { useTheme: () => ({ colors: CanonicalColors }) };
});
const mockTrack = jest.fn();
jest.mock('../../lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.reject(new Error('offline'))) },
}));
const mockRequestExport = jest.fn();
jest.mock('../../services/dataExportApi', () => ({
  dataExportApi: { requestExport: (...a: unknown[]) => mockRequestExport(...a) },
}));

const ROOT = path.resolve(__dirname, '..');
const FILES: Record<string, string> = {
  TrustCenterScreen: 'TrustCenterScreen.tsx',
  DataExportScreen: 'settings/DataExportScreen.tsx',
  DeleteAccountScreen: 'settings/DeleteAccountScreen.tsx',
  BlockedUsersScreen: 'settings/BlockedUsersScreen.tsx',
};
const src = (name: string) => fs.readFileSync(path.join(ROOT, FILES[name]), 'utf8');

describe.each(Object.keys(FILES))('%s look', (name) => {
  const code = src(name);

  it('has no cream card fills, shadows or legacy fixed palette', () => {
    expect(code).not.toMatch(/backgroundColor:\s*colors\.(surface|primaryPale)\b/);
    expect(code).not.toMatch(/shadows\.|\.\.\.shadow/);
    expect(code).not.toMatch(/constants\/colors['"]/);
    expect(code).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
  });

  it('keeps radius <= 4, Cormorant <= 500 and text >= 13 pt (overlines use the 11 pt eyebrow token)', () => {
    for (const m of code.matchAll(/borderRadius:\s*(\d+)/g)) expect(Number(m[1])).toBeLessThanOrEqual(4);
    expect(code).not.toMatch(/Radius\.(xl|full)|borderRadius:\s*Radius\.lg \* /);
    expect(code).not.toMatch(/CormorantGaramond_(600|700)/);
    for (const m of code.matchAll(/fontSize:\s*(\d+)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(13);
    expect(code).not.toMatch(/typography\.caption\.fontSize/);
    expect(code).not.toMatch(/fontWeight:\s*'(700|800)'/);
  });
});

describe('true copy', () => {
  it('Trust Center: the export line says when the file is really ready', () => {
    const code = src('TrustCenterScreen');
    expect(code).not.toContain('Receive all your data within 24 hours');
    expect(code).toContain('Usually ready to download in about a minute');
  });

  it('Delete account: the export reminder names the real Settings row', () => {
    const code = src('DeleteAccountScreen');
    expect(code).not.toMatch(/Data\s+(&amp;|&)\s+Privacy/);
    expect(code).toContain('Before deleting, consider downloading a copy of your data from My data in Settings,');
    expect(code).toContain('under Privacy and data.');
  });

  it('Blocked users: the error state never asks for a pull gesture it does not have', () => {
    const code = src('BlockedUsersScreen');
    expect(code).not.toMatch(/Pull to retry/i);
    expect(code).not.toMatch(/Something went wrong/);
  });
});

describe('Trust Center parity (routes/actions before -> after)', () => {
  const TrustCenterScreen = require('../TrustCenterScreen').default;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => alertSpy.mockRestore());

  it('back, export, delete and the three policy links all stay reachable', async () => {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    mockRequestExport.mockResolvedValue({});
    const screen = await render(<TrustCenterScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByTestId('trust-link-privacy')).toBeTruthy());

    expect(screen.getByText('Trust & Privacy')).toBeTruthy();
    for (const id of ['trust-link-privacy', 'trust-link-consumer-health', 'trust-link-help']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }

    await fireEvent.press(screen.getByLabelText('Go back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByLabelText('Request data export'));
    await waitFor(() => expect(mockRequestExport).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith('data_export_requested');
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toBe('Export requested');
    expect(alertSpy.mock.calls[0][1]).toContain('Open Privacy in Settings to track progress');

    await fireEvent.press(screen.getByLabelText('Delete account'));
    expect(navigation.navigate).toHaveBeenCalledWith('DeleteAccount');
    expect(mockTrack).toHaveBeenCalledWith('account_deletion_opened');
  });
});
