/**
 * QuietStates: the one calm "could not load" and the one loading look for
 * coach screens (QA-COACH-STATES-131).
 *
 * QuietError says what failed in words: ink text, no red, no icon, no box.
 * Its first action is a forest text action ("Try again" when `onRetry` is
 * given); further steps (Contact support) are muted text actions. Every
 * target is 44 pt (quietActions). QuietLoading is the shared skeleton
 * (src/ui/skeletons) with its label spoken to screen readers, not printed.
 * Colours come from useTheme().colors, like the host screens.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { SkeletonRow } from '../skeletons/Skeleton';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';
import { quietActions } from '../sections/QuietSection';

export interface QuietErrorAction {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  testID?: string;
}

export interface QuietErrorProps {
  /** What failed and what to do next, in words. */
  message: string;
  /** Runs the failed load again: adds the forest "Try again" first. */
  onRetry?: () => void;
  retryLabel?: string;
  retryHint?: string;
  /** True while the retry runs: Try again is disabled. */
  retrying?: boolean;
  /** More steps; the first is forest only when there is no onRetry. */
  actions?: QuietErrorAction[];
  /** 'block' centres the state in an empty area; 'inline' sits in a section. */
  layout?: 'block' | 'inline';
  /** Root testID; Try again is `${testID}-retry`. */
  testID?: string;
}

export function QuietError({
  message,
  onRetry,
  retryLabel = 'Try again',
  retryHint,
  retrying = false,
  actions = [],
  layout = 'block',
  testID,
}: QuietErrorProps): React.ReactElement {
  const { colors } = useTheme();
  const block = layout === 'block';
  const all: (QuietErrorAction & { disabled?: boolean })[] = [
    ...(onRetry
      ? [{ label: retryLabel, onPress: onRetry, accessibilityHint: retryHint, disabled: retrying, testID: testID ? `${testID}-retry` : undefined }]
      : []),
    ...actions,
  ];
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={block ? styles.block : styles.inline}
      testID={testID}
    >
      <Text style={[styles.message, block && styles.messageBlock, { color: colors.textPrimary }]}>{message}</Text>
      {all.length > 0 ? (
        <View style={[quietActions.row, block && styles.rowBlock]}>
          {all.map((a, i) => (
            <HapticPressable
              key={a.label}
              intent="light"
              onPress={a.onPress}
              disabled={a.disabled}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              accessibilityHint={a.accessibilityHint}
              accessibilityState={{ disabled: !!a.disabled }}
              testID={a.testID}
              style={({ pressed }) => [
                quietActions.action,
                i === all.length - 1 && styles.lastAction,
                { opacity: a.disabled ? 0.5 : pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[quietActions.label, { color: i === 0 ? colors.primary : colors.textMuted }]}>{a.label}</Text>
            </HapticPressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export interface QuietLoadingProps {
  /** Spoken by screen readers, e.g. "Loading invites". */
  label: string;
  rows?: number;
  testID?: string;
}

export function QuietLoading({ label, rows = 3, testID }: QuietLoadingProps): React.ReactElement {
  return (
    <View accessible accessibilityLabel={label} testID={testID} style={styles.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

/** True when the request got no answer: offline, dropped or timed out. */
export function isConnectionFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { response?: unknown; code?: unknown; message?: unknown; isAxiosError?: unknown };
  if (e.response) return false;
  return (
    e.code === 'ERR_NETWORK' ||
    e.code === 'ECONNABORTED' ||
    e.code === 'ETIMEDOUT' ||
    e.message === 'Network Error' ||
    e.isAxiosError === true
  );
}

/**
 * One sentence for a failed load. "Check your connection" only when the
 * request got no answer; server text is never shown. `what` names the
 * thing, e.g. "Your invites".
 */
export function loadFailureMessage(err: unknown, what: string): string {
  return isConnectionFailure(err)
    ? `${what} could not load. Check your connection, then try again.`
    : `${what} could not load. Try again in a moment.`;
}

const styles = StyleSheet.create({
  block: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  inline: { paddingVertical: 8 },
  message: { ...typography.body },
  messageBlock: { textAlign: 'center', maxWidth: 320 },
  rowBlock: { justifyContent: 'center' },
  lastAction: { marginRight: 0 },
  loading: { paddingVertical: 8 },
});
