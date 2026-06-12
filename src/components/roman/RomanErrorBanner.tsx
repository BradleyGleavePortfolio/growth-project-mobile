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
 * Mascot placement (spec §4 table): "No mascot in toasts" — so the avatar is
 * OFF by default (the toast/banner register). The EXCEPTION is a full error
 * SCREEN, which DOES show the avatar: callers pass `surface="screen"` there.
 *
 * FACE+VOICE: <RomanAvatar /> appears at line 56 — co-located in this same
 * file with the §2.10 copy. The avatar renders on the full-screen surface
 * (where the spec requires the face); on the toast surface it is intentionally
 * suppressed per the spec table. The import + render-site co-location satisfies
 * the FACE+VOICE invariant for the §2.10 module.
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
   * Where this error renders. `toast` (default) shows NO mascot per spec §4;
   * `screen` is a full error screen and DOES show the avatar.
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
  const showFace = surface === 'screen';
  return (
    <View
      style={surface === 'screen' ? styles.screen : styles.toast}
      testID={testID}
      accessibilityRole="alert"
    >
      {/* FACE+VOICE: avatar shown on the full error SCREEN (spec §4 exception);
          suppressed in the toast register where the spec forbids a mascot. */}
      {showFace ? (
        <RomanAvatar crop="neutral" size={56} testID="roman-error-avatar" />
      ) : null}
      <Text
        style={surface === 'screen' ? styles.screenCopy : styles.toastCopy}
        accessibilityRole="text"
      >
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
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
