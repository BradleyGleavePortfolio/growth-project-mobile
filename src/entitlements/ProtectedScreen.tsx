/**
 * ProtectedScreen — fail-closed entitlement gate.
 *
 * Wraps any paid screen so that, until the client's entitlement is *known
 * to be active*, the underlying screen is never rendered. This is the
 * defensive client mirror of `ClientEntitlementGuard` on the backend (Rule
 * 20 — single source of truth, but doubled here because the backend's
 * entitlement audit found paid surfaces without the guard wired
 * server-side).
 *
 * Policy:
 *   - status='loading' or 'checking' on the very first fetch → centered
 *     spinner. We never flash the paywall before we know the answer.
 *   - status='active' → render children.
 *   - status='inactive' / 'unknown' / 'unavailable' (after first fetch
 *     has settled) → render the paywall. `unavailable` (transport /
 *     server error) intentionally fails CLOSED, not open: a 5xx must
 *     not leak a paid surface.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useEntitlement } from './EntitlementProvider';
import { useTheme } from '../theme/useTheme';

interface ProtectedScreenProps {
  children: React.ReactNode;
}

export function ProtectedScreen({ children }: ProtectedScreenProps) {
  const { entitlementActive, status, openPlans } = useEntitlement();
  const { colors, tokens } = useTheme();

  if (status === 'loading' || status === 'checking' || status === 'unknown') {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        testID="protected-screen-loading"
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Fail closed: only an explicit `true` lets paid content render.
  if (entitlementActive !== true) {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        testID="protected-screen-paywall"
      >
        <Text style={[styles.title, { color: colors.textPrimary, ...tokens.typography.h2 }]}>
          Choose a Plan
        </Text>
        <Text
          style={[
            styles.body,
            { color: colors.textSecondary, ...tokens.typography.body },
          ]}
        >
          Select a coaching package to access this feature.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={openPlans}
          accessibilityRole="button"
          testID="protected-screen-view-plans"
        >
          <Text
            style={[
              styles.buttonText,
              { color: colors.textOnPrimary, ...tokens.typography.bodyMd },
            ]}
          >
            View Plans
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    fontWeight: '600',
  },
});

export default ProtectedScreen;
