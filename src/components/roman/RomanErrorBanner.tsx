/**
 * RomanErrorBanner — §2.10 Generic error / system failure (BOTH apps).
 *
 * Roman owns the failure without grovelling (spec §1.6): states the fact,
 * states the remedy, and stops. Two modes:
 *   - `default` — a transient failure while a retry is still available.
 *   - `error`   — a hard failure after retries are exhausted.
 * There is no celebration variant for a failure (spec §2.10 marks it N/A), and
 * the copy function's type forbids one.
 *
 * FACE+VOICE invariant (P0): Roman copy from lib/roman/copy implies a
 * RomanAvatar in the same tree on EVERY render-site — including the toast. The
 * operator rule is verbatim: "his voice always appears WITH HIS FACE." The
 * earlier reading of the spec §4 "no mascot in toasts" row produced a
 * voice-without-face toast, which the invariant forbids; the invariant wins, so
 * the avatar now renders on both surfaces. It is a compact mark in the toast
 * register (quiet-luxury, same small-avatar pattern the other Roman P3 rows
 * use) and a larger one on the full error screen.
 *
 * Accessibility: the banner keeps accessibilityRole="alert" (so assistive tech
 * announces the failure immediately); it deliberately does NOT add a polite
 * live region, which would double-announce the alert.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { romanGenericError } from '../../lib/roman/copy';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanErrorBannerProps {
  /**
   * default — transient (retry available); error — hard failure (retry
   * exhausted). These are the only two §2.10 variants.
   */
  mode?: 'default' | 'error';
  /**
   * Where this error renders. `toast` (default) is the compact inline banner;
   * `screen` is a full error screen. Per the FACE+VOICE invariant (P0) BOTH
   * surfaces render the avatar — the toast uses a compact mark, the screen a
   * larger one.
   */
  surface?: 'toast' | 'screen';
  testID?: string;
}

export default function RomanErrorBanner({
  mode = 'default',
  surface = 'toast',
  testID,
}: RomanErrorBannerProps): React.ReactElement {
  // Deferred (roman-quip-budget): §2.10 permits a self-deprecating quip on
  // TRANSIENT errors only ("I am, regrettably, only as quick as the network
  // allows."). Gate on the ~1-in-8 ceiling (§1.5); never quip on a hard
  // data-loss failure.
  const line = romanGenericError({ mode });
  const isScreen = surface === 'screen';
  return (
    <View
      style={isScreen ? styles.screen : styles.toast}
      testID={testID}
      accessibilityRole="alert"
    >
      {/* FACE+VOICE (P0): the avatar co-mounts with the §2.10 copy on BOTH
          surfaces. Compact in the toast register, larger on the full screen. */}
      <RomanAvatar
        crop="neutral"
        size={isScreen ? 56 : 28}
        testID="roman-error-avatar"
      />
      <Text
        style={isScreen ? styles.screenCopy : styles.toastCopy}
        accessibilityRole="text"
      >
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.cream,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
  },
  toastCopy: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.bone,
  },
  screenCopy: {
    ...typography.h4,
    color: colors.ink,
    textAlign: 'center',
  },
});
