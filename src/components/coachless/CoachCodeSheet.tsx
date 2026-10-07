/**
 * CoachCodeSheet — enter a coach code after signup (coachless Home).
 *
 *   1. Live validation: once the text is a well-formed code, POST
 *      /coachless/coach-code/check (no write) shows the coach's name or the
 *      specific refusal. Only the latest check is applied.
 *   2. Join: POST /coachless/coach-code/redeem with an Idempotency-Key. One
 *      key per code; a retry of the same code reuses it (a lost answer
 *      replays the same result), a different code gets a new key.
 *   3. Welcome moment from the redeem answer: the coach, then the next step:
 *      an active plan from the code (Done), the featured plan through the
 *      Day 1 plan sheet (Choose a plan), or a message to the coach when the
 *      coach sells no plan in the app or the code's free plan waits for the
 *      onboarding agreement (a granted client is never sent to pay).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { track } from '../../lib/analytics';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { patchUserCache } from '../../lib/userCache';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { logger } from '../../utils/logger';
import { priceLabel, purchasableFromCoachPackage } from '../../lib/planTerms';
import {
  checkCoachCode,
  coachlessFailureOf,
  failureFromCheck,
  isWellFormedCoachCode,
  redeemCoachCode,
  type CoachCard,
  type CoachlessFailure,
  type RedeemResult,
} from '../../api/coachlessApi';
import { grantState, keepsIdempotencyKey, refusalLine } from './coachlessCopy';
import { useCoachSharingNotice } from '../../lib/coachSharingNotice';
import CoachSharingNotice from '../coachSharing/CoachSharingNotice';

export const CHECK_DEBOUNCE_MS = 400;

export interface CoachCodeSheetProps {
  visible: boolean;
  /** Prefill (the featured code when opened from the offer). */
  initialCode?: string | null;
  onClose: () => void;
  /** Attached: the server state changed (refetch Home). */
  onAttached: (result: RedeemResult) => void;
  /** Welcome -> Day 1 plan sheet, the featured package first when there is one. */
  onChoosePlan: (featuredPackageId: string | null) => void;
  /** Welcome -> the coach thread (coach sells no plan in the app). */
  onMessageCoach: () => void;
  /** Tests pass 0. */
  debounceMs?: number;
}

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'valid'; coach: CoachCard }
  | { state: 'refused'; failure: CoachlessFailure };

const norm = (s: string) => s.trim().toUpperCase();

export function featuredPlanLine(result: RedeemResult): string | null {
  const pkg = result.next.featured_package;
  if (!pkg) return null;
  const p = purchasableFromCoachPackage(pkg);
  return p ? `${pkg.name}, ${priceLabel(p)}` : pkg.name;
}

export default function CoachCodeSheet({
  visible,
  initialCode,
  onClose,
  onAttached,
  onChoosePlan,
  onMessageCoach,
  debounceMs = CHECK_DEBOUNCE_MS,
}: CoachCodeSheetProps) {
  const { semanticColors: sc } = useTheme();
  const { refreshEntitlement } = useEntitlement();
  const [code, setCode] = useState(initialCode ?? '');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [joining, setJoining] = useState(false);
  const [joinFailure, setJoinFailure] = useState<CoachlessFailure | null>(null);
  const [welcome, setWelcome] = useState<RedeemResult | null>(null);
  const keyRef = useRef<{ code: string; key: string } | null>(null);
  const checkSeq = useRef(0);
  // B-SHARE-127: the sentence above Join; its version is sent with the code.
  const sharingVersion = useCoachSharingNotice();

  useEffect(() => {
    if (visible) setCode(initialCode ?? '');
  }, [visible, initialCode]);

  // Live validation (debounced; a stale answer never overwrites a newer one).
  useEffect(() => {
    setJoinFailure(null);
    if (!visible || welcome || !isWellFormedCoachCode(code)) {
      checkSeq.current += 1;
      setCheck({ state: 'idle' });
      return;
    }
    const seq = ++checkSeq.current;
    setCheck({ state: 'checking' });
    const t = setTimeout(() => {
      checkCoachCode(code)
        .then((r) => {
          if (seq !== checkSeq.current) return;
          setCheck(
            r.valid
              ? { state: 'valid', coach: r.coach }
              : { state: 'refused', failure: failureFromCheck(r.code) },
          );
        })
        .catch((err: unknown) => {
          if (seq !== checkSeq.current) return;
          setCheck({ state: 'refused', failure: coachlessFailureOf(err) });
        });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [code, visible, welcome, debounceMs]);

  const join = useCallback(async () => {
    if (joining || !isWellFormedCoachCode(code)) return;
    const n = norm(code);
    if (!keyRef.current || keyRef.current.code !== n) {
      keyRef.current = { code: n, key: generateIdempotencyKey() };
    }
    setJoining(true);
    setJoinFailure(null);
    try {
      const result = await redeemCoachCode(code, keyRef.current.key, sharingVersion);
      keyRef.current = null;
      // Local mirror only; the server already holds the attach.
      await patchUserCache({ coach_id: result.coach.id }).catch((e: unknown) =>
        logger.warn('CoachCodeSheet', 'user cache patch failed', e),
      );
      // B-386-SOL-1: a code with a free or prepaid plan activates access on the
      // server; refresh the shared gate now (the same refresh checkout uses),
      // not only on the next foreground.
      void refreshEntitlement().catch((e: unknown) =>
        logger.warn('CoachCodeSheet', 'entitlement refresh after redeem failed', e),
      );
      track('coachless_code_redeemed', { already_attached: result.already_attached });
      setWelcome(result);
      onAttached(result);
    } catch (err) {
      const failure = coachlessFailureOf(err);
      if (!keepsIdempotencyKey(failure.code)) keyRef.current = null;
      track('coachless_code_refused', { code: failure.code });
      setJoinFailure(failure);
    } finally {
      setJoining(false);
    }
  }, [code, joining, onAttached, refreshEntitlement, sharingVersion]);

  const close = useCallback(() => {
    if (joining) return;
    setWelcome(null);
    setJoinFailure(null);
    onClose();
  }, [joining, onClose]);

  const shown = joinFailure ?? (check.state === 'refused' ? check.failure : null);
  const canJoin = isWellFormedCoachCode(code) && !joining;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ScrollView
        style={{ flex: 1, backgroundColor: sc.bgPrimary }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="coach-code-sheet"
      >
        {welcome ? (
          <Welcome
            result={welcome}
            onDone={close}
            onChoosePlan={() => {
              const id = welcome.next.featured_package?.id ?? null;
              close();
              onChoosePlan(id);
            }}
            onMessage={() => {
              close();
              onMessageCoach();
            }}
          />
        ) : (
          <>
            <Text style={[styles.eyebrow, { color: sc.textMuted }]}>COACH CODE</Text>
            <Text style={[styles.title, { color: sc.textPrimary }]}>Enter a coach code</Text>
            <Text style={[styles.body, { color: sc.textMuted }]}>
              A coach code connects this account to a coach for coaching and programs.
            </Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              maxLength={40}
              placeholder="GP-A1B2C3"
              placeholderTextColor={sc.textMuted}
              accessibilityLabel="Coach code"
              testID="coach-code-input"
              onSubmitEditing={() => void join()}
              returnKeyType="go"
              style={[styles.input, { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgSurface }]}
            />
            <View style={styles.status} accessibilityLiveRegion="polite">
              {check.state === 'checking' ? (
                <Text style={[styles.small, { color: sc.textMuted }]} testID="coach-code-checking">
                  Checking the code
                </Text>
              ) : shown ? (
                <Text style={[styles.small, { color: sc.accentText }]} testID="coach-code-refusal">
                  {refusalLine(shown)}
                </Text>
              ) : check.state === 'valid' ? (
                <Text style={[styles.small, { color: sc.textPrimary }]} testID="coach-code-valid">
                  {`Coach: ${check.coach.name}`}
                </Text>
              ) : null}
            </View>
            <CoachSharingNotice
              version={sharingVersion}
              coachName={check.state === 'valid' ? check.coach.name : null}
            />
            <Pressable
              onPress={() => void join()}
              disabled={!canJoin}
              accessibilityRole="button"
              accessibilityLabel="Join this coach"
              accessibilityState={{ disabled: !canJoin, busy: joining }}
              testID="coach-code-join"
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: canJoin ? sc.accent : sc.disabledBg, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              {joining ? (
                <ActivityIndicator color={sc.textOnAccent} />
              ) : (
                <Text style={[styles.ctaText, { color: canJoin ? sc.textOnAccent : sc.textOnDisabled }]}>Join</Text>
              )}
            </Pressable>
            <Pressable onPress={close} accessibilityRole="button" testID="coach-code-cancel" style={styles.secondary}>
              <Text style={[styles.secondaryText, { color: sc.textPrimary }]}>Cancel</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

function Welcome({
  result,
  onDone,
  onChoosePlan,
  onMessage,
}: {
  result: RedeemResult;
  onDone: () => void;
  onChoosePlan: () => void;
  onMessage: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const { coach } = result;
  const grant = grantState(result.grant?.status);
  const plan = featuredPlanLine(result);
  const next =
    grant === 'active' ? 'done' : grant === null && result.next.packages_available > 0 ? 'plan' : 'message';
  return (
    <View testID="coach-code-welcome">
      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>WELCOME</Text>
      {coach.photo_url ? (
        <Image source={{ uri: coach.photo_url }} style={styles.photo} accessibilityIgnoresInvertColors />
      ) : null}
      <Text style={[styles.title, { color: sc.textPrimary }]}>
        {result.already_attached ? `${coach.name} is already your coach.` : `${coach.name} is now your coach.`}
      </Text>
      {coach.business_name ? (
        <Text style={[styles.body, { color: sc.textMuted }]}>{coach.business_name}</Text>
      ) : null}
      <Text style={[styles.body, { color: sc.textPrimary }]} testID="coach-code-next">
        {next === 'done'
          ? `Your plan with ${coach.name} is active.`
          : next === 'plan'
            ? plan
              ? `Next, start the plan: ${plan}.`
              : `Next, choose a plan from ${coach.name}.`
            : grant === 'pending'
              ? `This code includes a plan with ${coach.name}. It turns on once the onboarding agreement is accepted. Message ${coach.name} if it does not show in Membership soon.`
              : `${coach.name} has no plan to buy in the app yet. Send a message to get started.`}
      </Text>
      <Pressable
        onPress={next === 'done' ? onDone : next === 'plan' ? onChoosePlan : onMessage}
        accessibilityRole="button"
        testID="coach-code-next-cta"
        style={({ pressed }) => [styles.cta, { backgroundColor: sc.accent, opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={[styles.ctaText, { color: sc.textOnAccent }]}>
          {next === 'done' ? 'Done' : next === 'plan' ? 'Choose a plan' : `Message ${coach.name}`}
        </Text>
      </Pressable>
      {next !== 'done' ? (
        <Pressable onPress={onDone} accessibilityRole="button" testID="coach-code-later" style={styles.secondary}>
          <Text style={[styles.secondaryText, { color: sc.textPrimary }]}>Later</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 28, paddingTop: 40, paddingBottom: 64 },
  eyebrow: { ...typography.eyebrow, marginBottom: 12 },
  title: { ...typography.h2, marginBottom: 12 },
  body: { ...typography.body, marginBottom: 16 },
  small: { ...typography.bodySmall },
  input: {
    ...typography.body,
    borderWidth: 0.5,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    letterSpacing: 1,
  },
  status: { minHeight: 44, justifyContent: 'center', marginVertical: 8 },
  photo: { width: 64, height: 64, borderRadius: 32, marginBottom: 16 },
  cta: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, marginTop: 8 },
  ctaText: { ...typography.bodyMd },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  secondaryText: { ...typography.bodyMd },
});
