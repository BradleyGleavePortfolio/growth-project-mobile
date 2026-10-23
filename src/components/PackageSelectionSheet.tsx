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
 *   Written on "Skip for now" tap, and (`recordShown`, the unsolicited
 *   sheet) the moment it opens, so closing the app, going back or an empty
 *   list never brings it back inside 24h (#836 Sol B1).
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
  Platform,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../theme/tokens';
import { prefsStorage } from '../storage/mmkv';
import api from '../services/api';
import { houseCoachPackagesPath, markShownOnce } from '../lib/planRenewal';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useEntitlement } from '../entitlements/EntitlementProvider';
import { usePackagePurchase } from '../hooks/usePackagePurchase';
import { usePaymentSheetAppearance } from './purchase/usePaymentSheetAppearance';
import PlanTermsBlock from './purchase/PlanTermsBlock';
import PurchaseFeedback from './purchase/PurchaseFeedback';
import { QuietOverline as Overline } from '../ui/sections/QuietSection';
import { oneToOneCoachingLabel } from '../config/purchaseSurfaces';
import { HouseJoined } from './renewal/CoachMonogram';
import { forestPop } from '../theme/tokens';
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
  /** Continue (or close) after a payment step; `paid` only when the payment is confirmed (phase 'success'). */
  onPaymentSuccess: (paid: boolean) => void;
  /**
   * "Open your plan" (the plan is active, or its status needs checking). B-343-3
   * (Sol): without it the action reads "Continue to the app" and closes the
   * sheet like a dismissal, never like a payment success; the notice says
   * where the plan shows (Membership).
   */
  onOpenPlan?: (purchaseId: string | null) => void;
  /** Waits between plan polls while confirming a subscription. Tests pass zeros. */
  planPollDelaysMs?: number[];
  /**
   * Waits between entitlement checks after Stripe confirms a one-time
   * payment (the webhook flips the entitlement). Tests pass zeros.
   */
  entitlementPollDelaysMs?: number[];
  /**
   * Waits between plan reads for Check again and after a card step that
   * ended without a clear answer (B-334-3). Tests pass zeros.
   */
  recheckDelaysMs?: number[];
  /** Coachless Home hand-off: select this package once the list loads (when it is in the list). */
  initialPackageId?: string | null;
  /** Unsolicited sheet (package_prompt, Day 1 on iPhone): save the 24h time when it opens, not only on Skip. */
  recordShown?: boolean;
  /** RENEWAL-M: the client opened it (renewal pop-up, Home banner, house coach page), so the 24h check does not apply. */
  skipSnoozeCheck?: boolean;
  /** RENEWAL-M H2-H3: the house coach's packages (lib/planRenewal), labelled with his name; payment makes him the coach. */
  house?: { id: string; name: string };
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
  recheckDelaysMs,
  initialPackageId,
  recordShown = false,
  skipSnoozeCheck = false,
  house,
}: PackageSelectionSheetProps) {
  const [houseId, houseName] = [house?.id, house?.name];
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
  const [coachName, setCoachName] = useState<string | null>(null);

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
    recheckDelaysMs,
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
        const dismissedAt = skipSnoozeCheck ? undefined : await prefsStorage.getStringAsync(dismissedKey);
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
      if (cancelled) return;
      if (recordShown) {
        try {
          await prefsStorage.set(dismissedKey, new Date().toISOString());
          if (currentUser?.id) await markShownOnce(currentUser.id); // RENEWAL-M: #836's first offer opens once
        } catch {
          // best-effort; still show
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [visible, dismissedKey, recordShown, skipSnoozeCheck, currentUser?.id]);

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
        // #161-5: on iOS the list is labelled 1:1 coaching with the coach by name, as on ClientPackages.
        const coachRead = houseName ?? (Platform.OS === 'ios' && firstLoad
          ? (async () => (await api.get<{ name?: unknown }>('/v1/clients/me/coach'))?.data?.name)().catch(() => null)
          : null);
        const res = await api.get<{ packages: unknown[] } | unknown[]>(
          houseId ? houseCoachPackagesPath(houseId) : '/v1/clients/me/coach/packages',
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
        const name = await coachRead;
        if (cancelled) return;
        if (typeof name === 'string') setCoachName(name);
        setPackages(list);
        setDescriptions(desc);
        if (firstLoad && initialPackageId && list.some((p) => p.id === initialPackageId)) {
          setSelectedId(initialPackageId);
        }
        setLoading(false);
      } catch {
        // API error on the first load — dismiss quietly; a failed reload
        // keeps the list and the notice already on screen.
        if (!cancelled && firstLoad) onDismissRef.current();
      }
    })();
    return () => { cancelled = true; };
  }, [ready, reloadTick, initialPackageId, houseId, houseName]);

  const selected = packages.find((p) => p.id === selectedId) ?? null;

  const handleSelectPlan = useCallback(() => {
    if (!selected) return;
    void purchase.start(selected);
  }, [purchase, selected]);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const busy = purchase.busy;
  const done = state.phase === 'success' || state.phase === 'confirm_slow' || state.phase === 'confirmed_pending';
  const finish = useCallback(() => onPaymentSuccess(state.phase === 'success'), [onPaymentSuccess, state.phase]);
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
      else onDismiss();
    },
    [onOpenPlan, onDismiss],
  );

  if (!visible || !ready) return null;

  const ctaDisabled = !selected || busy;
  const ctaLabel = selected ? planTerms(selected).cta : 'Select this plan';

  return (
    <Modal
      visible={visible && ready}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={done ? finish : handleSkip}
    >
      {houseName && state.phase === 'success' && state.success ? (
        // RENEWAL-M H3 (5.1 Step 7): joining the house coach closes on deep, under either billing style.
        <ScrollView style={{ backgroundColor: forestPop.deep }} contentContainerStyle={{ flexGrow: 1 }}>
          <HouseJoined name={houseName} title={state.success.title} body={state.success.body} onContinue={finish} />
        </ScrollView>
      ) : (
      <View style={styles.sheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.handleBar} />

          <Text style={styles.heading}>Choose your plan</Text>
          <Text style={styles.subtext}>Start with a plan that fits your goals.</Text>

          {(Platform.OS === 'ios' || houseName) && !loading ? (
            <Overline testID="package-sheet-one-to-one">{oneToOneCoachingLabel(coachName)}</Overline>
          ) : null}

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

          <PurchaseFeedback
            purchase={purchase}
            onContinue={finish}
            onOpenPlan={openPlan}
            openPlanLabel={onOpenPlan ? undefined : 'Continue to the app'}
          />

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
              <Text style={[styles.ctaBtnText, ctaDisabled && styles.ctaBtnTextDisabled]}>{ctaLabel}</Text>
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
      )}
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
      fontFamily: tokens.typography.h1.fontFamily,
      fontSize: 28,
      lineHeight: 32,
      color: semanticColors.textPrimary,
      marginBottom: 8,
    },
    subtext: {
      fontFamily: tokens.typography.body.fontFamily,
      fontSize: 15,
      color: semanticColors.textMuted,
      lineHeight: 22,
      marginBottom: 24,
    },
    // Package cards
    packageCard: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: semanticColors.border,
      paddingVertical: 20, paddingHorizontal: 8, minHeight: 44,
      marginBottom: 12,
      backgroundColor: semanticColors.bgPrimary,
    },
    // Selected terms stay AA-readable on the page, with an accent hairline.
    packageCardSelected: {
      borderColor: semanticColors.accent,
      borderTopWidth: 2,
      paddingTop: 20 + StyleSheet.hairlineWidth - 2,
      backgroundColor: semanticColors.bgPrimary,
    },
    packageName: {
      fontFamily: tokens.typography.h2.fontFamily,
      fontSize: 24,
      color: semanticColors.textPrimary,
      marginBottom: 4,
    },
    packagePrice: {
      fontFamily: tokens.typography.h2.fontFamily,
      fontSize: 24, fontVariant: ['tabular-nums'],
      color: semanticColors.textMuted,
      marginBottom: 6,
    },
    packageDesc: {
      fontFamily: tokens.typography.bodySmall.fontFamily,
      fontSize: 13,
      color: semanticColors.textMuted,
      lineHeight: 19,
    },
    // Skeleton
    skeletonCard: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: semanticColors.border,
      padding: 16,
      marginBottom: 12,
      backgroundColor: semanticColors.bgPrimary,
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
      minHeight: 44, borderRadius: tokens.radius.lg,
    },
    ctaBtnDisabled: { backgroundColor: semanticColors.disabledBg },
    ctaBtnTextDisabled: { color: semanticColors.textOnDisabled },
    ctaBtnText: {
      fontFamily: tokens.typography.bodyMd.fontFamily,
      fontSize: 14,
      color: semanticColors.textOnAccent,
    },
    // Skip
    skipBtn: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    skipText: {
      fontFamily: tokens.typography.bodySmall.fontFamily,
      fontSize: 13,
      color: semanticColors.textMuted,
    },
  });
