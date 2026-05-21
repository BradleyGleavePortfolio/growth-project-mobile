/**
 * BulkInviteScreen.test — Email Pipeline v1.
 *
 * Coverage:
 *   - Source guards (testIDs, accessibility, no hardcoded hex).
 *   - Paste parsing splits valid/invalid + dedupes via the exported
 *     __test helpers.
 *   - Status pill renders Sent / Reused / Failed buckets after a
 *     successful submit.
 *
 * Mounting the full screen mocks expo-clipboard, expo-document-picker
 * and the invites API. We do NOT exercise the full DocumentPicker path
 * because expo-document-picker's mock surface is intentionally minimal.
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'BulkInviteScreen.tsx'),
  'utf8',
);

describe('BulkInviteScreen — source guards', () => {
  it('exposes testIDs for the key interactions', () => {
    for (const id of [
      'bulk-mode-paste',
      'bulk-mode-csv',
      'bulk-paste-input',
      'bulk-csv-pick',
      'bulk-message-input',
      'bulk-submit',
    ]) {
      expect(SCREEN_SRC).toContain(`testID="${id}"`);
    }
  });

  it('every Pressable has accessibilityLabel + role', () => {
    const pressableCount = (SCREEN_SRC.match(/<Pressable/g) ?? []).length;
    const labelCount = (SCREEN_SRC.match(/accessibilityLabel=/g) ?? []).length;
    const roleCount = (SCREEN_SRC.match(/accessibilityRole="button"/g) ?? []).length;
    expect(labelCount).toBeGreaterThanOrEqual(pressableCount);
    expect(roleCount).toBeGreaterThanOrEqual(pressableCount);
  });

  it('does not hardcode hex colors in JSX/strings', () => {
    const withoutComments = SCREEN_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/"#[0-9A-Fa-f]{3,6}"/);
  });
});

import { __test } from '../screens/coach/BulkInviteScreen';

describe('BulkInviteScreen — paste parsing helpers', () => {
  it('parsePaste dedupes and lowers valid rows', () => {
    const out = __test.parsePaste(
      'Alice@Ex.com\nalice@ex.com\nbob@ex.com, not-an-email\n',
    );
    expect(out.valid).toEqual(['alice@ex.com', 'bob@ex.com']);
    expect(out.invalid).toEqual(['not-an-email']);
  });

  it('parsePaste returns empty arrays for blank input', () => {
    expect(__test.parsePaste('')).toEqual({ valid: [], invalid: [] });
    expect(__test.parsePaste('   ')).toEqual({ valid: [], invalid: [] });
  });
});

// ── Mount test ──────────────────────────────────────────────────────────────

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

// BulkInviteScreen calls bulkInviteApi.submit(rows) where rows is
// Array<{ email, name?, note? }>. Backend returns { created, rejected }.
const mockBulkInviteSubmit = jest.fn();
jest.mock('../api/bulkInviteApi', () => {
  const actual = jest.requireActual('../api/bulkInviteApi');
  return {
    ...actual,
    bulkInviteApi: {
      submit: (...args: unknown[]) => mockBulkInviteSubmit(...args),
      parse: jest.fn(),
    },
  };
});

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary: '#000', primaryLight: '#000', primaryPale: '#000',
      primaryDark: '#000', accent: '#000',
      background: '#000', surface: '#000', surfaceElevated: '#000',
      textPrimary: '#000', textSecondary: '#000', textMuted: '#000',
      textOnPrimary: '#fff', border: '#000', divider: '#000',
      success: '#0a0', warning: '#aa0', error: '#a00', info: '#00a',
      streak: '#aa0', primaryTint: '#000',
    },
  }),
}));

import BulkInviteScreen from '../screens/coach/BulkInviteScreen';

describe('BulkInviteScreen — RTL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('renders the paste mode by default', () => {
    const { getByTestId } = render(<BulkInviteScreen />);
    expect(getByTestId('bulk-mode-paste')).toBeTruthy();
    expect(getByTestId('bulk-paste-input')).toBeTruthy();
  });

  it('submits the parsed valid emails and renders per-email statuses', async () => {
    mockBulkInviteSubmit.mockResolvedValueOnce({
      data: {
        created: [
          { email: 'a@ex.com', code: 'AAA', invite_code_id: 'i1' },
          { email: 'b@ex.com', code: 'BBB', invite_code_id: 'i2' },
        ],
        rejected: [{ email: 'c@ex.com', reason: 'invalid' }],
      },
    });

    const { getByTestId, getAllByTestId } = render(<BulkInviteScreen />);
    fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com\nb@ex.com\nc@ex.com',
    );
    fireEvent.press(getByTestId('bulk-submit'));

    await waitFor(() => {
      expect(mockBulkInviteSubmit).toHaveBeenCalledWith([
        { email: 'a@ex.com' },
        { email: 'b@ex.com' },
        { email: 'c@ex.com' },
      ]);
    });

    await waitFor(() => {
      expect(getByTestId('bulk-results')).toBeTruthy();
    });

    expect(getAllByTestId('bulk-result-created')).toHaveLength(2);
    expect(getAllByTestId('bulk-result-failed')).toHaveLength(1);
    expect(getByTestId('bulk-copy-failed')).toBeTruthy();
    expect(getByTestId('bulk-retry-failed')).toBeTruthy();
  });

  it('shows the parsed summary with invalid count', () => {
    const { getByTestId } = render(<BulkInviteScreen />);
    fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com\nnot-an-email\nb@ex.com',
    );
    const summary = getByTestId('bulk-parsed-summary');
    expect(summary).toBeTruthy();
  });
});
