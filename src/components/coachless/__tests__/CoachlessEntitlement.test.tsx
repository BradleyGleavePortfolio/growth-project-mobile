/**
 * B-386-SOL-1 (integrated): a coachless client redeems a code that includes
 * a free or prepaid plan, taps Done and reaches protected content (Workout)
 * without backgrounding or reopening the app. The real EntitlementProvider,
 * ProtectedScreen, CoachlessHomeSlot and CoachCodeSheet run; only the network,
 * the user and the flags are mocked.
 *
 * Failing before (m#386 @ 0a1bc0bd): the redeem never refreshed the shared
 * entitlement, so ProtectedScreen kept showing the plans gate.
 */
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#2C4A36',
      background: '#F5EFE4',
      surface: '#F1E8D5',
      border: '#E0D8C8',
      textPrimary: '#1A1A18',
      textSecondary: '#6B6B6B',
      textOnPrimary: '#FFFFFF',
      cardShadow: 'rgba(0,0,0,0.4)',
    },
    tokens: { typography: { h2: { fontSize: 24 }, h4: { fontSize: 17 }, body: { fontSize: 16 }, bodyMd: { fontSize: 16 }, bodySmall: { fontSize: 14 } } },
  }),
}));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
const mockGetEntitlement = jest.fn();
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-1', email: 'a@b.com', role: 'student' }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { coachless_home: true } }) }));
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => false }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({ patchUserCache: async () => undefined, readUserCacheSync: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../PackageSelectionSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../entitlements/PaywallSheet', () => ({
  ...jest.requireActual('../../../entitlements/PaywallSheet'),
  PaywallSheet: () => null,
}));

import { EntitlementProvider } from '../../../entitlements/EntitlementProvider';
import { ProtectedScreen } from '../../../entitlements/ProtectedScreen';
import CoachlessHomeSlot from '../CoachlessHomeSlot';

const COACH = { id: 'coach-1', name: 'Alex Rivera', photo_url: null, business_name: null, bio: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({
    data: {
      eligible: true,
      coach_attached: false,
      banner: { title: 'Banner title from the server', offer_text: 'Offer text.', code: 'GP-TOP' },
      roman_card: null,
      roman_card_hidden_reason: 'offer_off',
      featured_coach: null,
    },
  });
  mockPost.mockImplementation(async (url: string) => {
    if (url === '/coachless/coach-code/check') return { data: { valid: true, coach: COACH } };
    if (url === '/coachless/coach-code/redeem') {
      return {
        data: {
          status: 'attached',
          already_attached: false,
          coach: COACH,
          next: { featured_package: null, packages_available: 1 },
          grant: { status: 'created', purchase_id: 'grant-1', package_id: 'pkg-free' },
          replayed: false,
        },
      };
    }
    return { data: { recorded: true, visible: true } };
  });
  // Bootstrap: no plan yet. After the redeem the server reports the granted plan.
  mockGetEntitlement.mockResolvedValueOnce({ ok: true, data: { active: false } });
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
});

it('redeeming a code with a granted plan unlocks protected content without a restart', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={qc}>
      <EntitlementProvider>
        <CoachlessHomeSlot />
        <ProtectedScreen>
          <Text testID="workout-content">Workout</Text>
        </ProtectedScreen>
      </EntitlementProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByTestId('protected-screen-coach-managed')).toBeTruthy();
  expect(screen.queryByTestId('workout-content')).toBeNull();
  expect(mockGetEntitlement).toHaveBeenCalledTimes(1);

  await fireEvent.press(await screen.findByTestId('coachless-use-code'));
  await fireEvent.press(screen.getByTestId('coach-code-join'));
  expect(await screen.findByText('Your plan with Alex Rivera is active.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('coach-code-next-cta'));

  await waitFor(() => expect(screen.getByTestId('workout-content')).toBeTruthy());
  expect(screen.queryByTestId('protected-screen-coach-managed')).toBeNull();
  expect(mockGetEntitlement).toHaveBeenCalledTimes(2);
});
