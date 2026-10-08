import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CoachAiSection from '../../../components/coach/CoachAiSection';
import {
  extractClientAllergies,
  extractClientDietaryRestrictions,
  type LooseProfileRecord,
} from '../../../utils/coach/clientSafetyContext';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientProfile } from '../../../types';
import type { ClientDetailStyles } from './styles';
import { MacroCard } from './MacroCard';
import { ProfileRow } from './ProfileRow';
import { ConsultationSummaryCard } from './ConsultationSummaryCard';
import { useCurrentMacrosForClient } from '../../../hooks/useMacros';
import { useCoachTeamStatus } from '../../../hooks/useCoachRoleType';
import { useHeadCoachHandlesMoney } from '../../../lib/money/headCoachRole';
import { resolveCoachTargets } from '../../../utils/coach/foodReview';

export function SummaryTab({
  profile,
  totals,
  foodShared,
  clientId,
  clientName,
  nudgeSuccess,
  onOpenMessages,
  onOpenNudge,
  onOpenMacrosReview,
  onOpenWorkoutBuilder,
  onOpenAskAi,
  onOpenPayments,
  openWorkoutRequest,
  onWorkoutRequestHandled,
  colors,
  styles,
}: {
  profile: ClientProfile | null;
  totals: { calories: number; protein: number; carbs: number; fat: number };
  foodShared: boolean;
  clientId: string;
  clientName: string;
  nudgeSuccess: boolean;
  onOpenMessages: () => void;
  onOpenNudge: () => void;
  onOpenMacrosReview: () => void;
  onOpenWorkoutBuilder: () => void;
  /**
   * Stream 2 — opens the AskAiActionSheet for this client. Optional so
   * existing usages of SummaryTab in other contexts (e.g. unit tests
   * that don't mount the sheet wiring) don't have to supply it. When
   * omitted, the "Ask AI" pill is not shown.
   */
  onOpenAskAi?: () => void;
  /** COACH-PAY-M-130: opens the client's payments; omitted (no pill) while coach_payment_actions is off. */
  onOpenPayments?: () => void;
  /** AIB-6: open the AI program generator once (from the Workouts tab entry). */
  openWorkoutRequest?: boolean;
  onWorkoutRequestHandled?: () => void;
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  const currentTarget = useCurrentMacrosForClient(clientId);
  const targets = !currentTarget.isLoading && !currentTarget.isError
    ? resolveCoachTargets(currentTarget.data, profile)
    : null;
  const calTarget = targets?.calories ?? 0;
  const calPct = calTarget > 0 ? Math.round((totals.calories / calTarget) * 100) : 0;
  const allergies = extractClientAllergies(profile as unknown as LooseProfileRecord | null);
  const restrictions = extractClientDietaryRestrictions(profile as unknown as LooseProfileRecord | null);

  return (
    <>
      {foodShared === false ? (
        <View style={styles.calorieCard}>
          <Text style={styles.emptyText}>Food logs are not shared with this coach.</Text>
        </View>
      ) : null}
      {/* Calorie Ring Card */}
      {foodShared !== false && <View style={styles.calorieCard}>
        <View style={styles.calorieMain}>
          <Text style={styles.calorieValue}>{Math.round(totals.calories)}</Text>
          <Text style={styles.calorieTarget}>/ {calTarget || '—'} kcal</Text>
        </View>
        <View style={styles.caloriePctBg}>
          <View style={[styles.caloriePctFill, { width: `${Math.min(100, calPct)}%` }]} />
        </View>
        <Text style={styles.caloriePctText}>
          {currentTarget.isLoading ? 'Loading daily target…'
            : currentTarget.isError ? 'Daily target unavailable'
            : calTarget > 0 ? `${calPct}% of daily target` : 'No daily target available'}
        </Text>
        {currentTarget.isError ? (
          <TouchableOpacity onPress={() => void currentTarget.refetch()} accessibilityRole="button">
            <Text style={styles.actionPillText}>Retry target</Text>
          </TouchableOpacity>
        ) : null}
      </View>}

      {/* Macro Cards */}
      {foodShared !== false && <View style={styles.macroGrid}>
        <MacroCard label="Protein" value={totals.protein} target={targets?.protein ?? undefined} unit="g" color={colors.protein} />
        <MacroCard label="Carbs" value={totals.carbs} target={targets?.carbs ?? undefined} unit="g" color={colors.carbs} />
        <MacroCard label="Fat" value={totals.fat} target={targets?.fat ?? undefined} unit="g" color={colors.fat} />
      </View>}

      {/* Profile Info */}
      <Text style={styles.sectionTitle}>Profile</Text>
      <View style={styles.profileGrid}>
        <ProfileRow label="Goal" value={profile?.primaryGoal?.replace(/_/g, ' ') || '—'} />
        <ProfileRow label="Activity" value={profile?.activityLevel?.replace(/_/g, ' ') || '—'} />
        <ProfileRow label="Weight" value={profile?.currentWeight ? `${profile.currentWeight} lbs` : '—'} />
        <ProfileRow label="Target" value={profile?.targetWeight ? `${profile.targetWeight} lbs` : '—'} />
        <ProfileRow label="TDEE" value={profile?.tdee ? `${Math.round(profile.tdee)} kcal` : '—'} />
        <ProfileRow label="Fitness" value={profile?.fitnessLevel || '—'} />
      </View>

      {/* B14: surface allergies + dietary restrictions so the coach can
          eyeball safety constraints before assigning a meal plan. */}
      <Text style={styles.sectionTitle}>Safety</Text>
      <View style={styles.profileGrid}>
        <ProfileRow
          label="Allergies"
          value={
            allergies === undefined
              ? 'Not asked'
              : allergies.length === 0
              ? 'None reported'
              : allergies.join(', ')
          }
        />
        <ProfileRow
          label="Restrictions"
          value={
            restrictions === undefined
              ? 'Not asked'
              : restrictions.length === 0
              ? 'None'
              : restrictions.join(', ')
          }
        />
      </View>

      {/* S-REACH: the client's consultation answers, one tap away. */}
      <ConsultationSummaryCard clientId={clientId} clientName={clientName} colors={colors} />

      {/* Coach → Client actions */}
      <Text style={styles.sectionTitle}>Actions</Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionPill}
          onPress={onOpenMessages}
          accessibilityRole="button"
          accessibilityLabel="Open messages"
        >
          <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
          <Text style={styles.actionPillText}>Messages</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionPill}
          onPress={onOpenNudge}
          accessibilityRole="button"
          accessibilityLabel="Send nudge notification"
        >
          <Ionicons name="notifications-outline" size={18} color={colors.primary} />
          <Text style={styles.actionPillText}>Send Nudge</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionPill}
          onPress={onOpenMacrosReview}
          accessibilityRole="button"
          accessibilityLabel="Review client macros"
        >
          <Ionicons name="nutrition-outline" size={18} color={colors.primary} />
          <Text style={styles.actionPillText}>Macros</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionPill}
          onPress={onOpenWorkoutBuilder}
          accessibilityRole="button"
          accessibilityLabel="Open workout builder"
        >
          <Ionicons name="barbell-outline" size={18} color={colors.primary} />
          <Text style={styles.actionPillText}>Workouts</Text>
        </TouchableOpacity>
        {onOpenPayments ? <PaymentsPill onPress={onOpenPayments} colors={colors} styles={styles} /> : null}
        {/* Stream 2 — opens the Ask-AI sheet. Shown only when a caller wires
            it; ClientDetailScreen does not (see the note there). */}
        {onOpenAskAi ? (
          <TouchableOpacity
            style={styles.actionPill}
            onPress={onOpenAskAi}
            accessibilityRole="button"
            accessibilityLabel="Ask AI to draft a check-in nudge"
            testID="summary-tab-ask-ai-pill"
          >
            <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
            <Text style={styles.actionPillText}>Ask AI</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {nudgeSuccess && (
        <View style={styles.successBanner} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.successBannerText}>Nudge sent</Text>
        </View>
      )}

      {/* Coach AI v1 — generate workout / meal plan / weekly insight drafts.
          Hides the CTAs when /coach/ai/status reports ready=false. */}
      <CoachAiSection
        clientId={clientId}
        clientName={clientName}
        openWorkoutRequest={openWorkoutRequest}
        onWorkoutRequestHandled={onWorkoutRequestHandled}
        clientAllergies={allergies}
        clientDietaryRestrictions={restrictions}
      />
    </>
  );
}

/**
 * COACH-PAY-M-130: hidden for an active sub-coach, whose head coach's practice
 * handles money (every payments route answers 403 sub_coach_billing_blocked).
 * Mounted only while coach_payment_actions is on, so the roster read runs then.
 */
function PaymentsPill({ onPress, colors, styles }: { onPress: () => void; colors: ThemeColors; styles: ClientDetailStyles }) {
  const team = useCoachTeamStatus();
  const headCoachHandlesMoney = useHeadCoachHandlesMoney();
  if (team.role === 'sub_coach' || headCoachHandlesMoney) return null;
  return (
    <TouchableOpacity
      style={styles.actionPill}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open payments, refunds and billing"
      testID="summary-tab-payments-pill"
    >
      <Ionicons name="card-outline" size={18} color={colors.primary} />
      <Text style={styles.actionPillText}>Payments</Text>
    </TouchableOpacity>
  );
}
