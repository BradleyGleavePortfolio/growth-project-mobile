/**
 * LO-852XB B-TEST for B-878R3-1 (placement, still open at f99501b8): GOAL 01 (style A, "Entry: You > Your plan >
 * Your path") opens You with a "Your plan" group whose first row is Your path, above every other group. At
 * f99501b8 the row is the first row of Support, after Account, Settings and Health and devices, below the fold on a
 * 390 phone. 'Your plan' is main's More section title, so no new word. If the owner keeps it in Support (C9's rule),
 * drop this test.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

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

test('every switch on: You opens with a Your plan group led by Your path, above Account (GOAL 01)', async () => {
  Object.assign(mockFlags, { youTabV2: true, clientPathCopilot: true, romanChat: true, clientTimelineV2: true, healthPages: true });
  await draw();
  const headers = screen.getAllByRole('header').map((h) => String(h.props.children));
  const plan = headers.indexOf('Your plan');
  expect(plan).toBeGreaterThan(-1);
  expect(plan).toBeLessThan(headers.indexOf('Account'));
  const rows = screen.getAllByTestId(/^you-row-/).filter((r) => r.props.accessibilityRole === 'button').map((r) => String(r.props.accessibilityLabel).split(',')[0]);
  expect(rows[0]).toBe('Your path');
  expect(flat(screen.getByTestId('you-row-Copilot'))).toMatchObject({ backgroundColor: '#EEF4E0' });
});
