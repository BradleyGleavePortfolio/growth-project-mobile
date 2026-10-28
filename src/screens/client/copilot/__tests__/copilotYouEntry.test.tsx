/**
 * #878 fix round 3 (FR-852X; Opus B-878R3-1, Sol B-878-E): with every switch on, the You tab (youTabV2, the tab every
 * V1 client has) draws Your path as style A's new row (GOAL 01 .lrow.new), leading its group, and it opens Copilot.
 * The You sections and every other row stay as C9 drew them.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ navigate: jest.fn() }) }),
  useFocusEffect: () => undefined,
}));
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: new Proxy({}, { get: (_t, k: string) => mockFlags[k] ?? false }) }));
jest.mock('../../../../config/healthConnect', () => ({ isAndroidHealthConnectEnabled: () => false }));
jest.mock('../../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../../theme/tokens').colors, semanticColors: jest.requireActual('../../../../theme/tokens').lightTokens }),
}));
jest.mock('@expo/vector-icons', () => {
  const { View: V } = jest.requireActual('react-native');
  return { Ionicons: (p: { size: number; color: string; name: string }) => <V accessibilityHint={`${p.name} ${p.size} ${p.color}`} /> };
});
jest.mock('../../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../../components/tutorial/TutorialTarget', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn() } }));
jest.mock('../../../../utils/haptics', () => ({ warningTap: jest.fn() }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1', name: 'Jordan Lee', role: 'student', coach_id: 'c1' }) }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
jest.mock('../../../../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => ({ data: [] }) }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { id: 'c1', name: 'Alex Rivera', avatar_url: null } })) } }));
jest.mock('../../../../lib/packagePayment', () => ({ ...jest.requireActual('../../../../lib/packagePayment'), listClientPlans: async () => [] }));
jest.mock('../../../../services/queryClient', () => {
  const { QueryClient } = jest.requireActual('@tanstack/react-query');
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock('../../../../components/coachless/CoachCodeSheet', () => () => null);
jest.mock('../../../../ui/charts', () => ({ SegmentedRing: ({ children }: { children: React.ReactNode }) => children }));

import YouScreen from '../../YouScreen';
import { queryClient as client } from '../../../../services/queryClient';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const draw = () => { client.clear(); return render(<QueryClientProvider client={client}><YouScreen /></QueryClientProvider>); };

beforeEach(() => {
  for (const k of Object.keys(mockFlags)) delete mockFlags[k];
  mockNavigate.mockReset();
});

test('every switch on: Your path on You is the leaf new row with the forest tile, leads its group and opens Copilot', async () => {
  Object.assign(mockFlags, { youTabV2: true, clientPathCopilot: true, romanChat: true, clientTimelineV2: true, healthPages: true });
  await draw();
  const rowEl = screen.getByTestId('you-row-Copilot');
  expect(flat(rowEl)).toMatchObject({ backgroundColor: '#EEF4E0', minHeight: 62, paddingVertical: 11, paddingHorizontal: 16, gap: 14 });
  expect(flat(rowEl).borderTopWidth).toBeUndefined();
  const tile = screen.getByTestId('you-row-new-icon');
  expect(flat(tile)).toMatchObject({ width: 36, height: 36, borderRadius: 12, backgroundColor: '#1C3023' });
  expect(flat(screen.getByText('Your path'))).toMatchObject({ fontSize: 16, fontWeight: '500', lineHeight: 21 });
  expect(flat(screen.getByText('Ask why your plan is set the way it is'))).toMatchObject({ fontSize: 13.5, color: '#5A5A56', marginTop: 2 });
  expect(screen.getAllByTestId('you-row-new-icon')).toHaveLength(1);
  expect(rowEl.props.accessibilityHint).toBe('Opens Your path');
  // Leads its group: Your path, then Roman, then the plan rows as before.
  const rows = screen.getAllByTestId(/^you-row-/).filter((r) => r.props.accessibilityRole === 'button').map((r) => String(r.props.accessibilityLabel).split(',')[0]);
  const at = rows.indexOf('Your path');
  expect(rows.slice(at, at + 3)).toEqual(['Your path', 'Roman', 'Meal plan']);
  await fireEvent.press(rowEl);
  expect(mockNavigate.mock.calls[0][0]).toBe('Copilot');
});

test('with the Copilot switch off, You has no Your path row and Roman still leads Support', async () => {
  Object.assign(mockFlags, { youTabV2: true, romanChat: true });
  await draw();
  expect(screen.queryByTestId('you-row-Copilot')).toBeNull();
  expect(screen.queryByTestId('you-row-new-icon')).toBeNull();
  const rows = screen.getAllByTestId(/^you-row-/).filter((r) => r.props.accessibilityRole === 'button').map((r) => String(r.props.accessibilityLabel).split(',')[0]);
  const at = rows.indexOf('Roman');
  expect(rows.slice(at, at + 2)).toEqual(['Roman', 'Meal plan']);
});
