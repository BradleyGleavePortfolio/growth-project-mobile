/**
 * Sol B-310-4 on #310, root level: the consultation-to-tutorial hand-off
 * survives a shutdown between the server's completion and "Show me around".
 *
 * Backend #607 marks the profile onboarding-complete inside POST
 * /me/onboarding/complete. If the app closes after that 200 (or the 200 is
 * lost) and the next boot sees the completed profile (a fresh sign-in, a
 * reinstall, another phone), RootNavigator mounts the client app, not the
 * consultation, so ConsultationFlow's replay never runs. The tour must still
 * start, from the server's completion, and a finished or paused tour must
 * never restart by itself. Real RootNavigator and real TutorialHost; only
 * native and network edges are mocked (harness of
 * rootNavigatorConsultationComplete.test.tsx).
 */
const mockSecure: Record<string, string | null> = {};
jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => mockSecure[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockSecure[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete mockSecure[k];
    }),
  },
}));
jest.mock('../services/authActions', () => ({ signOut: jest.fn(async () => {}) }));
const mockOnboarding: { body: unknown; fail: boolean } = { body: null, fail: false };
const mockGet = jest.fn(async (url: string) => {
  if (url === '/me/onboarding') {
    if (mockOnboarding.fail) throw Object.assign(new Error('Network Error'), {});
    return { data: mockOnboarding.body };
  }
  return { data: { is_complete: true } };
});
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (url: string) => mockGet(url),
    post: jest.fn(async () => ({ data: {} })),
  },
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: {
    getInitialURL: jest.fn(async () => null),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    openURL: jest.fn(async () => true),
  },
}));
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: jest.fn(),
      resetRoot: jest.fn(),
      current: null,
    }),
  };
});
jest.mock('../navigation/AuthNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-auth' }, 'auth');
});
jest.mock('../navigation/CoachNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  const { queryClient } = jest.requireActual('../services/queryClient');
  // The private surface reports what it can see from the cache at mount.
  return () => {
    const me = queryClient.getQueryData(['me']);
    return React.createElement(Text, { testID: 'nav-coach' }, me ? JSON.stringify(me) : 'none');
  };
});
// The client app with the REAL TutorialHost around it (the overlay and the
// live-data hooks are stubbed), so the hand-off logic runs as in the app.
jest.mock('../navigation/ClientNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  const TutorialHost = jest.requireActual('../components/tutorial/TutorialHost').default;
  return () =>
    React.createElement(
      TutorialHost,
      { tabs: ['HomeTab', 'WorkoutTab'], onNavigate: () => undefined },
      React.createElement(Text, { testID: 'nav-client' }, 'client'),
    );
});
jest.mock('../components/tutorial/TutorialOverlay', () => () => null);
jest.mock('../hooks/useMacros', () => ({ useCurrentMacrosForSelf: () => ({ data: undefined }) }));
jest.mock('../hooks/useWearableConnections', () => ({ useWearableConnections: () => ({ data: undefined }) }));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-C', name: 'Cam', firstName: 'Cam', role: 'student' }),
}));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { success: jest.fn(async () => undefined), selection: jest.fn(async () => undefined), warning: jest.fn(async () => undefined) },
}));
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/LeanOnboardingNavigator', () => () => null);
jest.mock('../navigation/CoachWizardNavigator', () => () => null);
jest.mock('../navigation/Day1OnboardingNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-day1' }, 'day1');
});
jest.mock('../navigation/ConsultationOnboardingNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-consultation' }, 'consultation');
});
jest.mock('../components/OfflineBanner', () => () => null);
jest.mock('../components/PackageSelectionSheet', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'package-prompt' }, 'prompt');
});
const mockGetEntitlement = jest.fn();
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
jest.mock('../screens/client/Day1WinScreen', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'day1-win' }, 'win');
});
jest.mock('../services/support/crisp.service', () => ({ initCrisp: jest.fn(), syncCrispIdentity: jest.fn() }));
jest.mock('../hooks/useLeanOnboardingReconcile', () => ({ useLeanOnboardingReconcile: jest.fn() }));
const mockFirstWin = jest.fn();
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: { getStatus: () => mockFirstWin() },
  WinType: {},
}));
let mockConsultFlag = true;
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) =>
        k === 'consultationOnboarding' ? mockConsultFlag : k === 'clientTutorial' ? true : Reflect.get(t, k),
    }),
  };
});
jest.mock('../services/foodLogQueue', () => ({ flush: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
jest.mock('../utils/authEvents', () => ({
  authEvents: { onAuthChange: jest.fn(() => () => {}), on: jest.fn(() => () => {}), emit: jest.fn() },
}));
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('../offline', () => ({ triggerSync: jest.fn(async () => undefined) }));
jest.mock('../entitlements/EntitlementProvider', () => ({
  EntitlementProvider: ({ children }: { children: unknown }) => children,
}));

let mockHidden = false;
jest.mock('../config/purchaseSurfaces', () => ({
  ...jest.requireActual('../config/purchaseSurfaces'),
  nonP2PPurchasesHidden: () => mockHidden,
}));
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from '../navigation/RootNavigator';
import { queryClient } from '../services/queryClient';
import { __resetTutorialStoreForTests, useTutorialStore } from '../tutorial/tutorialStore';
import { tutorialStorageKey } from '../tutorial/tutorialStorage';

/** The next boot after the server completed: the profile says done, nothing local. */
const SERVER_DONE = {
  id: 'client-C',
  email: 'c@example.com',
  role: 'student',
  name: 'Cam',
  profile: { onboarding_completed: true, day_one_completed: false },
};

const RESULT = {
  macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50 },
  program: { id: 'prog-a', name: 'Foundations', days_per_week: 3, weeks: 4, why: [] },
  spaces: [{ id: 'sp1', name: 'All members' }],
  coach: { id: 'coach-1', display_name: 'Bradley' },
};

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  __resetTutorialStoreForTests();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockSecure['supabase_token'] = 'jwt-C';
  mockConsultFlag = true;
  mockOnboarding.body = { completed: true, answers: {}, result: RESULT };
  mockOnboarding.fail = false;
  mockGet.mockClear();
  mockFirstWin.mockReset();
  mockFirstWin.mockResolvedValue({ data: { completed: false } });
  mockGetEntitlement.mockReset();
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, entitlement_active: true } });
  mockHidden = false;
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(SERVER_DONE));
});
afterEach(async () => {
  await cleanup();
});

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
    </QueryClientProvider>,
  );

const onboardingReads = () => mockGet.mock.calls.filter(([u]) => u === '/me/onboarding').length;

async function seedTour(status: 'active' | 'paused' | 'completed') {
  const state = {
    version: 1,
    status,
    stepIndex: status === 'completed' ? 0 : 1,
    gateIndex: 0,
    outcomes: {},
    startedAt: '2026-10-01T10:00:00.000Z',
    completedAt: status === 'completed' ? '2026-10-01T10:30:00.000Z' : null,
    updatedAt: '2026-10-01T10:30:00.000Z',
  };
  await AsyncStorage.setItem(tutorialStorageKey('client-C'), JSON.stringify({ state, payload: RESULT }));
}

describe('B-310-4: cold boot after the server completed the consultation', () => {
  it('shutdown after the complete 200 and before "Show me around": the app mounts and Roman\'s tour starts with the server result', async () => {
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(r.queryByTestId('nav-consultation')).toBeNull();
    expect(r.queryByTestId('nav-day1')).toBeNull();
    await waitFor(() => expect(useTutorialStore.getState().tutorial.status).toBe('active'));
    const s = useTutorialStore.getState();
    expect(s.userId).toBe('client-C');
    expect(s.payload?.program?.name).toBe('Foundations');
    expect(s.payload?.macros?.calories).toBe(1789);
    // Persisted, so the next boot resumes this tour instead of starting again.
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(tutorialStorageKey('client-C'));
      expect(JSON.parse(raw ?? '{}').state?.status).toBe('active');
    });
  });

  it('a lost POST response is the same case: the server says completed, so the tour starts', async () => {
    mockOnboarding.body = { completed: true, answers: {}, result: { complete: RESULT } };
    const r = await mount();
    await r.findByTestId('nav-client');
    await waitFor(() => expect(useTutorialStore.getState().tutorial.status).toBe('active'));
    expect(useTutorialStore.getState().payload?.program?.name).toBe('Foundations');
  });

  it.each(['completed', 'paused'] as const)('a %s tour on this phone never restarts by itself', async (status) => {
    await seedTour(status);
    const r = await mount();
    await r.findByTestId('nav-client');
    await waitFor(() => expect(useTutorialStore.getState().hydrated).toBe(true));
    await new Promise((res) => setTimeout(res, 20));
    expect(useTutorialStore.getState().tutorial.status).toBe(status);
    expect(onboardingReads()).toBe(0);
  });

  it('a client who never did the consultation (server: not completed) gets no tour', async () => {
    mockOnboarding.body = { completed: false, answers: null, result: null };
    const r = await mount();
    await r.findByTestId('nav-client');
    await waitFor(() => expect(onboardingReads()).toBe(1));
    await new Promise((res) => setTimeout(res, 20));
    expect(useTutorialStore.getState().tutorial.status).toBe('not_started');
  });

  it('offline at boot: nothing starts and nothing breaks; the next boot tries again', async () => {
    mockOnboarding.fail = true;
    const r = await mount();
    await r.findByTestId('nav-client');
    await waitFor(() => expect(onboardingReads()).toBe(1));
    await new Promise((res) => setTimeout(res, 20));
    expect(useTutorialStore.getState().tutorial.status).toBe('not_started');
  });

  it('flag off: no read and no tour (unchanged)', async () => {
    mockConsultFlag = false;
    await AsyncStorage.setItem(
      'prefs:auth.user_data',
      JSON.stringify({ ...SERVER_DONE, profile: { onboarding_completed: true, day_one_completed: true } }),
    );
    mockFirstWin.mockResolvedValue({ data: { completed: true } });
    const r = await mount();
    await r.findByTestId('nav-client');
    await waitFor(() => expect(useTutorialStore.getState().hydrated).toBe(true));
    await new Promise((res) => setTimeout(res, 20));
    expect(onboardingReads()).toBe(0);
    expect(useTutorialStore.getState().tutorial.status).toBe('not_started');
  });
});
