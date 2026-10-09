/**
 * Wraps the app shell so a biometric prompt blocks rendering until the user
 * has authenticated (when they've opted in). When opt-in is off, this is a
 * pass-through and renders children immediately on first paint.
 *
 * The gate intentionally does NOT call the auth APIs — it only enforces a
 * local biometric check on top of the existing JWT session. Tokens stay in
 * SecureStore (Keychain/Keystore); the gate just prevents shoulder-surfers
 * from opening the app on an unlocked phone.
 *
 * START-HANG-134 (B36): while the gate checks, only the plain splash
 * background shows (no "Locked", no spinner). "Locked" appears only for a
 * person who turned biometric unlock on and whose unlock did not succeed.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Typography, Spacing } from '../theme';
import { radius } from '../theme/tokens';
import { useBiometricGate } from '../hooks/useBiometricGate';

interface Props {
  children: React.ReactNode;
}

export default function BiometricUnlockGate({ children }: Props) {
  const { status, retry } = useBiometricGate();

  if (status === 'unlocked') {
    return <>{children}</>;
  }

  if (status === 'checking') {
    return <View testID="biometric-gate-checking" style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Locked</Text>
      <Text style={styles.body}>Use Face ID, Touch ID, or your passcode to continue.</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel="Try unlocking again"
        testID="biometric-gate-unlock"
      >
        <Text style={styles.buttonLabel}>Unlock</Text>
      </TouchableOpacity>
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
  button: {
    backgroundColor: Colors.primary,
    borderRadius: radius.button,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  buttonLabel: { ...Typography.button, color: Colors.white },
});
