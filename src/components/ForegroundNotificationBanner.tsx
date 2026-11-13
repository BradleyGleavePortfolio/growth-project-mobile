// Phase 9 — ForegroundNotificationBanner component.
//
// Renders an in-app banner at the top of the screen when a push notification
// arrives while the app is in the foreground: the owner's Masthead slip
// (#203-E44, ctx#523 style 1), a deep-forest card under the status bar with
// the kind's mark, or the shared safety look for a safety alert. Automatically
// dismisses after 4 seconds (a safety card stays until closed). Tapping
// dismisses and hands the push's tap (pushTapOf, the device tap's own mapping)
// to routePushTap, so it lands where the device tap of the same push lands.
// Swiping up also dismisses.
//
// Mounted once by RootNavigator, over the signed-in client and coach apps
// (FOREGROUND-BANNER-M).

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { NavigationContainerRefContext, type NavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  attachOpenScreenCheck,
  isSafetyBanner,
  useForegroundBanner,
  type BannerPayload,
} from '../store/foregroundBannerStore';
import { useTheme } from '../theme/ThemeProvider';
import { colors as palette, lightTokens, radius, shadows, withAlpha } from '../theme/tokens';
import type { IoniconName } from '../types/common';
import { pushTapLanding, routePushTap } from '../services/pushTapRouter';
import { useReducedMotion } from '../hooks/useReducedMotion';

export const AUTO_DISMISS_MS = 4000;
/** The card's inset from each side (ctx#523 .s1). */
const INSET = 16;
/** What reaches under the card: the shadows.lg blur (4 down, 12) and the stacked edge (4). */
const BELOW = 16;

const BOOKING = [
  'booking_requested', 'booking_confirmed', 'booking_declined', 'booking_cancelled', 'booking_rescheduled',
  'booking_reminder_24h', 'booking_reminder_1h', 'booking_link_needed', 'booking_link_ready', 'booking_request_expired',
];
const NUDGE = ['nudge_missed_checkin', 'nudge_streak_broken', 'nudge_onboarding_abandoned', 'nudge_inactive'];
const COMMUNITY = [
  'community_message_received', 'community_dm_received', 'community_post_replied', 'community_event_starting_soon',
  'community_challenge_milestone', 'community_moderation_action_against_me', 'community_membership_changed',
];
const each = (kinds: string[], mark: IoniconName) => Object.fromEntries(kinds.map((k) => [k, mark]));

/**
 * The kind's mark: one exact match on BannerPayload.kind (the push data's kind, else its type), as ctx#523 style 1
 * draws it; every booking, nudge and community kind takes its family's drawn mark (operator 22:4x PST 11-12). Any
 * other value gets the neutral mark. The look never varies by kind beyond this.
 */
export const KIND_MARKS: Readonly<Record<string, IoniconName>> = {
  message_received: 'chatbubble-outline', // msg_client, msg_coach, modal
  ...each(BOOKING, 'calendar-outline'), // booking_client, booking_coach, two
  coach_new_purchase: 'bag-outline', // purchase
  money_check: 'document-text-outline', // money_review, money_clean (data type)
  dunning_payment: 'card-outline', // long_body
  dunning_dispute: 'card-outline',
  ...each(NUDGE, 'sparkles-outline'), // long_title
  ...each(COMMUNITY, 'people-outline'), // reply_post, space_reply, space_unread, long_space, high_alert
  fasting_complete: 'time-outline', // fasting, offline (data type; the phone's own alert)
  meal_plan_assigned: 'restaurant-outline', // mealplan
};
export const NEUTRAL_MARK: IoniconName = 'notifications-outline';
export const markOf = (kind: string | undefined): IoniconName =>
  kind !== undefined && Object.prototype.hasOwnProperty.call(KIND_MARKS, kind) ? KIND_MARKS[kind] : NEUTRAL_MARK;

type NavRoot = NavigationContainerRef<ParamListBase>;
// A harness that stubs @react-navigation/native has no such context: read as no container.
const NoContainer = createContext<NavRoot | undefined>(undefined);

/**
 * B1 (#203-E45 (1)): true exactly when the focused route is where this push's own tap would land (pushTapLanding:
 * its route and every param it passes), or, for a message push, that client's chat (operator 22:4x). Not ready, no
 * route, no role, no landing, or another item: false, and the banner shows.
 */
export function opensOpenScreen(navRoot: NavRoot, p: BannerPayload): boolean {
  try {
    if (!navRoot.isReady()) return false;
    const route = navRoot.getCurrentRoute();
    if (!route) return false;
    const open = (route.params ?? {}) as Record<string, unknown>;
    const clientId = p.actionParams?.clientId;
    // The coach's chat with one client (coachInbox.ts chatTarget); the push itself opens the inbox.
    if (p.kind === 'message_received' && route.name === 'ClientMessages' && !!clientId && open.clientId === clientId) {
      return true;
    }
    const landing = pushTapLanding(navRoot.getRootState()?.routeNames ?? [], p.actionScreen, p.actionParams, p.deepLink);
    if (!landing || landing.name !== route.name) return false;
    return Object.entries(landing.params ?? {}).every(([key, value]) => open[key] === value);
  } catch {
    return false;
  }
}

export default function ForegroundNotificationBanner() {
  const navRoot = useContext(NavigationContainerRefContext ?? NoContainer);
  useEffect(() => (navRoot ? attachOpenScreenCheck((p) => opensOpenScreen(navRoot, p)) : undefined), [navRoot]);
  const banner = useForegroundBanner((s) => s.banner);
  return banner ? <Banner banner={banner} /> : null;
}

function Banner({ banner }: { banner: BannerPayload }) {
  const { semanticColors: sc = lightTokens } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const dismiss = useForegroundBanner((s) => s.dismissBanner);
  const count = useForegroundBanner((s) => s.count);
  const safe = isSafetyBanner(banner);
  const safeRef = useRef(safe);
  safeRef.current = safe;

  // Until measured, a screen's height above; then the card's own height and what reaches under it.
  const hiddenY = useRef(-Dimensions.get('window').height);
  const translateY = useRef(new Animated.Value(hiddenY.current)).current;
  const measured = useRef(false);
  const [cardWidth, setCardWidth] = useState(0);
  const drain = useRef(new Animated.Value(0)).current;
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateIn = useCallback(() => {
    Animated.timing(translateY, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [translateY]);

  const animateOut = useCallback(
    (onEnd?: () => void) => {
      drain.stopAnimation();
      Animated.timing(translateY, {
        toValue: hiddenY.current,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        dismiss();
        onEnd?.();
      });
    },
    [translateY, drain, dismiss],
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      hiddenY.current = -(height + BELOW);
      setCardWidth(Math.max(0, width - 2 * INSET));
      if (measured.current) return;
      measured.current = true;
      translateY.setValue(hiddenY.current);
      animateIn();
    },
    [translateY, animateIn],
  );

  // A new push on this card restarts the 4 s (B3). B2: a safety card has no timer.
  useEffect(() => {
    if (safe) return undefined;
    autoDismissTimer.current = setTimeout(() => animateOut(), AUTO_DISMISS_MS);
    return () => {
      if (autoDismissTimer.current) {
        clearTimeout(autoDismissTimer.current);
      }
    };
  }, [banner, safe, animateOut]);

  // The timer line drains once over the same 4 s; none under Reduce Motion or on the safety look.
  useEffect(() => {
    if (safe || reduceMotion) return undefined;
    drain.setValue(0);
    const line = Animated.timing(drain, {
      toValue: 1,
      duration: AUTO_DISMISS_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    line.start();
    return () => line.stop();
  }, [banner, safe, reduceMotion, drain]);

  const panResponder = useRef(
    PanResponder.create({
      // B2: a safety card does not swipe away (operator 22:4x); its close, its tap and sign-out do.
      onMoveShouldSetPanResponder: (_, gestureState) => !safeRef.current && gestureState.dy < -10,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy < 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -30) {
          if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
          animateOut();
        } else {
          animateIn();
        }
      },
    }),
  ).current;

  const handleTap = useCallback(() => {
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    const { actionScreen, actionParams, notificationId, deepLink } = banner;
    animateOut(() => routePushTap(actionScreen, actionParams, notificationId, deepLink));
  }, [banner, animateOut]);

  const label = `${banner.title}. ${banner.body}. Tap to view.`;
  const stacked = count >= 2 && !safe;
  const ink = safe ? palette.ink : sc.textOnAccent;

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        styles.container,
        {
          // SDK 56 edge-to-edge: pad below the status-bar / notch using the
          // real safe-area top inset, with a 12px floor so the banner never
          // hugs the very top edge on devices that report a 0 inset.
          paddingTop: Math.max(insets.top, 12),
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.slot}>
        {stacked ? (
          <View testID="foreground-banner-stack" style={[styles.stack, { backgroundColor: palette.forest }]} />
        ) : null}
        <View
          testID="foreground-banner-card"
          style={[
            styles.card,
            safe
              ? { backgroundColor: palette.warningBg, borderWidth: 1.5, borderColor: palette.warningInk }
              : { backgroundColor: sc.surface.masthead, ...shadows.lg },
          ]}
          {...panResponder.panHandlers}
        >
          <View style={styles.clip}>
            {safe ? null : (
              <View
                testID="foreground-banner-rule"
                style={[styles.rule, { backgroundColor: withAlpha(sc.textOnMastheadMuted, 0.45) }]}
              />
            )}
            <TouchableOpacity
              onPress={handleTap}
              activeOpacity={0.9}
              style={styles.main}
              accessibilityRole="button"
              accessibilityLabel={stacked ? `${count} new. ${label}` : label}
            >
              <View style={[styles.ring, safe ? styles.ringSafe : { borderColor: sc.textOnMastheadMuted }]}>
                <Ionicons
                  testID="foreground-banner-mark"
                  name={safe ? 'warning-outline' : markOf(banner.kind)}
                  size={safe ? 26 : 22}
                  color={safe ? palette.warningInk : sc.textOnMastheadMuted}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              </View>
              <View style={styles.words}>
                {stacked ? <Text style={[styles.count, { color: sc.data.leaf }]}>{`${count} new`}</Text> : null}
                <Text style={[safe ? styles.titleSafe : styles.title, { color: ink }]} numberOfLines={2} ellipsizeMode="tail">
                  {banner.title}
                </Text>
                <Text
                  style={[styles.body, { color: safe ? palette.charcoal : sc.textOnMastheadMuted }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {banner.body}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
                animateOut();
              }}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel="Dismiss notification"
            >
              <Ionicons name="close" size={18} color={ink} />
            </TouchableOpacity>
            {safe || reduceMotion ? null : (
              <Animated.View
                testID="foreground-banner-timer"
                style={[
                  styles.timer,
                  {
                    backgroundColor: sc.data.leaf,
                    transform: [{ translateX: drain.interpolate({ inputRange: [0, 1], outputRange: [0, -cardWidth] }) }],
                  },
                ]}
              />
            )}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    // No fill: only the card takes a touch, the screen beside it stays live.
    pointerEvents: 'box-none',
    paddingHorizontal: INSET,
  },
  slot: { marginTop: 8 },
  card: { borderRadius: radius.card },
  clip: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: radius.card, overflow: 'hidden' },
  stack: { position: 'absolute', left: 3, right: 3, top: 10, bottom: -4, borderRadius: radius.card },
  rule: { position: 'absolute', top: 0, left: 16, right: 16, height: 1 },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 12,
    paddingBottom: 14,
    paddingLeft: 14,
    paddingRight: 0,
  },
  ring: {
    width: 38,
    height: 38,
    marginTop: 1,
    borderRadius: radius.chip,
    borderWidth: 1.25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSafe: { borderWidth: 0 },
  words: { flex: 1, minWidth: 0 },
  count: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11.5,
    letterSpacing: 1.15,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  title: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 19, lineHeight: 24 },
  titleSafe: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 20 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 20, marginTop: 2 },
  close: { width: 44, height: 44, marginTop: 2, marginRight: 2, alignItems: 'center', justifyContent: 'center' },
  timer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
});
