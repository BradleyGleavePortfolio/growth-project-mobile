import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import {
  NavigationContainer,
  DefaultTheme,
  LinkingOptions,
  getStateFromPath,
} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import CoachNavigator from './CoachNavigator';
// OnboardingNavigator (legacy 10-step) is intentionally imported but not
// mounted — kept so the legacy screens stay in the build for reference
// implementation and future rollback. See the file header for context.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import OnboardingNavigator from './OnboardingNavigator';
import LeanOnboardingNavigator from './LeanOnboardingNavigator';
import OfflineBanner from '../components/OfflineBanner';
import { authEvents } from '../utils/authEvents';
import { secureStorage } from '../services/secureStorage';
import { Colors } from '../constants/colors';
import { useNetworkStatus, isEffectivelyOnline } from '../hooks/useNetworkStatus';
import { flush as flushFoodLogQueue } from '../services/foodLogQueue';
import { isScreenshotMode } from '../screenshots';
import { firstWinApi } from '../services/firstWinApi';
import Day1WinScreen from '../screens/client/Day1WinScreen';
// Phase 11 Track 9 — Support Inbox: init Crisp and sync identity on login
import { initCrisp, syncCrispIdentity } from '../services/support/crisp.service';
// Reconcile: if the lean onboarding completed but we never confirmed a 200
// from PUT /profile (offline at finish, etc.), retry once on app open.
import { useLeanOnboardingReconcile } from '../hooks/useLeanOnboardingReconcile';

// Phase 7A: 'day1win' is inserted between onboarding and the main client
// navigator. On first cold start after onboarding the app checks
// GET /me/first-win/status; if incomplete the Day1WinScreen is shown once.
type AuthState = 'loading' | 'unauthenticated' | 'onboarding' | 'day1win' | 'coach' | 'student';

// Audit fix CR-1: Supabase password-recovery emails carry the
// access_token + refresh_token pair in the URL fragment (after `#`).
// React Navigation's linking parser only reads query params (after
// `?`). `fragmentToQuery` hoists the fragment into the query string
// for the reset-password path so the ResetPassword screen receives
// the tokens via `route.params`. See navigation/deepLinkUtils.ts.
import { fragmentToQuery } from './deepLinkUtils';

// Deep-link config — must match the Android intent filters and iOS
// associatedDomains entries declared in app.json. Both URL shapes route an
// invite code straight into the signup screen so the user only sees one form.
//
//   tgp://join/<code>
//   https://app.trygrowthproject.com/join/<code>
//   tgp://reset-password#access_token=...&refresh_token=...&type=recovery
const linking: LinkingOptions<Record<string, object | undefined>> = {
  prefixes: ['tgp://', 'https://app.trygrowthproject.com'],
  getStateFromPath(path, options) {
    return getStateFromPath(fragmentToQuery(path), options);
  },
  config: {
    screens: {
      // Only the unauthenticated AuthNavigator owns the signup screen — once a
      // user is signed in, the linking config is effectively a no-op because
      // the matching screen is not mounted. That's fine: signed-in users can
      // attach an invite code via the in-app flow on RoleSelection.
      Welcome: 'welcome',
      Login: 'login',
      CreateAccount: {
        path: 'join/:invite_code?',
        parse: { invite_code: (v: string) => v },
      },
      // Audit fix CR-1: handler for the Supabase password-recovery
      // deep link. fragmentToQuery() above hoists the URL fragment
      // into the query string so React Navigation can parse the
      // access_token + refresh_token pair into route.params.
      ResetPassword: {
        path: 'reset-password',
        parse: {
          access_token: (v: string) => v,
          refresh_token: (v: string) => v,
        },
      },
      // Screenshot-mode-only deep links into authenticated tabs/stacks. They
      // are inert in production because the harness gates ClientNavigator
      // mounting on a seeded demo user — no real session ever has these
      // routes reachable from a `tgp://` URL. The cast is needed because the
      // generic `Record<string, object | undefined>` linking type does not
      // know about the nested `screens` config — we accept the cast here
      // rather than threading a precise nav param tree through this module.
      ...(isScreenshotMode()
        ? ({
            Home: 'home',
            Log: 'log',
            MoreTab: {
              screens: {
                Plan: 'plan',
                Recipes: 'recipes',
                Progress: 'progress',
                Fast: 'fast',
              },
            },
          } as Record<string, unknown>)
        : {}),
    },
  },
};

export default function RootNavigator() {
  const [authState, setAuthState] = useState<AuthState>('loading');

  // Initialise the Crisp SDK once at app start. Safe to call before auth
  // resolves — configure() only registers the website ID and does not
  // start a session until the chat overlay is opened.
  useEffect(() => {
    initCrisp();
  }, []);

  // Best-effort retry of the lean → backend sync. No-ops unless the user
  // finished onboarding AND we never confirmed a successful PUT /profile.
  // Disabled in screenshot mode where there is no backend.
  useLeanOnboardingReconcile(!isScreenshotMode());

  useEffect(() => {
    bootstrapAuth();
    const unsubscribe = authEvents.onAuthChange(bootstrapAuth);
    return unsubscribe;
  }, []);

  // Flush the offline food-log queue whenever the network comes back online.
  // Only fires on the offline → online transition; repeated online events are
  // no-ops because the queue is empty. Fire-and-forget; flush logs its own errors.
  const network = useNetworkStatus();
  const wasOnlineRef = useRef<boolean>(true);
  useEffect(() => {
    const online = isEffectivelyOnline(network);
    if (online && !wasOnlineRef.current) {
      flushFoodLogQueue().catch((err) => console.error('flushFoodLogQueue failed', err));
    }
    wasOnlineRef.current = online;
  }, [network.isOnline, network.isInternetReachable]);

  const bootstrapAuth = async () => {
    try {
      // secureStorage.getItem migrates any legacy AsyncStorage token into
      // SecureStore on first read, so existing users stay logged in.
      const token = await secureStorage.getItem('supabase_token');
      const userRaw = await AsyncStorage.getItem('user_data');
      const needsRoleSelection = await AsyncStorage.getItem('needs_role_selection');

      if (!token || !userRaw) {
        setAuthState('unauthenticated');
        return;
      }

      // Role selection not done yet — stay in auth flow
      if (needsRoleSelection === 'true') {
        setAuthState('unauthenticated');
        return;
      }

      let user = null;
      try {
        user = JSON.parse(userRaw);
      } catch {
        // Corrupted storage — treat as logged out
        await AsyncStorage.removeItem('user_data');
        setAuthState('unauthenticated');
        return;
      }
      const role = user?.role;

      if (role === 'coach') {
        // Sync Crisp identity so operators see the coach's account in the dashboard.
        syncCrispIdentity({
          email: user.email ?? '',
          displayName: user.name,
          role: 'coach',
        });
        setAuthState('coach');
        return;
      }

      if (role === 'student') {
        // Check if onboarding quiz has been completed
        const onboardingDone = await AsyncStorage.getItem('onboarding_complete');
        const profileDone = user?.profile?.onboarding_completed;

        if (onboardingDone !== 'true' && !profileDone) {
          // Psych Report #1: route new users to 3-question lean flow.
          // Existing users who already have the old 10-step onboarding_complete
          // flag bypass this entirely — the check above handles them.
          setAuthState('onboarding');
          return;
        }

        // Sync: if backend says done but AsyncStorage doesn't, fix it
        if (profileDone && onboardingDone !== 'true') {
          await AsyncStorage.setItem('onboarding_complete', 'true');
        }

        // Phase 7A: check if Day 1 Win has been completed. Fire-and-forget
        // error handling — if the API is unreachable, skip the win screen and
        // go straight to the client app. The screen can be shown on next boot.
        try {
          const statusResponse = await firstWinApi.getStatus();
          if (!statusResponse.data.completed) {
            setAuthState('day1win');
            return;
          }
        } catch {
          // Network error or auth issue — do not block app launch.
          // The win screen will be retried on next boot.
        }

        // Sync Crisp identity so operators see the client's account in the dashboard.
        syncCrispIdentity({
          email: user.email ?? '',
          displayName: user.name,
          role: 'student',
        });
        setAuthState('student');
        return;
      }

      // Token exists but no role yet
      setAuthState('unauthenticated');
    } catch {
      setAuthState('unauthenticated');
    }
  };

  // Called by Day1WinScreen when the client completes the win OR skips.
  const handleDay1WinComplete = () => {
    setAuthState('student');
  };

  if (authState === 'loading') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Phase 7A: Day1WinScreen renders outside NavigationContainer because it is
  // a one-time interstitial, not a navigable screen. It is shown once, on
  // first student boot, then replaced by ClientNavigator.
  if (authState === 'day1win') {
    return <Day1WinScreen onComplete={handleDay1WinComplete} />;
  }

  return (
    <NavigationContainer
      linking={linking}
      theme={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: '#F5EFE4',  // bone — Wave 2 global bg
          card: '#F5EFE4',
          text: '#1A1A18',        // ink
          border: 'rgba(176,141,87,0.2)',  // camel divider
        },
      }}
    >
      {/* OfflineBanner sits at the top of every auth state so users see the
          offline indicator regardless of which navigator is mounted. */}
      <OfflineBanner />
      {authState === 'unauthenticated' ? (
        <AuthNavigator />
      ) : authState === 'onboarding' ? (
        // Psych Report #1: 3-question lean flow (< 60 s to first win).
        // Original OnboardingNavigator is preserved; route around it here.
        <LeanOnboardingNavigator />
      ) : authState === 'coach' ? (
        <CoachNavigator />
      ) : (
        <ClientNavigator />
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
