/**
 * RomanState — typed full-surface state for the chat screen (loading /
 * unavailable / offline / error). NOT for per-message send failures (those
 * stay inline with a retry affordance in the screen).
 *
 * FACE+VOICE: every Roman-voiced state renders Roman's face (reused
 * RomanAvatar) beside the copy. All copy comes from romanVoice.ts, which is
 * sourced verbatim from the identity spec §1.6/§2.10 (cited there).
 *
 * The "unavailable" state (backend feature gate off → 404 on every /roman
 * route, roman-feature.guard.ts) is calm and offers NO retry — there is nothing
 * for the user to retry until ops enables the feature, so an error-toast loop
 * (brief §3) is structurally impossible here.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import {
  ROMAN_ERROR_TRANSIENT,
  ROMAN_OFFLINE_BODY,
  ROMAN_OFFLINE_TITLE,
  ROMAN_UNAVAILABLE_BODY,
  ROMAN_UNAVAILABLE_TITLE,
} from './romanVoice';
import { colors, radius, spacing, typography } from '../../theme/tokens';

export type RomanStateKind = 'unavailable' | 'offline' | 'error';

export interface RomanStateProps {
  kind: RomanStateKind;
  /** When provided, renders a retry control (omitted for `unavailable`). */
  onRetry?: () => void;
  testID?: string;
}

function copyFor(kind: RomanStateKind): { title: string; body: string } {
  switch (kind) {
    case 'unavailable':
      return { title: ROMAN_UNAVAILABLE_TITLE, body: ROMAN_UNAVAILABLE_BODY };
    case 'offline':
      return { title: ROMAN_OFFLINE_TITLE, body: ROMAN_OFFLINE_BODY };
    case 'error':
    default:
      return { title: ROMAN_ERROR_TRANSIENT, body: '' };
  }
}

export default function RomanState({
  kind,
  onRetry,
  testID,
}: RomanStateProps): React.ReactElement {
  const { title, body } = copyFor(kind);
  // `unavailable` never offers retry — there is nothing the user can do until
  // the backend gate flips, so we suppress the affordance to avoid a loop.
  const showRetry = kind !== 'unavailable' && typeof onRetry === 'function';

  return (
    <View style={styles.container} testID={testID}>
      <RomanAvatar crop="neutral" size={64} testID="roman-state-avatar" />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body !== '' ? (
        <Text style={styles.body} accessibilityRole="text">
          {body}
        </Text>
      ) : null}
      {showRetry ? (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID="roman-state-retry"
        >
          <Text style={styles.retryLabel}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.h4,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.forest,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  retryLabel: {
    ...typography.bodyMd,
    color: colors.bone,
  },
});
