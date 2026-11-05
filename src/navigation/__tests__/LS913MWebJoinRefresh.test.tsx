/**
 * B-TEST LS-913M: deleting an automatic AI offer must not delete the
 * account refresh that opens Roman and Community after a confirmed web join.
 * Real ClientNavigator, account cache, auth event bus and coach-lock hook.
 * Only network boundaries and unrelated navigator leaf screens are mocked.
 */
import React from 'react';
import { AppState, type AppStateStatus, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from 'fs';
import * as path from 'path';
import { clearUserCache, patchUserCache, readUserCacheSync, setUserCache } from '../../lib/userCache';
import { authEvents } from '../../utils/authEvents';

const mockMe = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: {} })) },
  authApi: { me: (...args: unknown[]) => mockMe(...args) },
}));
jest.mock('../../services/sentry', () => ({ setSentryUser: jest.fn(), captureError: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../config/featureFlags', () => ({
  featureFlags: { communityTab: true, romanChat: true, clientTutorial: false },
}));
jest.mock('../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
jest.mock('../../hooks/useMessageOutbox', () => ({ useMessageOutboxDrain: () => {} }));
jest.mock('../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../components/community/UnreadBadge', () => () => null);
jest.mock('../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (screen: unknown) => screen }));
jest.mock('../../entitlements/dunning/UpdateCardScreen', () => () => null);
jest.mock('../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (screen: unknown) => screen }));
jest.mock('../../components/join/JoinPackageHost', () => ({ __esModule: true, default: () => null, JOIN_SHEET_HANDOFF_MS: 0 }));
jest.mock('../../components/ai/AiConsentSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../api/aiConsentApi', () => ({
  aiConsentApi: {
    getStatus: async () => ({
      kind: 'ok',
      status: { granted: true, state: 'granted', version: 'client-ai-v6', current_version: 'client-ai-v6', needs_reconsent: false },
    }),
  },
}));
jest.mock('../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function CoachAccessProbe() {
  const { useClientNeedsCoach } = require('../../components/coachless/JoinCoachState');
  return <Text testID="coach-access">{useClientNeedsCoach() ? 'locked' : 'open'}</Text>;
}

const source = fs.readFileSync(path.join(__dirname, '..', 'ClientNavigator.tsx'), 'utf8');
for (const match of source.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: CoachAccessProbe }));
}
jest.doMock('../CommunityNavigator', () => ({ __esModule: true, default: CoachAccessProbe }));
const ClientNavigator = require('../ClientNavigator').default;

const NO_COACH = { id: 'web-join-a', email: '', role: 'student', profile: { onboardingCompleted: true } };
let listeners: Array<(state: AppStateStatus) => void>;

beforeEach(async () => {
  jest.clearAllMocks();
  await clearUserCache();
  await AsyncStorage.clear();
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listeners.push(callback as (state: AppStateStatus) => void);
    return { remove: jest.fn() };
  });
  mockMe.mockResolvedValue({ data: { ...NO_COACH, coach_id: null } });
  await setUserCache(NO_COACH);
});

afterEach(() => jest.restoreAllMocks());

async function openClient() {
  const view = await render(<NavigationContainer><ClientNavigator /></NavigationContainer>);
  await waitFor(() => expect(view.getByTestId('coach-access').props.children).toBe('locked'));
  return view;
}

it('foreground: a server-confirmed web join updates this account and opens its coach-gated access', async () => {
  const view = await openClient();
  await act(async () => { await Promise.resolve(); });
  mockMe.mockResolvedValue({ data: { ...NO_COACH, coach_id: 'coach-confirmed' } });
  await act(async () => { listeners.forEach((fn) => fn('background')); });
  await act(async () => { listeners.forEach((fn) => fn('active')); });
  await waitFor(() => expect(readUserCacheSync()?.coach_id).toBe('coach-confirmed'));
  await waitFor(() => expect(view.getByTestId('coach-access').props.children).toBe('open'));
});

it('cold open: an already confirmed web join updates the still-coachless stored account', async () => {
  mockMe.mockResolvedValue({ data: { ...NO_COACH, coach_id: 'coach-confirmed' } });
  const view = await render(<NavigationContainer><ClientNavigator /></NavigationContainer>);
  await waitFor(() => expect(readUserCacheSync()?.coach_id).toBe('coach-confirmed'));
  await waitFor(() => expect(view.getByTestId('coach-access').props.children).toBe('open'));
});

it('control: the existing in-app join cache write and login event open the real lock hook', async () => {
  const view = await openClient();
  await act(async () => {
    await patchUserCache({ coach_id: 'coach-in-app' });
    authEvents.emit('login');
  });
  await waitFor(() => expect(view.getByTestId('coach-access').props.children).toBe('open'));
});
