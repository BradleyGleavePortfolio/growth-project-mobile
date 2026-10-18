/**
 * AGEGATE16 (owner #C8-UNDER18-B), caller level: a client past setup with no
 * date of birth on file (any way in that skipped the consultation: an
 * earlier build's setup, PUT /profile onboardingCompleted, a coach invite,
 * a join code, social sign-in) is asked once before the client app; a
 * confirmed client is unchanged; coaches and owners are never asked; the
 * server's 403 AGE_CONFIRMATION_REQUIRED opens the age step from the app,
 * never from setup. Harness mirrors rootNavigatorConsultationComplete.
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
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../services/authActions', () => ({ signOut: jest.fn(async () => {}) }));
const mockMe = jest.fn();
const mockProfileUpdate = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: { is_complete: true } })),
    post: jest.fn(async () => ({ data: {} })),
  },
  authApi: { me: () => mockMe() },
  profileApi: { update: (d: unknown) => mockProfileUpdate(d) },
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
    // FIXAGE R4: the age step is a small stack (its account screens).
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(actual.NavigationContainer, null, children),
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: jest.fn(),
      resetRoot: jest.fn(),
      getCurrentRoute: () => undefined,
      addListener: () => () => undefined,
      current: null,
    }),
  };
});
jest.mock('../navigation/AuthNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-auth' }, 'nav-auth');
});
jest.mock('../navigation/CoachNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-coach' }, 'nav-coach');
});
jest.mock('../navigation/ClientNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-client' }, 'nav-client');
});
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/CoachWizardNavigator', () => () => null);
jest.mock('../navigation/Day1OnboardingNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-day1' }, 'nav-day1');
});
jest.mock('../navigation/ConsultationOnboardingNavigator', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'nav-consultation' }, 'nav-consultation');
});
jest.mock('../components/OfflineBanner', () => () => null);
jest.mock('../components/PackageSelectionSheet', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'package-prompt' }, 'package-prompt');
});
const mockGetEntitlement = jest.fn();
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
jest.mock('../screens/client/Day1WinScreen', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return () => React.createElement(Text, { testID: 'day1-win' }, 'day1-win');
});
jest.mock('../services/support/crisp.service', () => ({ initCrisp: jest.fn(), syncCrispIdentity: jest.fn() }));
jest.mock('../hooks/useLeanOnboardingReconcile', () => ({ useLeanOnboardingReconcile: jest.fn() }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../services/firstWinApi', () => ({ firstWinApi: { getStatus: jest.fn() }, WinType: {} }));
jest.mock('../services/foodLogQueue', () => ({ flush: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('../offline', () => ({ triggerSync: jest.fn(async () => undefined) }));
jest.mock('../entitlements/EntitlementProvider', () => ({
  EntitlementProvider: ({ children }: { children: unknown }) => children,
}));
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from '../navigation/RootNavigator';
import { queryClient } from '../services/queryClient';
import { reportAgeConfirmationRequired } from '../lib/ageGate';
import { patchUserCache, readUserCache } from '../lib/userCache';
import { firstWinApi } from '../services/firstWinApi';

const CLIENT = {
  id: 'client-C',
  email: 'c@example.com',
  role: 'student',
  name: 'Cam',
  profile: { onboardingCompleted: true, day_one_completed: false } as Record<string, unknown>,
};
const ADULT = '1990-01-01T00:00:00.000Z';
const under16 = () => `${new Date().getFullYear() - 14}-01-01`;

async function seed(user: object, onboardingDone = true) {
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(user));
  if (onboardingDone) await AsyncStorage.setItem('onboarding_complete', 'true');
}
// FIXAGE2 R6: nothing on the wheels is chosen until the client moves them.
async function pickDate(r: Awaited<ReturnType<typeof render>>) {
  const now = new Date();
  const rows: Array<[string, number]> = [
    ['wheel-dob-month', now.getMonth()],
    ['wheel-dob-day', Math.min(28, now.getDate()) - 1],
    ['wheel-dob-year', 70],
  ];
  for (const [id, row] of rows) {
    await fireEvent(r.getByTestId(`${id}-scroll`, { includeHiddenElements: true }), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: row * 44 } } });
  }
}
const cached = async () => JSON.parse((await AsyncStorage.getItem('prefs:auth.user_data')) ?? '{}');

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockSecure['supabase_token'] = 'jwt-C';
  mockMe.mockReset();
  mockProfileUpdate.mockReset();
  mockProfileUpdate.mockResolvedValue({ data: {} });
  mockGetEntitlement.mockReset();
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, entitlement_active: true } });
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

describe('AGEGATE16: every client confirms 16 or older before the client app', () => {
  it('a confirmed client (date of birth cached) is unchanged: straight to the app, no extra read', async () => {
    await seed({ ...CLIENT, profile: { ...CLIENT.profile, date_of_birth: ADULT } });
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(mockMe).not.toHaveBeenCalled();
    expect(r.queryByTestId('consult-screen-B2')).toBeNull();
  });

  it('no date cached but the server has one: the app, and the date is cached so it is asked once', async () => {
    mockMe.mockResolvedValue({ data: { id: 'client-C', role: 'student', profile: { date_of_birth: ADULT } } });
    await seed(CLIENT);
    const r = await mount();
    await r.findByTestId('nav-client');
    expect(mockMe).toHaveBeenCalledTimes(1);
    expect((await cached()).profile.date_of_birth).toBe(ADULT);
  });

  it('no date anywhere (a way in that skipped the consultation): the age step, then the app', async () => {
    mockMe.mockResolvedValueOnce({ data: { id: 'client-C', role: 'student', profile: { date_of_birth: null } } });
    await seed(CLIENT);
    const r = await mount();
    await r.findByTestId('consult-screen-B2');
    expect(r.queryByTestId('nav-client')).toBeNull();
    await pickDate(r);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await r.findByTestId('nav-client');
    expect(mockProfileUpdate).toHaveBeenCalledWith({ date_of_birth: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(typeof (await cached()).profile.date_of_birth).toBe('string');
  });

  it('a client with no profile row at all is asked too', async () => {
    mockMe.mockResolvedValueOnce({ data: { id: 'client-C', role: 'student', profile: null } });
    await seed({ ...CLIENT, profile: undefined });
    const r = await mount();
    await r.findByTestId('consult-screen-B2');
  });

  it('a cached date under 16 is not trusted: the server decides, and without a 16+ date the age step', async () => {
    mockMe.mockResolvedValueOnce({ data: { id: 'client-C', role: 'student', profile: { date_of_birth: under16() } } });
    await seed({ ...CLIENT, profile: { ...CLIENT.profile, date_of_birth: under16() } });
    const r = await mount();
    await r.findByTestId('consult-screen-B2');
    expect(mockMe).toHaveBeenCalledTimes(1);
  });

  // FIXAGE R2: an unreadable answer is never a 16+ date.
  it.each([
    ['fails', () => mockMe.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))],
    ['times out', () => mockMe.mockRejectedValueOnce(new Error('startup timeout: age check'))],
    ['has no usable profile', () => mockMe.mockResolvedValueOnce({ data: 'unexpected' })],
  ])('a server read that %s asks the date (never the app)', async (_case, arrange) => {
    arrange();
    await seed(CLIENT);
    const r = await mount();
    await r.findByTestId('consult-screen-B2');
    expect(r.queryByTestId('nav-client')).toBeNull();
  });

  it('a 403 AGE_CONFIRMATION_REQUIRED inside the client app opens the age step', async () => {
    await seed({ ...CLIENT, profile: { ...CLIENT.profile, date_of_birth: ADULT } });
    const r = await mount();
    await r.findByTestId('nav-client');
    await act(async () => reportAgeConfirmationRequired());
    await r.findByTestId('consult-screen-B2');
    expect(r.queryByTestId('nav-client')).toBeNull();
  });

  // FIXAGE2 R7: "a client whose latest known date of birth is not a
  // confirmed 16+ date never enters the client app from a cache." Real cache
  // writes (lib/userCache), real refusal delivery; the server read fails
  // (offline), so only the cache could let them in.
  const offline = () => mockMe.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  const R7: Array<[string, () => Promise<void>]> = [
    ['Edit profile saves an under-16 dob over a cached adult date_of_birth', async () => {
      await seed({ ...CLIENT, profile: { ...CLIENT.profile, date_of_birth: ADULT } });
      await readUserCache();
      await patchUserCache({ profile: { dob: under16() } });
      expect((await cached()).profile).toEqual(expect.objectContaining({ dob: under16(), date_of_birth: under16() }));
    }],
    ['an older cache: canonical under-16, legacy adult dob', async () => {
      await seed({ ...CLIENT, profile: { ...CLIENT.profile, date_of_birth: under16(), dob: '1990-01-01' } });
    }],
    ['the server refused for age in the app, then the app was closed', async () => {
      await seed({ ...CLIENT, profile: { ...CLIENT.profile, date_of_birth: ADULT, dob: '1990-01-01' } });
      const live = await mount();
      await live.findByTestId('nav-client');
      await act(async () => reportAgeConfirmationRequired());
      await live.findByTestId('consult-screen-B2');
      await waitFor(async () => expect((await cached()).profile).toEqual(expect.objectContaining({ date_of_birth: null, dob: null })));
      await cleanup();
    }],
  ];
  it.each(R7)('%s: offline cold start opens the age step, never the app', async (_row, arrange) => {
    await arrange();
    offline();
    const r = await mount();
    await r.findByTestId('consult-screen-B2');
    expect(r.queryByTestId('nav-client')).toBeNull();
  });

  it('FIXAGE2 R7: a refusal while the app is still opening (first-win read) opens the age step, never the app', async () => {
    await seed({ ...CLIENT, profile: { ...CLIENT.profile, date_of_birth: ADULT } });
    await AsyncStorage.setItem('onboarding_standard_path:client-C', 'true');
    (firstWinApi.getStatus as jest.Mock).mockImplementationOnce(async () => {
      reportAgeConfirmationRequired();
      throw new Error('refused for age');
    });
    const r = await mount();
    await r.findByTestId('consult-screen-B2');
    expect(firstWinApi.getStatus).toHaveBeenCalled();
    await act(async () => new Promise((res) => setTimeout(res, 50)));
    expect(r.queryByTestId('nav-client')).toBeNull();
    expect(r.getByTestId('consult-screen-B2')).toBeTruthy();
  });

  it('setup is never interrupted: the consultation asks the date itself', async () => {
    await seed({ ...CLIENT, profile: { onboardingCompleted: false } }, false);
    const r = await mount();
    await r.findByTestId('nav-consultation');
    await act(async () => reportAgeConfirmationRequired());
    expect(r.getByTestId('nav-consultation')).toBeTruthy();
    expect(mockMe).not.toHaveBeenCalled();
  });

  it.each(['coach', 'owner'])('a %s is never asked', async (role) => {
    await seed({ id: `${role}-1`, email: `${role}@example.com`, role, name: 'Pat' });
    const r = await mount();
    await r.findByTestId('nav-coach');
    await act(async () => reportAgeConfirmationRequired());
    expect(r.getByTestId('nav-coach')).toBeTruthy();
    expect(mockMe).not.toHaveBeenCalled();
    await waitFor(() => expect(r.queryByTestId('consult-screen-B2')).toBeNull());
  });
});
