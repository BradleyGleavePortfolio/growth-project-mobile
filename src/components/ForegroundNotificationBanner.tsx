// Phase 9 — ForegroundNotificationBanner component.
//
// Renders a themed in-app banner at the top of the screen when a push
// notification arrives while the app is in the foreground. Automatically
// dismisses after 4 seconds. Tapping dismisses and hands the push's tap
// (pushTapOf, the device tap's own mapping) to routePushTap, so it lands where
// the device tap of the same push lands. Swiping up also dismisses.
//
// Mounted once by RootNavigator, over the signed-in client and coach apps
// (FOREGROUND-BANNER-M).

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useForegroundBanner, type BannerPayload } from '../store/foregroundBannerStore';
import { useTheme } from '../theme/ThemeProvider';
import type { IoniconName } from '../types/common';
import { routePushTap } from '../services/pushTapRouter';

const AUTO_DISMISS_MS = 4000;

export default function ForegroundNotificationBanner() {
  const banner = useForegroundBanner((s) => s.banner);
  return banner ? <Banner banner={banner} /> : null;
}

function Banner({ banner }: { banner: BannerPayload }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const dismiss = useForegroundBanner((s) => s.dismissBanner);

  const translateY = useRef(new Animated.Value(-100)).current;
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
      Animated.timing(translateY, {
        toValue: -120,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        dismiss();
        onEnd?.();
      });
    },
    [translateY, dismiss],
  );

  useEffect(() => {
    if (banner) {
      translateY.setValue(-120);
      animateIn();
      autoDismissTimer.current = setTimeout(() => animateOut(), AUTO_DISMISS_MS);
    }
    return () => {
      if (autoDismissTimer.current) {
        clearTimeout(autoDismissTimer.current);
      }
    };
  }, [banner, animateIn, animateOut, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy < -10,
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

  return (
    <Animated.View
      style={[
        styles.container,
        {
          // SDK 56 edge-to-edge: pad below the status-bar / notch using the
          // real safe-area top inset, with a 12px floor so the banner never
          // hugs the very top edge on devices that report a 0 inset.
          paddingTop: Math.max(insets.top, 12),
          backgroundColor: colors.textPrimary,
          transform: [{ translateY }],
          ...Platform.select({
            ios: {
              shadowColor: colors.textPrimary,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.2,
              shadowRadius: 8,
            },
            android: { elevation: 6 },
          }),
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        onPress={handleTap}
        activeOpacity={0.9}
        style={styles.inner}
        accessibilityRole="button"
        accessibilityLabel={`${banner.title}. ${banner.body}. Tap to view.`}
      >
        <View style={[styles.iconWrap, { backgroundColor: colors.primaryPale }]}>
          <Ionicons
            name={'notifications' as IoniconName}
            size={18}
            color={colors.primary}
            accessibilityElementsHidden
          />
        </View>
        <View style={styles.textBlock}>
          <Text
            style={[styles.title, { color: colors.textOnPrimary }]}
            numberOfLines={1}
          >
            {banner.title}
          </Text>
          <Text
            style={[styles.body, { color: colors.textOnPrimary }]}
            numberOfLines={2}
          >
            {banner.body}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
            animateOut();
          }}
          // [P06] 44 pt: 18 pt icon plus slop, inside the row (its top padding is 12).
          hitSlop={{ top: 12, bottom: 14, left: 13, right: 13 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
        >
          <Ionicons name={'close' as IoniconName} size={18} color={colors.textOnPrimary} />
        </TouchableOpacity>
      </TouchableOpacity>
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
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingBottom: 0,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.85,
  },
});
