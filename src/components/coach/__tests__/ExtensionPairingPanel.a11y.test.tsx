/**
 * ExtensionPairingPanel — pairing-code accessibility + copy (M5-F) and the
 * support-reference surface (M5-D).
 *
 * Why these are one suite: both exist because the coach has to move information
 * OUT of this screen by hand — six digits into a browser extension, or an error
 * reference into a support conversation. Every assertion here is about that
 * transfer not silently failing.
 *
 * The pairing hook is mocked so each state is driven deterministically; its own
 * behaviour is covered in useExtensionPairing.test.tsx.
 */
import React from 'react';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
    },
  }),
}));

const mockSetString = jest.fn(async () => true);
jest.mock('expo-clipboard', () => ({
  setStringAsync: (...a: unknown[]) => mockSetString(...(a as [])),
}));

let mockHookState: {
  status: string;
  code: string | null;
  supportReference: string | null;
};
jest.mock('../../../hooks/useExtensionPairing', () => ({
  useExtensionPairing: () => ({
    ...mockHookState,
    start: jest.fn(),
    retry: jest.fn(),
    cancel: jest.fn(),
  }),
}));
jest.mock('../../../hooks/useRosterReviewDelta', () => ({
  useRosterReviewDelta: () => ({ delta: 0, refresh: jest.fn() }),
}));
jest.mock('../../../hooks/useReconstructCounts', () => ({
  useReconstructCounts: () => ({ enabled: false, families: [], refresh: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../analytics/posthog.service', () => ({ track: jest.fn() }));

import ExtensionPairingPanel from '../ExtensionPairingPanel';

beforeEach(() => {
  mockSetString.mockReset();
  mockSetString.mockResolvedValue(true);
  mockHookState = { status: 'waiting', code: '482913', supportReference: null };
});

afterEach(() => {
  cleanup();
});

describe('pairing code accessibility (M5-F)', () => {
  it('reads the code digit by digit rather than as one large number', async () => {
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-code').props.accessibilityLabel).toBe(
      'Pairing code 4 8 2 9 1 3',
    );
  });

  it('never announces "undefined" when the code is momentarily absent', async () => {
    mockHookState = { status: 'waiting', code: null, supportReference: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-code').props.accessibilityLabel).toBe('Pairing code ');
  });

  it('caps font scaling and shrinks to fit so a digit can never be clipped', async () => {
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const node = getByTestId('pairing-code');
    expect(node.props.maxFontSizeMultiplier).toBe(1.6);
    expect(node.props.numberOfLines).toBe(1);
    expect(node.props.adjustsFontSizeToFit).toBe(true);
  });

  it('exposes the code as text, not as an unlabelled decoration', async () => {
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-code').props.accessibilityRole).toBe('text');
  });

  it('labels the minting spinner so the wait is announced, not silent', async () => {
    mockHookState = { status: 'minting', code: null, supportReference: null };
    const { getByLabelText } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByLabelText('Preparing your secure pairing code')).toBeTruthy();
  });
});

describe('copy affordance (M5-F)', () => {
  it('offers a labelled copy control with a 44pt touch target', async () => {
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const btn = getByTestId('pairing-copy');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe('Copy pairing code');
    const style = Array.isArray(btn.props.style) ? Object.assign({}, ...btn.props.style) : btn.props.style;
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });

  it('copies the exact code — no spaces, no label text', async () => {
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    await fireEvent.press(getByTestId('pairing-copy'));
    expect(mockSetString).toHaveBeenCalledWith('482913');
  });

  it('confirms only after the clipboard write resolves', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ExtensionPairingPanel platformId="truecoach" />,
    );
    expect(queryByTestId('pairing-copy-status')).toBeNull();
    await fireEvent.press(getByTestId('pairing-copy'));
    await waitFor(() =>
      expect(getByTestId('pairing-copy-status')).toHaveTextContent('Copied to clipboard.'),
    );
  });

  it('says so when the copy FAILS instead of claiming success', async () => {
    // Rule 18. A false "Copied" sends the coach to paste stale clipboard
    // contents into the extension and read an opaque rejection.
    mockSetString.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    await fireEvent.press(getByTestId('pairing-copy'));
    await waitFor(() =>
      expect(getByTestId('pairing-copy-status')).toHaveTextContent(
        'Couldn’t copy — enter the code manually.',
      ),
    );
  });

  it('announces the copy result politely to a screen reader', async () => {
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    await fireEvent.press(getByTestId('pairing-copy'));
    await waitFor(() =>
      expect(getByTestId('pairing-copy-status').props.accessibilityLiveRegion).toBe('polite'),
    );
  });

  it('offers no copy control once there is no code to copy', async () => {
    mockHookState = { status: 'paired', code: null, supportReference: null };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('pairing-copy')).toBeNull();
  });
});

describe('support reference (M5-D)', () => {
  it('shows the server reference on a failure so support can find the request', async () => {
    mockHookState = { status: 'failed', code: null, supportReference: 'req-7f3a91' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-support-reference')).toHaveTextContent(
      'Support reference: req-7f3a91',
    );
  });

  it('reads the reference out for screen readers', async () => {
    mockHookState = { status: 'failed', code: null, supportReference: 'req-7f3a91' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-support-reference').props.accessibilityLabel).toBe(
      'Support reference req-7f3a91',
    );
  });

  it.each(['failed', 'authExpired', 'unavailable', 'expired', 'cancelled'])(
    'shows nothing on %s when the server supplied no reference',
    async (status) => {
      mockHookState = { status, code: null, supportReference: null };
      const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
      expect(queryByTestId('pairing-support-reference')).toBeNull();
    },
  );

  it('shows no reference on the healthy paired state', async () => {
    mockHookState = { status: 'paired', code: null, supportReference: null };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('pairing-support-reference')).toBeNull();
  });
});
