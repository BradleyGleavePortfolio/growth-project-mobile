/**
 * Settings row for the biometric unlock opt-in toggle. Used in both the
 * client and coach Settings screens.
 *
 * On platforms or devices without biometric support the row is hidden so
 * the user never sees a control that does nothing.
 */
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Colors, Spacing } from '../theme';
import {
  getBiometricOptIn,
  setBiometricOptIn,
  isBiometricSupportedOnDevice,
} from '../hooks/useBiometricGate';

export default function BiometricUnlockSetting() {
  const [supported, setSupported] = useState<boolean>(false);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await isBiometricSupportedOnDevice();
      const v = await getBiometricOptIn();
      if (!mounted) return;
      setSupported(ok);
      setEnabled(v);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleToggle = async (next: boolean) => {
    if (next) {
      // Confirm with a fresh biometric prompt before persisting opt-in. This
      // avoids someone enabling the lock for a user whose phone is unlocked
      // but who isn't actually that user.
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Enable biometric unlock',
          disableDeviceFallback: false,
          cancelLabel: 'Cancel',
        });
        if (!result.success) {
          Alert.alert(
            'Biometric unlock',
            'We couldn’t verify your biometrics. Try again.',
          );
          return;
        }
      } catch {
        Alert.alert(
          'Biometric unlock',
          'Biometric authentication isn’t available right now.',
        );
        return;
      }
    }
    await setBiometricOptIn(next);
    setEnabled(next);
  };

  if (loading || !supported) return null;

  return (
    <View style={styles.row}>
      <View style={styles.copyCol}>
        <Text style={styles.label}>Biometric unlock</Text>
        <Text style={styles.help}>
          Require Face ID, Touch ID, or your passcode when reopening the app.
        </Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={handleToggle}
        trackColor={{ false: Colors.border, true: Colors.primary }}
        thumbColor={Colors.textOnPrimary}
        accessibilityLabel="Biometric unlock"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  copyCol: { flex: 1, paddingRight: Spacing.md },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: Colors.dark,
    marginBottom: 2,
  },
  help: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: Colors.textMuted,
  },
});
