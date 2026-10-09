/**
 * START-HANG-134 (B35, B37): the calm startup states, prototype 44 (ST-ERROR).
 * StartupErrorScreen: Roman's line, no red, no error haptic, one forest
 * "Try again" (shared Screen + PrimaryButton + Headline).
 * StartupPending: the loading view; after STARTUP_CEILING_MS it becomes
 * StartupErrorScreen. A startup that finishes meanwhile opens the app.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Screen } from '../ui/layout/Screen';
import { PrimaryButton } from '../ui/buttons/PrimaryButton';
import { Headline } from '../ui/text/Headline';
import RomanAvatar from './roman/RomanAvatar';
import { useTheme } from '../theme/ThemeProvider';
import { STARTUP_CEILING_MS } from '../lib/startupTimebox';

/** 'server': a check did not answer. 'device': this phone's own storage did not. */
export type StartupErrorKind = 'server' | 'device';

export const STARTUP_ERROR_COPY = {
  server: "I couldn't reach the server. Your answers are safe.",
  device: "I couldn't open your account on this phone. Nothing is lost.",
  retry: 'Try again',
} as const;

export interface StartupErrorScreenProps {
  kind?: StartupErrorKind;
  onRetry: () => void;
  testID?: string;
}

export function StartupErrorScreen({
  kind = 'server',
  onRetry,
  testID = 'startup-error',
}: StartupErrorScreenProps): React.ReactElement {
  return (
    <Screen
      scroll={false}
      centerContent
      testID={testID}
      footer={<PrimaryButton label={STARTUP_ERROR_COPY.retry} onPress={onRetry} haptic={false} testID={`${testID}-retry`} />}
    >
      <RomanAvatar crop="neutral" size={40} testID={`${testID}-roman`} />
      <Headline level="h2" style={styles.line} testID={`${testID}-line`}>
        {STARTUP_ERROR_COPY[kind]}
      </Headline>
    </Screen>
  );
}

export interface StartupPendingProps {
  onRetry: () => void;
  ceilingMs?: number;
  testID?: string;
}

export function StartupPending({
  onRetry,
  ceilingMs = STARTUP_CEILING_MS,
  testID = 'startup-pending',
}: StartupPendingProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const [round, setRound] = useState(0);
  const [overdue, setOverdue] = useState(false);

  useEffect(() => {
    setOverdue(false);
    const timer = setTimeout(() => setOverdue(true), ceilingMs);
    return () => clearTimeout(timer);
  }, [ceilingMs, round]);

  if (overdue) {
    return (
      <StartupErrorScreen
        onRetry={() => {
          onRetry();
          setRound((r) => r + 1);
        }}
      />
    );
  }
  return (
    <View testID={testID} style={[styles.pending, { backgroundColor: sc.bgPrimary }]}>
      <ActivityIndicator size="large" color={sc.accent} accessibilityLabel="Opening The Growth Project" />
    </View>
  );
}

const styles = StyleSheet.create({
  line: { marginTop: 20 },
  pending: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
