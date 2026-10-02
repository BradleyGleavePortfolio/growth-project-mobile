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
import { nonP2PPurchasesHidden } from '../config/purchaseSurfaces';
import { COACH_MANAGED_BODY, COACH_MANAGED_TITLE } from './PaywallSheet';

interface ProtectedScreenProps {
  children: React.ReactNode;
}

export function ProtectedScreen({ children }: ProtectedScreenProps) {
  const { entitlementActive, status, openPlans, messageCoach } = useEntitlement();
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

  // Audit #304 B1 (App Review 3.1.1): on hidden iOS builds the gate never
  // says "Choose a Plan" or offers plans; the coach manages access.
  if (entitlementActive !== true && nonP2PPurchasesHidden()) {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        testID="protected-screen-coach-managed"
      >
        <Text style={[styles.title, { color: colors.textPrimary, ...tokens.typography.h2 }]}>
          {COACH_MANAGED_TITLE}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary, ...tokens.typography.body }]}>
          {COACH_MANAGED_BODY}
        </Text>
        <TouchableOpacity
          style={[styles.coachButton, { backgroundColor: colors.primary }]}
          onPress={messageCoach}
          accessibilityRole="button"
          testID="protected-screen-message-coach"
        >
          <Text
            style={[
              styles.coachButtonText,
              { color: colors.textOnPrimary, ...tokens.typography.bodyMd },
            ]}
          >
            Message your coach
          </Text>
        </TouchableOpacity>
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
  coachButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 4,
  },
  coachButtonText: {
    fontWeight: '500',
  },
  buttonText: {
    fontWeight: '600',
  },
});

export default ProtectedScreen;
