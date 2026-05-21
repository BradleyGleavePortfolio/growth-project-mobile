/**
 * PaywallSheet — global modal sheet shown when EntitlementProvider's
 * paywallVisible flips true (either from a 402 emission via the API
 * interceptor or from a manual openPlans() call). This is the visual
 * counterpart to the policy gate in ProtectedScreen; it is mounted once
 * at the provider tree so any paid screen can trigger it without each
 * caller having to render its own.
 *
 * Defense in depth (Option B): even if the server fully gates every paid
 * endpoint, the sheet still gives the unentitled user a calm recovery
 * surface instead of a raw error. If the package list can't be loaded
 * (offline, server down), the "Subscribe" CTA falls back to the full
 * ClientPackages screen.
 *
 * Accessibility (Hunter #3 P0-2, WCAG 2.1 AA + Apple App Review):
 *   - Every tappable element (package row, "See all plans" CTA, "Maybe
 *     later" close) declares accessibilityRole + accessibilityLabel +
 *     accessibilityHint so VoiceOver / TalkBack announce them as
 *     buttons with the right action and outcome.
 *   - Package rows declare accessibilityState.selected and .disabled
 *     when the row represents the user's current plan, so screen-reader
 *     users can tell which plan they already have.
 *   - The composite cell's <Text> children are marked decorative
 *     (accessibilityElementsHidden + importantForAccessibility) so
 *     VoiceOver does not announce the row's name, description, and
 *     price as three separate elements after the row's computed label.
 *   - The sheet container is marked accessibilityViewIsModal so iOS
 *     traps focus inside the dialog while it's open.
 *   - The title declares accessibilityRole="header" so the first
 *     focused element announces as "heading, Choose a Plan".
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { clientPaymentsApi, ClientCoachPackage } from '../api/clientPaymentsApi';
import { useTheme } from '../theme/useTheme';
import { logger } from '../utils/logger';

export interface PaywallSheetProps {
  visible: boolean;
  message?: string | null;
  onClose: () => void;
  onSubscribe: (packageId?: string) => void;
}

type PackagesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; packages: ClientCoachPackage[] }
  | { kind: 'unavailable'; reason: 'not_configured' | 'error'; message?: string };

export function PaywallSheet({ visible, message, onClose, onSubscribe }: PaywallSheetProps) {
  const theme = useTheme();
  const { colors, tokens } = theme;
  const [pkgState, setPkgState] = useState<PackagesState>({ kind: 'idle' });

  const loadPackages = useCallback(async () => {
    setPkgState({ kind: 'loading' });
    const res = await clientPaymentsApi.getPackages();
    if (!res.ok) {
      if (res.reason === 'error') {
        logger.warn('PaywallSheet', 'getPackages failed', res.message);
      }
      setPkgState({
        kind: 'unavailable',
        reason: res.reason,
        message: res.reason === 'error' ? res.message : undefined,
      });
      return;
    }
    setPkgState({ kind: 'ready', packages: res.data });
  }, []);

  useEffect(() => {
    if (visible) {
      void loadPackages();
    } else {
      setPkgState({ kind: 'idle' });
    }
  }, [visible, loadPackages]);

  const renderPackages = () => {
    if (pkgState.kind === 'loading') {
      return (
        <View
          style={styles.loadingRow}
          testID="paywall-loading"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading coaching plans"
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (pkgState.kind === 'unavailable') {
      const copy =
        pkgState.reason === 'not_configured'
          ? 'Your coach has not enabled plans yet. Please reach out to them.'
          : "We couldn't load plans right now. Tap Subscribe to keep trying.";
      return (
        <Text
          accessibilityRole="alert"
          style={[
            styles.unavailable,
            { color: colors.textSecondary, ...tokens.typography.bodySmall },
          ]}
          testID="paywall-packages-unavailable"
        >
          {copy}
        </Text>
      );
    }
    if (pkgState.kind === 'ready' && pkgState.packages.length === 0) {
      return (
        <Text
          accessibilityRole="alert"
          style={[
            styles.unavailable,
            { color: colors.textSecondary, ...tokens.typography.bodySmall },
          ]}
        >
          No plans are currently available from your coach.
        </Text>
      );
    }
    if (pkgState.kind !== 'ready') return null;
    return (
      <View style={styles.packageList} testID="paywall-package-list">
        {pkgState.packages.map((pkg) => (
          <TouchableOpacity
            key={pkg.id}
            onPress={() => onSubscribe(pkg.id)}
            style={[
              styles.packageRow,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            testID={`paywall-package-${pkg.id}`}
            accessible
            accessibilityRole="button"
            accessibilityLabel={packageAccessibilityLabel(pkg)}
            accessibilityHint="Double tap to start checkout for this plan"
            accessibilityState={{ selected: pkg.is_current, disabled: pkg.is_current }}
          >
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.packageName,
                { color: colors.textPrimary, ...tokens.typography.h4 },
              ]}
            >
              {pkg.name}
            </Text>
            {pkg.description ? (
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.packageDescription,
                  { color: colors.textSecondary, ...tokens.typography.bodySmall },
                ]}
              >
                {pkg.description}
              </Text>
            ) : null}
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.packagePrice,
                { color: colors.primary, ...tokens.typography.bodyMd },
              ]}
            >
              {formatPrice(pkg)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.cardShadow }]} testID="paywall-sheet">
        <View
          accessibilityViewIsModal
          accessibilityLabel="Choose a Plan"
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
            },
          ]}
        >
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text
              accessibilityRole="header"
              style={[
                styles.title,
                { color: colors.textPrimary, ...tokens.typography.h2 },
              ]}
            >
              Choose a Plan
            </Text>
            <Text
              style={[
                styles.message,
                { color: colors.textSecondary, ...tokens.typography.body },
              ]}
            >
              {message ?? 'Select a coaching package to unlock this feature.'}
            </Text>

            {renderPackages()}

            <TouchableOpacity
              style={[styles.subscribeCta, { backgroundColor: colors.primary }]}
              onPress={() => onSubscribe()}
              testID="paywall-subscribe"
              accessible
              accessibilityRole="button"
              accessibilityLabel="See all plans"
              accessibilityHint="Double tap to open the full list of available coaching packages"
            >
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.subscribeText,
                  { color: colors.textOnPrimary, ...tokens.typography.bodyMd },
                ]}
              >
                See all plans
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closeCta}
              onPress={onClose}
              testID="paywall-close"
              accessible
              accessibilityRole="button"
              accessibilityLabel="Maybe later"
              accessibilityHint="Double tap to dismiss this plan picker"
            >
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.closeText,
                  { color: colors.textSecondary, ...tokens.typography.bodySmall },
                ]}
              >
                Maybe later
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function formatPrice(pkg: ClientCoachPackage): string {
  const currency = (pkg.currency || 'usd').toUpperCase();
  const amount = pkg.price.toFixed(2);
  if (pkg.type === 'recurring' && pkg.interval) {
    return `${currency} ${amount} / ${pkg.interval}`;
  }
  return `${currency} ${amount}`;
}

/**
 * Build the VoiceOver / TalkBack announcement for a package row.
 *
 * Composed of (in order): package name, price + interval (for recurring),
 * billing period, and the current-plan state suffix. The state suffix is
 * critical — without it a screen-reader user cannot tell which plan they
 * already have, defeating the purpose of the picker.
 */
export function packageAccessibilityLabel(pkg: ClientCoachPackage): string {
  const currency = (pkg.currency || 'usd').toUpperCase();
  const amount = pkg.price.toFixed(2);
  const isRecurring = pkg.type === 'recurring' && !!pkg.interval;
  const priceClause = isRecurring
    ? `${currency} ${amount} per ${pkg.interval}, billed ${pkg.interval}ly`
    : `${currency} ${amount}, one-time payment`;
  const stateClause = pkg.is_current
    ? 'Current plan'
    : 'Not currently subscribed';
  return `${pkg.name}, ${priceClause}. ${stateClause}.`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: '90%',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 36,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    textAlign: 'center',
    marginBottom: 24,
  },
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  unavailable: {
    textAlign: 'center',
    paddingVertical: 12,
    marginBottom: 12,
  },
  packageList: {
    marginBottom: 16,
  },
  packageRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  packageName: {
    marginBottom: 4,
  },
  packageDescription: {
    marginBottom: 8,
  },
  packagePrice: {
    marginTop: 4,
  },
  subscribeCta: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  subscribeText: {
    fontWeight: '600',
  },
  closeCta: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  closeText: {},
});

export default PaywallSheet;
