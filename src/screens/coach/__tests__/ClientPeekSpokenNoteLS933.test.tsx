/**
 * LS-933 B2: visually shortened notes retain all their words for speech.
 * Real sheet and peekSlices; no native VoiceOver execution is claimed.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { RosterClient } from '../../../utils/coach/clientRoster';

const mockCheckIns = jest.fn();
jest.mock('../../../services/api', () => ({
  coachApi: {
    getClientSummary: async () => ({ data: { today: { entries: [] }, weight_logs: [] } }),
    getClientCheckIns: (...args: unknown[]) => mockCheckIns(...args),
    getClientWeek: async () => ({ data: { week_start: '2026-11-02', today: '2026-11-04', assignments: [] } }),
  },
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForClient: () => ({ isSuccess: false }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const flat = new Proxy({}, { get: () => '#000000' });
  const colors = new Proxy({}, { get: (_target, key) => key === 'surface' || key === 'data' ? flat : '#000000' });
  return { useTheme: () => ({ colors, semanticColors: colors }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../../ui', () => ({ useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../ui/states/QuietStates', () => ({
  QuietLoading: () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'Loading'),
  QuietError: () => null,
}));
import ClientPeekSheet from '../lookup/ClientPeekSheet';

const client = {
  id: 'c1', firstName: 'Jordan', lastName: 'Reyes', status: 'active',
  createdAt: '2026-08-14', activity: { lastActiveOn: '2026-11-04', checkInsToReview: 0 },
} as RosterClient;

it.each(['\n', '\r\n'])('spoken check-in retains the full multiline note (%j)', async (newline) => {
  const lastLine = 'Second line: a good walk after lunch.';
  const note = `First line: slept well.${newline}${lastLine}`;
  mockCheckIns.mockResolvedValue({
    data: [{ id: 'k1', date: '2026-11-04', energy: 4, notes: note }],
  });
  await render(<ClientPeekSheet client={client} onClose={jest.fn()} onOpen={jest.fn()} onNudge={jest.fn()} />);
  await waitFor(() => expect(screen.queryByText('Loading')).toBeNull());
  const value = screen.getByTestId('peek-value-checkins');
  // The row has a separate Review action and is not an accessible group.
  // Therefore inspect the value's spoken override or its actual Text content.
  const spoken = value.props.accessibilityLabel ?? value.props.children;
  expect(spoken).toContain('energy 4 of 5');
  expect(spoken).toContain('First line: slept well.');
  expect(spoken).toContain(lastLine);
});
