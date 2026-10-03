/**
 * PackageSelectionSheet — the Day 1 / package_prompt bottom sheet: the
 * coach's plans, their terms, and in-app payment through the native,
 * TGP-themed Stripe PaymentSheet.
 *
 * Rendered as a Modal (animationType='slide', presentationStyle='pageSheet')
 * so it feels like a native bottom sheet without a third-party dependency.
 *
 * Flow (contracts cited in src/lib/packagePayment.ts):
 *   1. On visible: GET /v1/clients/me/coach/packages (raw CoachPackage rows)
 *   2. The client picks a plan and reads its terms (PlanTermsBlock): price
 *      and interval, today's charge incl. any one-time part, the trial and
 *      the first charge date, cancel anytime in Membership.
 *   3. usePackagePurchase (the one shared flow):
 *        renewing -> subscription-intent -> PaymentSheet (payment, or setup
 *                    for a trial) -> "Confirming your plan" -> success
 *        one-time -> payment-intent -> PaymentSheet -> entitlement -> success
 *        $0       -> claim-free
 *   Renewing plans are sold as real subscriptions (owner 16:04), never
 *   refused and never sold as a single charge.
 *
 * R18: success only after Stripe confirms the sheet and the backend entitles.
 * R19: one idempotency key per attempt, reused on retry; double taps dropped.
 * R17: raw Stripe/backend strings are never shown or reported; secrets are
 *      never logged, stored or sent to Sentry.
 *
 * 24-hour re-surface logic:
 *   MMKV key 'onboarding.package_prompt_dismissed_at:<userId>' (ISO string).
 *   If set and < 24h ago → call onDismiss() immediately.
 *   If set and > 24h ago (or not set) → show sheet.
 *   Written on "Skip for now" tap.
 */

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../theme/tokens';
import { prefsStorage } from '../storage/mmkv';
import api from '../services/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useEntitlement } from '../entitlements/EntitlementProvider';
import { usePackagePurchase } from '../hooks/usePackagePurchase';
import { usePaymentSheetAppearance } from './purchase/usePaymentSheetAppearance';
import PlanTermsBlock from './purchase/PlanTermsBlock';
import PurchaseFeedback from './purchase/PurchaseFeedback';
import {
  planTerms,
  priceLabel,
  purchasableFromCoachPackage,
  type PurchasablePackage,
} from '../lib/planTerms';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoachPackage = PurchasablePackage;

export interface PackageSelectionSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onPaymentSuccess: () => void;
  /**
   * "Open your plan" when the client already has the plan
   * (SUBSCRIPTION_ALREADY_ACTIVE). Defaults to leaving the sheet the same way
   * a successful payment does: the client is already on the plan.
   */
  onOpenPlan?: (purchaseId: string | null) => void;
  /** Waits between plan polls while confirming a subscription. Tests pass zeros. */
  planPollDelaysMs?: number[];
  /**
   * Waits between entitlement checks after Stripe confirms a one-time
   * payment (the webhook flips the entitlement). Tests pass zeros.
   */
  entitlementPollDelaysMs?: number[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DISMISSED_KEY_BASE = 'onboarding.package_prompt_dismissed_at';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

// ─── Skeleton shimmer ─────────────────────────────────────────────────────────

function SkeletonCard({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.skeletonCard}>
      <View style={[styles.skeletonLine, { width: '50%', height: 14 }]} />
      <View style={[styles.skeletonLine, { width: '30%', height: 12, marginTop: 6 }]} />
      <View style={[styles.skeletonLine, { width: '90%', height: 12, marginTop: 8 }]} />
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PackageSelectionSheet({
  visible,
  onDismiss,
  onPaymentSuccess,
  onOpenPlan,
  planPollDelaysMs,
  entitlementPollDelaysMs,
}: PackageSelectionSheetProps) {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);
  const currentUser = useCurrentUser();
  const { refreshEntitlement } = useEntitlement();
  const { appearance, colorScheme } = usePaymentSheetAppearance();
  const dismissedKey = useMemo(
    () => (currentUser?.id ? `${DISMISSED_KEY_BASE}:${currentUser.id}` : null),
    [currentUser?.id],
  );

  const [packages, setPackages] = useState<PurchasablePackage[]>([]);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // passed 24h suppression check
  const [reloadTick, setReloadTick] = useState(0);

  // Latest-ref pattern: callers may pass an inline onDismiss that re-creates
  // every render. Subscribing the effects below to `onDismiss` directly would
  // cause them to re-run (and re-fetch packages) on every parent re-render.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const purchase = usePackagePurchase({
    surface: 'sheet',
    appearance,
    colorScheme,
    planPollDelaysMs,
    entitlementPollDelaysMs,
    onEntitled: () => {
      void refreshEntitlement().catch(() => false);
    },
    // Price or terms moved since the list loaded: show the current ones.
    onReloadNeeded: () => setReloadTick((t) => t + 1),
  });
  const { state } = purchase;

  // ── 24h suppression gate ──────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    if (!dismissedKey) return; // wait for user id to resolve
    let cancelled = false;
    (async () => {
      try {
        const dismissedAt = await prefsStorage.getStringAsync(dismissedKey);
        if (dismissedAt) {
          const elapsed = Date.now() - new Date(dismissedAt).getTime();
          if (elapsed < TWENTY_FOUR_HOURS) {
            // Suppressed — dismiss immediately
            if (!cancelled) onDismissRef.current();
            return;
          }
        }
      } catch {
        // best-effort; show if check fails
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [visible, dismissedKey]);

  // ── Fetch packages when ready (and after a price / terms change) ──────────
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const firstLoad = reloadTick === 0;
    if (firstLoad) {
      setLoading(true);
      setSelectedId(null);
    }
    (async () => {
      try {
        const res = await api.get<{ packages: unknown[] } | unknown[]>(
          '/v1/clients/me/coach/packages',
        );
        // Backend may return { packages: [...] } or a bare array
        const data = res.data;
        const raw: unknown[] = Array.isArray(data)
          ? data
          : (data as { packages?: unknown[] })?.packages ?? [];
        const desc: Record<string, string> = {};
        const list: PurchasablePackage[] = [];
        for (const row of raw) {
          const p = purchasableFromCoachPackage(row);
          if (!p) continue;
          list.push(p);
          const d = (row as { description?: unknown }).description;
          if (typeof d === 'string' && d) desc[p.id] = d;
        }
        if (cancelled) return;
        if (list.length === 0) {
          if (firstLoad) onDismissRef.current();
          return;
        }
        setPackages(list);
        setDescriptions(desc);
        setLoading(false);
      } catch {
        // API error on the first load — dismiss quietly; a failed reload
        // keeps the list and the notice already on screen.
        if (!cancelled && firstLoad) onDismissRef.current();
      }
    })();
    return () => { cancelled = true; };
  }, [ready, reloadTick]);

  const selected = packages.find((p) => p.id === selectedId) ?? null;

  const handleSelectPlan = useCallback(() => {
    if (!selected) return;
    void purchase.start(selected);
  }, [purchase, selected]);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const busy = purchase.busy;
  const done = state.phase === 'success' || state.phase === 'confirm_slow' || state.phase === 'confirmed_pending';
  const handleSkip = useCallback(() => {
    if (busy) return; // never close the sheet in the middle of a payment
    if (dismissedKey) {
      prefsStorage
        .set(dismissedKey, new Date().toISOString())
        .catch(() => {});
    }
    onDismiss();
  }, [busy, onDismiss, dismissedKey]);

  const openPlan = useCallback(
    (purchaseId: string | null) => {
      if (onOpenPlan) onOpenPlan(purchaseId);
      else onPaymentSuccess();
    },
    [onOpenPlan, onPaymentSuccess],
  );

  if (!visible || !ready) return null;

  const ctaDisabled = !selected || busy;
  const ctaLabel = selected ? planTerms(selected).cta : 'Select this plan';

  return (
    <Modal
      visible={visible && ready}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={done ? onPaymentSuccess : handleSkip}
    >
      <View style={styles.sheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.handleBar} />

          <Text style={styles.heading}>Choose your plan</Text>
          <Text style={styles.subtext}>Start with a plan that fits your goals.</Text>

          {/* Package cards */}
          {loading ? (
            <>
              <SkeletonCard styles={styles} />
              <SkeletonCard styles={styles} />
            </>
          ) : (
            packages.map((pkg) => {
              const isSelected = pkg.id === selectedId;
              const description = descriptions[pkg.id];
              return (
                <Pressable
                  key={pkg.id}
                  style={[
                    styles.packageCard,
                    isSelected && styles.packageCardSelected,
                  ]}
                  onPress={() => {
                    if (busy || done) return;
                    setSelectedId(pkg.id);
                    purchase.clearNotice();
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={`${pkg.name}, ${priceLabel(pkg)}`}
                  accessibilityState={{ selected: isSelected, disabled: busy || done }}
                  testID={`package-card-${pkg.id}`}
                >
                  <Text style={styles.packageName}>{pkg.name}</Text>
                  <Text style={styles.packagePrice}>{priceLabel(pkg)}</Text>
                  {description ? (
                    <Text style={styles.packageDesc} numberOfLines={2}>
                      {description}
                    </Text>
                  ) : null}
                  {isSelected ? <PlanTermsBlock pkg={pkg} /> : null}
                </Pressable>
              );
            })
          )}

          <PurchaseFeedback purchase={purchase} onContinue={onPaymentSuccess} onOpenPlan={openPlan} />

          {/* CTA */}
          {done || state.priceChange ? null : (
            <TouchableOpacity
              style={[
                styles.ctaBtn,
                ctaDisabled && styles.ctaBtnDisabled,
              ]}
              onPress={handleSelectPlan}
              disabled={ctaDisabled}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              accessibilityState={{ disabled: ctaDisabled, busy }}
              testID="select-plan-btn"
            >
              <Text style={styles.ctaBtnText}>{ctaLabel}</Text>
            </TouchableOpacity>
          )}

          {/* Skip */}
          {done ? null : (
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={handleSkip}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Skip for now"
              accessibilityState={{ disabled: busy }}
              testID="skip-package-btn"
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    sheet: {
      flex: 1,
      backgroundColor: semanticColors.bgPrimary,
      borderTopWidth: 1,
      borderTopColor: semanticColors.border,
    },
    scrollContent: {
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 40,
    },
    handleBar: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: semanticColors.border,
      marginBottom: 24,
    },
    heading: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 28,
      lineHeight: 32,
      color: semanticColors.textPrimary,
      marginBottom: 8,
    },
    subtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: semanticColors.textMuted,
      lineHeight: 22,
      marginBottom: 24,
    },
    // Package cards
    packageCard: {
      borderWidth: 1,
      borderColor: semanticColors.border,
      borderRadius: 2,
      padding: 16,
      marginBottom: 12,
      backgroundColor: semanticColors.bgSurface,
    },
    packageCardSelected: {
      borderColor: semanticColors.accent,
      backgroundColor: tokens.brand[50],
    },
    packageName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      color: semanticColors.textPrimary,
      marginBottom: 4,
    },
    packagePrice: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: semanticColors.textMuted,
      marginBottom: 6,
    },
    packageDesc: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: semanticColors.textMuted,
      lineHeight: 19,
    },
    // Skeleton
    skeletonCard: {
      borderWidth: 1,
      borderColor: semanticColors.border,
      borderRadius: 2,
      padding: 16,
      marginBottom: 12,
      backgroundColor: semanticColors.bgSurface,
    },
    skeletonLine: {
      borderRadius: 2,
      backgroundColor: semanticColors.border,
    },
    // CTA
    ctaBtn: {
      backgroundColor: semanticColors.accent,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    ctaBtnDisabled: { opacity: 0.5 },
    ctaBtnText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: semanticColors.textOnAccent,
      letterSpacing: 1.2,
    },
    // Skip
    skipBtn: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    skipText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: semanticColors.textMuted,
    },
  });
