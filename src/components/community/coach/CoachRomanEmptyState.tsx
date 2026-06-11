/**
 * CoachRomanEmptyState — renders the stateful Roman empty-state result for a
 * coach-community surface (fixer R2, BLOCKER 2).
 *
 * A screen reaches its "quiet" branch only when its primary data query has
 * loaded successfully and is genuinely empty. At that point the Roman copy +
 * face for the surface still has to be RESOLVED from the backend voice policy
 * (`useCoachEmptyStatePayload`), which is a separate query. This component
 * renders that separate query's three states DISTINCTLY so the operator-locked
 * face+voice rule holds:
 *
 *   - `loading` \u2192 a non-Roman spinner (NEVER Roman copy while the policy loads).
 *   - `error`   \u2192 `CoachErrorState` with retry (NEVER the calm/celebratory
 *     empty state when the policy fetch failed or the surface is missing).
 *   - `ready`   \u2192 `CoachEmptyState` with the live backend payload \u2014 the ONLY
 *     branch that renders Roman's calm/celebratory copy and his face.
 *
 * The `${testID}` maps to the same id the screen used before so existing
 * success-empty assertions keep working; the loading/error sub-branches use
 * `${testID}-loading` / `${testID}-payload-error`.
 */
import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import CoachEmptyState from './CoachEmptyState';
import CoachErrorState from './CoachErrorState';
import { useTheme } from '../../../theme/useTheme';
import type { RomanEmptyStateResult } from '../../../hooks/useCoachCommunity';

export interface CoachRomanEmptyStateProps {
  /** The discriminated result from `useCoachEmptyStatePayload(surfaceKey)`. */
  result: RomanEmptyStateResult;
  /** Root testID; matches the screen's prior empty-state id (e.g. `*-empty`). */
  testID?: string;
}

export default function CoachRomanEmptyState({
  result,
  testID,
}: CoachRomanEmptyStateProps): React.ReactElement {
  const { semanticColors } = useTheme();

  if (result.status === 'loading') {
    return (
      <View
        style={styles.center}
        testID={testID ? `${testID}-loading` : 'coach-roman-empty-loading'}
      >
        <ActivityIndicator color={semanticColors.accent} />
      </View>
    );
  }

  if (result.status === 'error') {
    const message =
      result.kind === 'contract'
        ? 'Could not load this view. Pull to retry.'
        : 'Could not reach the server. Pull to retry.';
    return (
      <CoachErrorState
        message={message}
        onRetry={result.retry}
        testID={testID ? `${testID}-payload-error` : 'coach-roman-empty-error'}
      />
    );
  }

  return <CoachEmptyState payload={result.payload} testID={testID} />;
}

const styles = StyleSheet.create({
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
