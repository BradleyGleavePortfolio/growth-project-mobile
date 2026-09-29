/**
 * R1 (Roman status binding) — ExtensionPairingPanel mounts
 * ImportRunStatusJourney for the PAIRED intent only: with the server-issued
 * import_intent_id while `paired`, never without one (legacy unbound rows),
 * and never in any other pairing status. This is the same mount contract
 * S12-B3's ImportRunVerdictCard held (see git history) — R1 retires that
 * card's production mount in favour of the Roman P2 views over the same
 * useImportRunStatus read; exactly one status surface. The journey component
 * itself is stubbed here; its states are covered in
 * ImportRunStatusJourney.test.tsx (and ImportRunVerdictCard.test.tsx still
 * covers the untouched, now-unmounted card component directly).
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
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));
jest.mock('../../../analytics/posthog.service', () => ({ track: jest.fn() }));

const mockJourney = jest.fn();
jest.mock('../ImportRunStatusJourney', () => ({
  __esModule: true,
  default: (props: { importIntentId: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Text: MockText } = require('react-native');
    mockJourney(props);
    return <MockText testID="journey-stub">{props.importIntentId}</MockText>;
  },
}));

import ExtensionPairingPanel from '../ExtensionPairingPanel';

beforeEach(() => mockJourney.mockClear());
afterEach(() => cleanup());

describe('ExtensionPairingPanel — R1 Roman status journey mount', () => {
  it('paired + server intent id → mounts the Roman status journey for exactly that intent', async () => {
    mockHookState = { status: 'paired', code: null, importIntentId: 'intent-42' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('journey-stub')).toHaveTextContent('intent-42');
    expect(mockJourney).toHaveBeenLastCalledWith({ importIntentId: 'intent-42' });
  });

  it.each([[null], [undefined], ['']])('paired without an intent id (%p) → no status journey', async (importIntentId) => {
    mockHookState = { status: 'paired', code: null, importIntentId };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('journey-stub')).toBeNull();
    expect(mockJourney).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'expired', 'failed', 'cancelled'])('%s → no status journey even with an intent id', async (status) => {
    mockHookState = { status, code: status === 'waiting' ? '123456' : null, importIntentId: 'intent-42' };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('journey-stub')).toBeNull();
  });
});
