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
 *   - status='unknown', 'loading' or 'checking' → centered spinner. We
 *     never flash the paywall before we know the answer.
 *   - status='active' → render children.
 *   - status='inactive' → render the paywall (or the coach-managed /
 *     coachless gate).
 *   - status='unavailable' (the check itself failed: weak signal, 5xx) →
 *     "Your access could not be checked" with Try again, which re-runs
 *     the check (FOOD-GATE-RETRY-130). It still fails CLOSED, not open:
 *     a 5xx must not leak a paid surface.
 *   - TRAIN-GATE-128 exception: once the server has confirmed 'active' in
 *     this app session (`confirmedActive`), a re-check ('checking') or a
 *     failed re-check ('unavailable') keeps the children mounted, so a live
 *     workout survives leaving the app and weak gym signal. Only a confirmed
 *     inactive result (or a 402) gates. The backend guard still answers
 *     every paid call, so nothing new is exposed.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useEntitlement } from './EntitlementProvider';
import { useTheme } from '../theme/useTheme';
import { nonP2PPurchasesHidden } from '../config/purchaseSurfaces';
import {
  COACH_MANAGED_BODY, COACH_MANAGED_TITLE, COACHLESS_BODY, COACHLESS_TITLE, COACHLESS_CTA,
} from './PaywallSheet';
import { useCoachlessClient } from '../hooks/useCoachlessClient';

interface ProtectedScreenProps {
  children: React.ReactNode;
}

export function ProtectedScreen({ children }: ProtectedScreenProps) {
  const {
    entitlementActive, status, confirmedActive, refreshEntitlement, openPlans, messageCoach,
  } = useEntitlement();
  const { colors, tokens } = useTheme();
  const noCoach = useCoachlessClient();

  if (confirmedActive === true && (status === 'checking' || status === 'unavailable')) {
    return <>{children}</>;
  }

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

  // The check failed and access was not confirmed in this session (the
  // confirmed case returned above). Say so instead of a plan or coach gate
  // the client may not need, and let them re-run the check.
  if (status === 'unavailable') {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        testID="protected-screen-check-failed"
      >
        <Text style={[styles.title, { color: colors.textPrimary, ...tokens.typography.h2 }]}>
          Your access could not be checked
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary, ...tokens.typography.body }]}>
          Check the connection, then try again.
        </Text>
        <TouchableOpacity
          style={[styles.coachButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            void refreshEntitlement();
          }}
          accessibilityRole="button"
          testID="protected-screen-try-again"
        >
          <Text
            style={[
              styles.coachButtonText,
              { color: colors.textOnPrimary, ...tokens.typography.bodyMd },
            ]}
          >
            Try again
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Audit #304 B1 (App Review 3.1.1): on hidden iOS builds the gate never
  // says "Choose a Plan" or offers plans; the coach manages access.
  // A coachless client uses the same calm gate to reach the existing code sheet.
  if (entitlementActive !== true && (nonP2PPurchasesHidden() || noCoach)) {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        testID="protected-screen-coach-managed"
      >
        <Text style={[styles.title, { color: colors.textPrimary, ...tokens.typography.h2 }]}>
          {noCoach ? COACHLESS_TITLE : COACH_MANAGED_TITLE}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary, ...tokens.typography.body }]}>
          {noCoach ? COACHLESS_BODY : COACH_MANAGED_BODY}
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
            {noCoach ? COACHLESS_CTA : 'Message your coach'}
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
