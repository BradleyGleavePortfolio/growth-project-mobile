import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, View, StyleSheet, Linking, AppState } from 'react-native';
import { logger } from '../utils/logger';
import { triggerSync as triggerWorkoutSync } from '../offline';
import {
  NavigationContainer,
  DefaultTheme,
  LinkingOptions,
  getStateFromPath,
  createNavigationContainerRef,
} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import CoachNavigator from './CoachNavigator';
import CoachWizardNavigator from './CoachWizardNavigator';
// OnboardingNavigator (legacy 10-step) is intentionally imported but not
// mounted — kept so the legacy screens stay in the build for reference
// implementation and future rollback. See the file header for context.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import OnboardingNavigator from './OnboardingNavigator';
import LeanOnboardingNavigator from './LeanOnboardingNavigator';
import Day1OnboardingNavigator from './Day1OnboardingNavigator';
import { readResumeState as readDay1ResumeState } from '../screens/day-one/resume';
import OfflineBanner from '../components/OfflineBanner';
import { authEvents } from '../utils/authEvents';
import { secureStorage } from '../services/secureStorage';
import { Colors } from '../constants/colors';
import { useNetworkStatus, isEffectivelyOnline } from '../hooks/useNetworkStatus';
import { flush as flushFoodLogQueue } from '../services/foodLogQueue';
import { isScreenshotMode } from '../screenshots';
import { firstWinApi, WinType } from '../services/firstWinApi';
import Day1WinScreen from '../screens/client/Day1WinScreen';
import PackageSelectionSheet from '../components/PackageSelectionSheet';
import { prefsStorage } from '../storage/mmkv';
import { signOut } from '../services/authActions';
import api from '../services/api';
// Phase 11 Track 9 — Support Inbox: init Crisp and sync identity on login
import { initCrisp, syncCrispIdentity } from '../services/support/crisp.service';
// Reconcile: if the lean onboarding completed but we never confirmed a 200
// from PUT /profile (offline at finish, etc.), retry once on app open.
import { useLeanOnboardingReconcile } from '../hooks/useLeanOnboardingReconcile';

// Phase 7A: 'day1win' is inserted between onboarding and the main client
// navigator. On first cold start after onboarding the app checks
// GET /me/first-win/status; if incomplete the Day1WinScreen is shown once.
// 'coach_wizard' — shown when GET /coach/onboarding returns is_complete:false.
// 'package_prompt' — re-surfaces PackageSelectionSheet after 24h dismissal gap.
type AuthState =
  | 'loading'
  | 'unauthenticated'
  | 'onboarding'
  | 'day1onboarding'
  | 'day1win'
  | 'coach_wizard'
  | 'coach'
  | 'package_prompt'
  | 'student';

// Audit fix CR-1: Supabase password-recovery emails carry the
// access_token + refresh_token pair in the URL fragment (after `#`).
// React Navigation's linking parser only reads query params (after
// `?`). `fragmentToQuery` hoists the fragment into the query string
// for the reset-password path so the ResetPassword screen receives
// the tokens via `route.params`. See navigation/deepLinkUtils.ts.
import { fragmentToQuery } from './deepLinkUtils';
import { readUserCache, clearUserCache } from '../lib/userCache';
import { EntitlementProvider } from '../entitlements/EntitlementProvider';

// A-2 helper. Convert `https://app.trygrowthproject.com/<path>` to its
// `tgp://<path>` equivalent so the post-signOut replay never escapes to
// Safari. Returns the input unchanged when it does not look like a
// known TGP host.
function rewriteHttpsToScheme(url: string): string {
  try {
    const u = new URL(url);
    if (
      u.protocol === 'https:' &&
      u.hostname === 'app.trygrowthproject.com'
    ) {
      // Drop the leading `/` so `tgp://<host-segment>/<rest>` mirrors the
      // intent-filter `host` + `pathPrefix` we declare in app.json.
      const path = (u.pathname + u.search + u.hash).replace(/^\//, '');
      return `tgp://${path}`;
    }
  } catch {
    // Malformed URL — replay verbatim; caller catches errors.
  }
  return url;
}

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
      // P3-4 / R21: `tgp://auth/callback` is the Google OAuth redirect
      // URI declared in `src/utils/googleAuth.ts`. Day-to-day the URL
      // is consumed in-process by WebBrowser.openAuthSessionAsync and
      // never reaches the navigator. But if a stray click from outside
      // the auth-session flow arrives (re-opened email link, OS
      // handoff after the session has closed) the URL previously had
      // no screen mapping at all and the user landed nowhere.
      //
      // Mapping the path to the dedicated `AuthCallback` screen makes
      // the URL routable. The screen lives at
      // `src/screens/auth/AuthCallbackScreen.tsx` as an idempotent
      // landing stub — on mount it inspects the auth state and
      // dispatches to Home (authenticated) or Login (not). The screen
      // is intentionally not yet mounted under AuthNavigator (which
      // is owned by another lane); when the auth stack is next
      // refactored, mount the component under this route name. Until
      // then the linking entry alone is enough to give the parser a
      // legitimate target so the URL does not silently fail.
      AuthCallback: 'auth/callback',
      CreateAccount: {
        path: 'join/:invite_code?',
        parse: { invite_code: (v: string) => v },
      },
      // Email Pipeline v1 — public accept entry point. Both the custom
      // scheme (tgp://invite/accept/:token) and universal link
      // (https://app.trygrowthproject.com/invite/accept/:token) resolve
      // to this screen when the user is unauthenticated. RootNavigator's
      // foreground URL guard (below) handles the signed-in case by
      // routing it through the same path after signOut where required.
      AcceptInvite: {
        path: 'invite/accept/:token',
        parse: { token: (v: string) => v },
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
          } as Record<string, unknown>)
        : {}),
      // MoreTab linking — combines screenshot-mode deep links (only mounted
      // in screenshot harness) with the Stripe Checkout return route, which
      // is reachable in real builds via tgp://checkout/{success,cancel}.
      // Stripe redirects to:
      //   tgp://checkout/success?session_id=cs_xxx   (paid)
      //   tgp://checkout/cancel                       (canceled)
      // The return screen confirms the session against the backend before
      // showing a celebratory state.
      MoreTab: {
        screens: {
          ...(isScreenshotMode()
            ? {
                Plan: 'plan',
                Recipes: 'recipes',
                Progress: 'progress',
                Fast: 'fast',
              }
            : {}),
          CheckoutReturn: {
            path: 'checkout/:outcome',
            parse: {
              outcome: (v: string) => (v === 'cancel' ? 'cancel' : 'success'),
              session_id: (v: string) => v,
            },
          },
        },
      } as unknown as Record<string, unknown>,
    },
  },
};

// Module-level navigation ref so RootNavigator can imperatively route into
// ClientNavigator after Day1WinScreen completes. Only used for the Day 1 Win
// hand-off; other navigation continues to flow through props/hooks.
const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

// Extract the accept-invite token from a deep link URL. Returns null when
// the URL is not an accept-invite link OR the token cannot be parsed.
// Kept as a pure helper so RootNavigator's URL handler and the replay
// effect can dedupe against the same token without re-parsing. Exported
// for direct unit testing of the token-extraction contract.
export function extractAcceptInviteToken(url: string): string | null {
  const m = url.match(/\/invite\/accept\/([^/?#]+)/i);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export default function RootNavigator() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const pendingDay1Target = useRef<WinType | null>(null);
  // Deep-link replay state for the public accept-invite path. When a
  // signed-in user clicks an accept-invite URL we sign them out and then
  // navigate to AcceptInvite ONLY after authState flips to
  // 'unauthenticated' AND the NavigationContainer is ready. Using a state
  // value (not a timer) eliminates the race the audit flagged.
  const [pendingAcceptUrl, setPendingAcceptUrl] = useState<string | null>(null);
  // The reset-password flow follows the same pattern.
  const [pendingResetUrl, setPendingResetUrl] = useState<string | null>(null);
  // Once we have routed (or are about to route) an accept-invite token,
  // record it here so a duplicate URL event — from a cold-start initial
  // URL AND a foreground url listener, or from React Navigation's own
  // linking pass following our imperative navigate — cannot double-fire
  // the public accept call. Tokens are single-use; a second POST would
  // surface a misleading "already accepted" to the user.
  const consumedAcceptTokenRef = useRef<string | null>(null);

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

  // Root-level deep-link guard.
  //
  // The React Navigation `linking` config above only routes URLs to screens
  // that are currently mounted. When the user is authenticated, the
  // AuthNavigator stack (which owns ResetPassword and CreateAccount) is not
  // mounted, so a `tgp://reset-password#…` or `https://app.../join/<code>`
  // arriving from a real link click is silently dropped.
  //
  // For reset-password: the Supabase recovery flow assumes the *recipient*
  // owns the inbox; if a different signed-in user clicks the link, we must
  // sign them out first so the link's access_token actually replaces their
  // session. We force signOut() and re-deliver the URL — once the auth state
  // flips to unauthenticated, AuthNavigator's linking config picks it up.
  //
  // For invite links: a signed-in user already has a coach (or doesn't need
  // one). We do not auto-attach the new code — silently re-pairing the user
  // is the wrong behavior — but we record it on the screen-less path so the
  // RoleSelection / settings flow can surface it later. Today that is a
  // no-op marker in AsyncStorage; the in-app attach flow remains the
  // canonical entry point. The bare invite path still works for
  // unauthenticated users via the linking config.
  useEffect(() => {
    const handleUrl = async (url: string | null | undefined) => {
      if (!url) return;
      // Strip query/fragment for path matching.
      const lower = url.toLowerCase();
      const isReset =
        lower.includes('reset-password') &&
        (lower.startsWith('tgp://') || lower.includes('app.trygrowthproject.com'));
      const isInvite =
        (lower.startsWith('tgp://join/') ||
          lower.includes('app.trygrowthproject.com/join/')) &&
        !lower.endsWith('/join/');
      // Email Pipeline v1 — public accept link. Distinct from `/join/<code>`
      // (signup-gating code) because it carries a single-use accept token
      // and must POST to /invites/accept on landing. We treat it the same
      // way as a reset link: force signOut so the public AcceptInvite
      // screen mounts cleanly, then replay the URL to AuthNavigator.
      const isAcceptInvite =
        lower.startsWith('tgp://invite/accept/') ||
        lower.includes('app.trygrowthproject.com/invite/accept/');

      if (!isReset && !isInvite && !isAcceptInvite) return;

      // For accept-invite URLs, dedupe against the consumed-token ref
      // BEFORE doing any work. A cold-start URL event and a foreground
      // url-listener event can both fire for the same link, and once we
      // imperatively navigate to AcceptInvite the screen itself is the
      // source of truth for the network call. Re-recording the same
      // token would either redundantly re-mount AcceptInvite or, in the
      // legacy Linking.openURL replay path, loop indefinitely.
      if (isAcceptInvite) {
        const token = extractAcceptInviteToken(url);
        if (token && consumedAcceptTokenRef.current === token) {
          return;
        }
      }

      const authed = await secureStorage.getItem('supabase_token');
      if (!authed) {
        // Unauthenticated → React Navigation's native `linking` config
        // already routes the URL to AcceptInvite (or ResetPassword) when
        // AuthNavigator mounts. We intentionally do NOT stash the URL
        // here: a second imperative navigate would either mount the
        // single-use accept screen twice or, under the legacy
        // Linking.openURL replay, loop forever. Mark the accept token as
        // consumed so any duplicate URL event arriving later (cold-start
        // vs foreground listener) is dropped.
        if (isAcceptInvite) {
          const token = extractAcceptInviteToken(url);
          if (token) consumedAcceptTokenRef.current = token;
        }
        return;
      }

      if (isReset || isAcceptInvite) {
        // Stash the URL FIRST, then force sign-out. The
        // `pendingAcceptUrl`/`pendingResetUrl` watcher below replays the
        // URL only once authState has flipped to 'unauthenticated' AND
        // the NavigationContainer ref reports ready — preventing the
        // race where the prior authed navigator is still mounted when
        // the replay fires.
        if (isAcceptInvite) {
          setPendingAcceptUrl(url);
        } else {
          setPendingResetUrl(url);
        }
        await signOut();
        return;
      }

      if (isInvite) {
        const match = url.match(/\/join\/([^/?#]+)/i);
        const code = match?.[1];
        if (code) {
          // B5/B6: stash the inbound code so the in-app banner (HomeScreen)
          // can offer to claim it via authApi.attachInviteCode. The banner
          // is the consent surface — we do NOT auto-attach because it would
          // silently re-pair the client to a different coach.
          try {
            await AsyncStorage.setItem('pending_invite_code', code);
            // Fire an authEvent so any mounted banner re-reads storage on
            // foreground without waiting for a manual refresh.
            authEvents.emit();
          } catch (err) { logger.warn('RootNavigator', 'non-fatal', err); }
        }
      }
    };

    // Cold-start URL.
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    // Foreground URL events.
    const sub = Linking.addEventListener('url', (event) => {
      void handleUrl(event.url).catch((err) => logger.error('RootNavigator', 'handleUrl failed', err));
    });
    return () => {
      sub.remove();
    };
  }, []);

  // Pending accept/reset URL replay.
  //
  // Fires after `authState === 'unauthenticated'` so the AuthNavigator
  // stack is guaranteed to be mounted. We waitFor `navigationRef.isReady()`
  // before replaying — on slow devices the container can lag the auth
  // flip by a frame or two.
  //
  // Accept-invite replay uses an imperative `navigationRef.navigate()`
  // call — NOT `Linking.openURL(url)` — so it does not re-enter the
  // foreground URL handler. The previous implementation's openURL replay
  // could loop because the foreground handler would re-record the same
  // pendingAcceptUrl on every replay; the consumed-token ref below adds
  // a belt-and-braces guard against duplicate consumption.
  useEffect(() => {
    if (authState !== 'unauthenticated') return;
    if (!pendingAcceptUrl && !pendingResetUrl) return;
    let cancelled = false;
    const tryReplay = () => {
      if (cancelled) return;
      if (!navigationRef.isReady()) {
        requestAnimationFrame(tryReplay);
        return;
      }
      if (pendingAcceptUrl) {
        const url = pendingAcceptUrl;
        const token = extractAcceptInviteToken(url);
        // Clear pending state regardless — we never want this URL to
        // sit around for a second replay pass.
        setPendingAcceptUrl(null);
        if (!token) return;
        if (consumedAcceptTokenRef.current === token) return;
        consumedAcceptTokenRef.current = token;
        try {
          const nav = navigationRef as unknown as {
            navigate: (name: string, params?: object) => void;
          };
          nav.navigate('AcceptInvite', { token });
        } catch {
          // Navigation can fail in tests / screenshot mode; the
          // consumed-token ref still prevents a re-entry.
        }
      } else if (pendingResetUrl) {
        const url = pendingResetUrl;
        setPendingResetUrl(null);
        // Reset-password still relies on the URL fragment carrying the
        // Supabase access_token + refresh_token pair, so we keep the
        // openURL re-entry here. ResetPassword is not single-use and
        // not at risk of the same double-consume bug accept-invite has.
        Linking.openURL(url).catch(() => {});
      }
    };
    tryReplay();
    return () => {
      cancelled = true;
    };
  }, [authState, pendingAcceptUrl, pendingResetUrl]);

  // Flush the offline food-log queue whenever the network comes back online.
  // Only fires on the offline → online transition; repeated online events are
  // no-ops because the queue is empty. Fire-and-forget; flush logs its own errors.
  const network = useNetworkStatus();
  const wasOnlineRef = useRef<boolean>(true);
  useEffect(() => {
    const online = isEffectivelyOnline(network);
    if (online && !wasOnlineRef.current) {
      flushFoodLogQueue().catch((err) => logger.warn('RootNavigator', 'flushFoodLogQueue failed', err));
      // W-2 fix: also reconcile the workout-log sync queue when we cross
      // offline → online. Without this, pending rows written while the app
      // was offline stay 'pending' forever because the only call site for
      // triggerSync() was ActiveWorkout.onSuccess (which itself doesn't
      // fire when the original POST failed).
      triggerWorkoutSync().catch(() => {/* non-fatal */});
    }
    wasOnlineRef.current = online;
  }, [network.isOnline, network.isInternetReachable]);

  // W-2 fix continued: also reconcile the workout-sync queue on background
  // → active foreground transitions and on an auth-state change (login,
  // logout-then-login). These are the other moments at which a pending row
  // may finally have a route to the server. We listen to the generic
  // onAuthChange because every login screen path fires the unnamed
  // `authEvents.emit()` after writing user_data — `emit('login')` is not
  // emitted by all screens today.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        triggerWorkoutSync().catch(() => {/* non-fatal */});
      }
    });
    const unsubAuth = authEvents.onAuthChange(() => {
      triggerWorkoutSync().catch(() => {/* non-fatal */});
    });
    return () => {
      sub.remove();
      unsubAuth();
    };
  }, []);

  const bootstrapAuth = async () => {
    try {
      // secureStorage.getItem migrates any legacy AsyncStorage token into
      // SecureStore on first read, so existing users stay logged in.
      const token = await secureStorage.getItem('supabase_token');
      const parsedUser = await readUserCache();
      const needsRoleSelection = await AsyncStorage.getItem('needs_role_selection');

      if (!token || !parsedUser) {
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
        user = parsedUser;
      } catch (err) {
        logger.warn('RootNavigator', 'non-fatal', err);
        clearUserCache();
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
        // Check coach onboarding wizard gate.
        // On API failure (404/500) fall through to 'coach' — never hard-block.
        try {
          const onboardingRes = await api.get<{ is_complete: boolean }>('/coach/onboarding');
          if (onboardingRes.data.is_complete === false) {
            setAuthState('coach_wizard');
            return;
          }
        } catch (err) { logger.warn('RootNavigator', 'non-fatal', err); }
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

        // Day-1 final onboarding gate. Decacorn-quality flow shown to every
        // student who has not yet completed it. Backend source of truth is
        // `profile.day_one_completed`; we also accept the legacy
        // `onboarding_completed` flag so existing users who already finished
        // the old flow are not asked to redo it. A local AsyncStorage flag
        // and an in-progress resume checkpoint keep the flow alive across
        // reinstalls when the backend hasn't caught up (fail-open).
        try {
          const day1ServerDone = !!user?.profile?.day_one_completed;
          const day1LocalDone = (await AsyncStorage.getItem('day_one_completed')) === 'true';
          const legacyOnboardingDone = !!user?.profile?.onboarding_completed;
          const day1ResumeState = await readDay1ResumeState();
          if (
            !day1ServerDone &&
            !day1LocalDone &&
            (!legacyOnboardingDone || day1ResumeState !== null)
          ) {
            setAuthState('day1onboarding');
            return;
          }
          if (day1ServerDone && !day1LocalDone) {
            await AsyncStorage.setItem('day_one_completed', 'true');
          }
        } catch (err) { logger.warn('RootNavigator', 'non-fatal', err); }

        // Phase 7A: check if Day 1 Win has been completed. Fire-and-forget
        // error handling — if the API is unreachable, skip the win screen and
        // go straight to the client app. The screen can be shown on next boot.
        try {
          const statusResponse = await firstWinApi.getStatus();
          if (!statusResponse.data.completed) {
            setAuthState('day1win');
            return;
          }
        } catch (err) { logger.warn('RootNavigator', 'non-fatal', err); }

        // Sync Crisp identity so operators see the client's account in the dashboard.
        syncCrispIdentity({
          email: user.email ?? '',
          displayName: user.name,
          role: 'student',
        });

        // Re-surface PackageSelectionSheet if dismissed > 24h ago.
        // Only triggers on authenticated re-boots, not the first post-onboarding flow
        // (that is handled inside Day1WinScreen itself).
        try {
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
          const dismissedAt = await prefsStorage.getStringAsync(
            'onboarding.package_prompt_dismissed_at',
          );
          if (dismissedAt) {
            const elapsed = Date.now() - new Date(dismissedAt).getTime();
            if (elapsed > TWENTY_FOUR_HOURS) {
              setAuthState('package_prompt');
              return;
            }
          }
        } catch (err) { logger.warn('RootNavigator', 'non-fatal', err); }

        setAuthState('student');
        return;
      }

      // Token exists but no role yet
      setAuthState('unauthenticated');
    } catch (err) {
      logger.warn('RootNavigator', 'non-fatal', err);
      setAuthState('unauthenticated');
    }
  };

  // Called by Day1WinScreen when the client completes the win OR skips.
  // When `target` is set, the user just completed a win and wants to deep
  // link into the matching logger; we stash it and route after the
  // ClientNavigator mounts.
  const handleDay1WinComplete = (target?: WinType) => {
    pendingDay1Target.current = target ?? null;
    setAuthState('student');
  };

  // After auth flips to 'student' and the navigator mounts, route the user
  // into the logger that matches their selected Day 1 Win card.
  useEffect(() => {
    if (authState !== 'student' || !pendingDay1Target.current) return;
    const target = pendingDay1Target.current;
    pendingDay1Target.current = null;
    // Two-frame delay lets ClientNavigator finish its first commit before
    // we issue the imperative navigate — without it, navigationRef.isReady()
    // can still be false on slower devices.
    const t = setTimeout(() => {
      if (!navigationRef.isReady()) return;
      try {
        // The container ref is typed with the loose root param map; we cast
        // each call's args through `never` because the nested ClientNavigator
        // tab params are not threaded into this module.
        const nav = navigationRef as unknown as {
          navigate: (name: string, params?: object) => void;
        };
        if (target === 'first_meal') {
          nav.navigate('Log');
        } else if (target === 'first_checkin') {
          nav.navigate('Home', { screen: 'Habits' });
        } else if (target === 'logged_first_weight') {
          nav.navigate('MoreTab', { screen: 'Progress' });
        }
      } catch (err) {
        logger.warn('RootNavigator', 'non-fatal', err);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [authState]);

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
      ref={navigationRef}
      linking={linking}
      theme={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: Colors.background,  // bone — Wave 2 global bg
          card: Colors.background,
          text: Colors.textPrimary,        // ink
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
      ) : authState === 'day1onboarding' ? (
        // Day-1 final onboarding. Mounts after signup + lean for any student
        // who has not yet flipped `profile.day_one_completed`. The Ready
        // screen calls authEvents.emit() to bounce us back to bootstrapAuth.
        <Day1OnboardingNavigator />
      ) : authState === 'coach_wizard' ? (
        // New coach — onboarding wizard before full coach dashboard.
        <CoachWizardNavigator />
      ) : authState === 'coach' ? (
        <CoachNavigator />
      ) : authState === 'package_prompt' ? (
        // Re-surface the package sheet after 24h on top of the client app.
        // PackageSelectionSheet renders as a Modal so ClientNavigator underneath
        // is fully mounted and ready when the sheet is dismissed.
        <EntitlementProvider
          onOpenPlans={() => {
            try {
              const nav = navigationRef as unknown as {
                navigate: (name: string, params?: object) => void;
              };
              nav.navigate('MoreTab', { screen: 'ClientPackages' });
            } catch (err) { logger.warn('RootNavigator', 'non-fatal', err); }
          }}
        >
          <ClientNavigator />
          <PackageSelectionSheet
            visible
            onDismiss={() => setAuthState('student')}
            onPaymentSuccess={() => setAuthState('student')}
          />
        </EntitlementProvider>
      ) : (
        <EntitlementProvider
          onOpenPlans={() => {
            try {
              const nav = navigationRef as unknown as {
                navigate: (name: string, params?: object) => void;
              };
              nav.navigate('MoreTab', { screen: 'ClientPackages' });
            } catch (err) { logger.warn('RootNavigator', 'non-fatal', err); }
          }}
        >
          <ClientNavigator />
        </EntitlementProvider>
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
