/**
 * S12-B3 — ExtensionPairingPanel mounts ImportRunVerdictCard for the PAIRED
 * intent only: with the server-issued import_intent_id while `paired`, never
 * without one (legacy unbound rows), and never in any other pairing status.
 * The card itself is stubbed; its states are covered in
 * ImportRunVerdictCard.test.tsx.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
    },
  }),
}));

let mockHookState: { status: string; code: string | null; importIntentId?: string | null };
jest.mock('../../../hooks/useExtensionPairing', () => {
  const actual = jest.requireActual('../../../hooks/useExtensionPairing');
  return {
    PAIRING_REASON_COPY: actual.PAIRING_REASON_COPY,
    useExtensionPairing: () => ({ ...mockHookState, start: jest.fn(), retry: jest.fn(), cancel: jest.fn() }),
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'coach@example.com' }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../analytics/posthog.service', () => ({ track: jest.fn() }));

const mockCard = jest.fn();
jest.mock('../ImportRunVerdictCard', () => ({
  __esModule: true,
  default: (props: { importIntentId: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Text: MockText } = require('react-native');
    mockCard(props);
    return <MockText testID="verdict-stub">{props.importIntentId}</MockText>;
  },
}));

import ExtensionPairingPanel from '../ExtensionPairingPanel';

beforeEach(() => mockCard.mockClear());
afterEach(() => cleanup());

describe('ExtensionPairingPanel — S12-B3 verdict mount', () => {
  it('paired + server intent id → mounts the verdict card for exactly that intent', async () => {
    mockHookState = { status: 'paired', code: null, importIntentId: 'intent-42' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('verdict-stub')).toHaveTextContent('intent-42');
    expect(mockCard).toHaveBeenLastCalledWith({ importIntentId: 'intent-42' });
  });

  it.each([[null], [undefined], ['']])('paired without an intent id (%p) → no verdict card', async (importIntentId) => {
    mockHookState = { status: 'paired', code: null, importIntentId };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('verdict-stub')).toBeNull();
    expect(mockCard).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'expired', 'failed', 'cancelled'])('%s → no verdict card even with an intent id', async (status) => {
    mockHookState = { status, code: status === 'waiting' ? '123456' : null, importIntentId: 'intent-42' };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('verdict-stub')).toBeNull();
  });
});
