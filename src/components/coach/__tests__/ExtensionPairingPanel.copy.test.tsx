/**
 * ExtensionPairingPanel — truthful copy (S6 R3 reimplementation; UX-03a
 * paired-state truth correction).
 *
 * R2 finding S6-R2-A-02: the `failed` and `cancelled` states asserted outcomes
 * mobile cannot know ("Nothing was imported", "No import was started") — there
 * is no import-progress or server-cancel contract. These tests pin the honest
 * replacements and the `identityUnavailable` terminal.
 *
 * UX-03a additionally pins that no state — including the corrected `paired`
 * confirmation — ever claims a retirement, revocation, or disconnect, since no
 * such endpoint exists (brief §2 row 5), and that `expired` follows the
 * fact → remedy → retained-setup pattern (brief §4).
 */
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
    },
  }),
}));

const mockStart = jest.fn();
const mockRetry = jest.fn();
const mockCancel = jest.fn();
let mockHookState: { status: string; code: string | null; supportReference?: string | null };
jest.mock('../../../hooks/useExtensionPairing', () => {
  const actual = jest.requireActual('../../../hooks/useExtensionPairing');
  return {
    PAIRING_REASON_COPY: actual.PAIRING_REASON_COPY,
    useExtensionPairing: () => ({ ...mockHookState, start: mockStart, retry: mockRetry, cancel: mockCancel }),
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'coach@example.com', name: 'Jordan Coach' }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../analytics/posthog.service', () => ({ track: jest.fn() }));

import ExtensionPairingPanel from '../ExtensionPairingPanel';

const FORBIDDEN_CLAIMS = [
  /Nothing was imported/i,
  /No import was started/i,
  /import (is )?complete/i,
  /imported \d+/i,
  /\d+%/,
  /revoked/i,
  /disconnected/i,
  /retired/i,
  /\bsigned out\b/i,
];

function allText(tree: Awaited<ReturnType<typeof render>>): string {
  return tree.toJSON() ? JSON.stringify(tree.toJSON()) : '';
}

beforeEach(() => {
  mockStart.mockClear();
  mockRetry.mockClear();
  mockCancel.mockClear();
});
afterEach(() => cleanup());

describe('ExtensionPairingPanel — copy never asserts what the extension did', () => {
  it.each(['failed', 'cancelled', 'identityUnavailable', 'expired', 'authExpired', 'unavailable', 'paired'])(
    '%s state makes no import-outcome, retirement, revocation, or disconnect claim',
    async (status) => {
      mockHookState = { status, code: null, supportReference: null };
      const tree = await render(<ExtensionPairingPanel platformId="truecoach" />);
      const text = allText(tree);
      for (const re of FORBIDDEN_CLAIMS) expect(text).not.toMatch(re);
      expect(tree.getByTestId(`pairing-${status}`)).toBeTruthy();
    },
  );

  it('failed: says the STATUS could not be checked and points to the extension if a code was already entered', async () => {
    mockHookState = { status: 'failed', code: null, supportReference: null };
    const { getByText } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByText(/could not check the pairing status/i)).toBeTruthy();
    expect(getByText(/already entered a code in the browser extension, check there/i)).toBeTruthy();
    fireEvent.press(getByText('Try again'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('cancelled: says only that THIS device stopped checking; the extension may still be running', async () => {
    mockHookState = { status: 'cancelled', code: null, supportReference: null };
    const { getByText } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByText(/This device stopped checking for the pairing/i)).toBeTruthy();
    expect(getByText(/may still run there/i)).toBeTruthy();
    fireEvent.press(getByText('Start again'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('identityUnavailable: honest bounded-wait terminal with a retry, stating no code was created', async () => {
    mockHookState = { status: 'identityUnavailable', code: null, supportReference: null };
    const { getByText, getByTestId, queryByTestId } = await render(
      <ExtensionPairingPanel platformId="truecoach" />,
    );
    expect(getByText("We couldn't confirm your account")).toBeTruthy();
    expect(getByText(/no pairing code was created/i)).toBeTruthy();
    expect(queryByTestId('pairing-minting')).toBeNull(); // not the indefinite spinner
    fireEvent.press(getByTestId('pairing-retry'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('expired: fact → remedy → retained-setup — states the code expired, the setup is kept, and offers a new code', async () => {
    mockHookState = { status: 'expired', code: null, supportReference: null };
    const { getByText } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByText('This code expired')).toBeTruthy();
    expect(getByText(/setup is kept/i)).toBeTruthy();
    fireEvent.press(getByText('Get a new code'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('paired: shows only the redemption fact — a calm confirmation, never a running-import claim it cannot verify', async () => {
    mockHookState = { status: 'paired', code: null, supportReference: null };
    const tree = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const text = allText(tree);
    expect(text).toMatch(/Connected to your computer/);
    expect(text).not.toMatch(/import (is )?complete/i);
    expect(text).not.toMatch(/\d+%/);
    expect(text).not.toMatch(/running/i);
  });
});
