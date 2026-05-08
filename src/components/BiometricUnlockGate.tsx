/**
 * Wraps the app shell so a biometric prompt blocks rendering until the user
 * has authenticated (when they've opted in). When opt-in is off, this is a
 * pass-through and renders children immediately on first paint.
 *
 * The gate intentionally does NOT call the auth APIs — it only enforces a
 * local biometric check on top of the existing JWT session. Tokens stay in
 * SecureStore (Keychain/Keystore); the gate just prevents shoulder-surfers
 * from opening the app on an unlocked phone.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../theme';
import { useBiometricGate } from '../hooks/useBiometricGate';

interface Props {
  children: React.ReactNode;
}

export default function BiometricUnlockGate({ children }: Props) {
  const { status, retry } = useBiometricGate();

  if (status === 'unlocked') {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Locked</Text>
      <Text style={styles.body}>
        {status === 'checking'
          ? 'Verifying…'
          : 'Use Face ID, Touch ID, or your passcode to continue.'}
      </Text>
      {status === 'checking' ? (
        <ActivityIndicator color={Colors.primary} style={styles.spinner} />
      ) : (
        <TouchableOpacity
          style={styles.button}
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel="Try unlocking again"
        >
          <Text style={styles.buttonLabel}>Unlock</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  title: { ...Typography.h1, marginBottom: Spacing.sm },
  body: { ...Typography.body, textAlign: 'center', marginBottom: Spacing.lg },
  spinner: { marginTop: Spacing.md },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  buttonLabel: { ...Typography.button, color: Colors.white },
});
