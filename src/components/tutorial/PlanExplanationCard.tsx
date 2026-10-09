/**
 * PlanExplanationCard (C08) — the assigned program with the reasons it fits
 * the client's answers, pinned on Train. Every field comes from the
 * onboarding complete payload (`program.name`, `weeks`, `days_per_week`,
 * `why[]`); the card renders nothing without a program. Its "Next" row opens
 * the first coach workout still to do (the real assignment, WorkoutAssignment
 * Detail), which is the real action that satisfies the tour's plan beat
 * (prototype 48). "Why this plan" keeps the reasons one tap away.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useMyWorkoutAssignments } from '../../hooks/useWorkoutBuilder';
import type { ClientWorkoutAssignmentWithPlan } from '../../api/workoutBuilderApi';
import { Headline } from '../../ui';
import { typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import { emitTutorialSignal } from '../../tutorial/tutorialEvents';
import { useTutorialStore } from '../../tutorial/tutorialStore';
import type { OnboardingProgram } from '../../tutorial/types';
import { useCoachlessClient } from '../../hooks/useCoachlessClient';
import TutorialTarget from './TutorialTarget';

/**
 * The closing line under "Why this plan". A coached client's coach can change
 * the plan. A coachless client has no coach and no way to edit the assigned
 * plan (WorkoutAssignmentDetail only starts it), so their line names what they
 * really can change: the session itself (ActiveWorkout: Swap, Add set, the
 * weight field). Coachless copy never promises a coach.
 */
export const PLAN_NOTE_COACHED =
  'Start each session light and learn the moves first. Your coach can adjust the plan at any time.';
export const PLAN_NOTE_COACHLESS =
  'Start each session light and learn the moves first. In a workout you can swap an exercise, add a set or change the weight.';

export function planMeta(p: OnboardingProgram): string {
  const parts: string[] = [];
  if (p.weeks) parts.push(`${p.weeks} weeks`);
  if (p.days_per_week) parts.push(`${p.days_per_week} days a week`);
  return parts.join(' · ');
}

export interface PlanNextDay {
  /** The workout name, or null for the list of coach workouts. */
  title: string | null;
  /** Weekday of the scheduled day, when known. */
  when: string | null;
  onPress: () => void;
}

/** Weekday of a YYYY-MM-DD (or ISO) day, read as a calendar day. */
export function weekdayOf(day: string | null | undefined): string | null {
  const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { weekday: 'long' });
}

export function PlanExplanationCardView({
  program,
  coachName,
  next,
  coachless = false,
}: {
  program: OnboardingProgram;
  coachName: string | null;
  next?: PlanNextDay | null;
  /** No coach on the account (`useCoachlessClient`): no coach claims. */
  coachless?: boolean;
}): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const [open, setOpen] = useState(false);
  const reasons = (program.why ?? []).filter((r) => typeof r === 'string' && r.trim()).slice(0, 3);
  const meta = planMeta(program);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) emitTutorialSignal('plan_card_opened');
  };
  return (
    <View
      style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}
      testID="plan-explanation-card"
    >
      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>
        {coachName ? `ASSIGNED BY ${coachName.toUpperCase()}` : 'YOUR PLAN'}
      </Text>
      <Headline level="h2" style={styles.title}>
        {program.name}
      </Headline>
      {meta ? <Text style={[styles.meta, { color: sc.textMuted }]}>{meta}</Text> : null}
      {next ? (
        <Pressable
          onPress={next.onPress}
          accessibilityRole="button"
          accessibilityLabel={
            next.title
              ? `Next: ${next.title}${next.when ? `, ${next.when}` : ''}`
              : coachless
                ? 'Your workouts'
                : 'Your coach workouts'
          }
          testID="plan-next-day"
          style={[styles.disclosure, { borderTopColor: sc.border }]}
        >
          <Text style={[styles.disclosureText, styles.grow, { color: sc.textPrimary }]} numberOfLines={1}>
            {next.title ? `Next: ${next.title}` : 'Your workouts'}
          </Text>
          {next.when ? <Text style={[styles.meta, { color: sc.textMuted }]}>{next.when}</Text> : null}
          <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel="Why this plan"
        accessibilityState={{ expanded: open }}
        testID="plan-explanation-toggle"
        style={[styles.disclosure, { borderTopColor: sc.border }]}
      >
        <Text style={[styles.disclosureText, { color: sc.textPrimary }]}>Why this plan</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={sc.textMuted} />
      </Pressable>
      {open ? (
        <View style={styles.body} testID="plan-explanation-body">
          {reasons.length > 0 ? (
            reasons.map((r, i) => (
              <Text key={i} style={[styles.reason, { color: sc.textPrimary }]}>
                {r}
              </Text>
            ))
          ) : (
            <Text style={[styles.reason, { color: sc.textPrimary }]}>
              It was chosen from your experience, the days you can train and where you train.
            </Text>
          )}
          <Text style={[styles.note, { color: sc.textMuted }]} testID="plan-explanation-note">
            {coachless ? PLAN_NOTE_COACHLESS : PLAN_NOTE_COACHED}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The earliest coach workout not yet done (the plan's next day). */
export function firstPendingAssignment(
  rows: ClientWorkoutAssignmentWithPlan[] | undefined,
): ClientWorkoutAssignmentWithPlan | undefined {
  return (Array.isArray(rows) ? rows : [])
    .filter((a) => !a.completed_at)
    .sort((a, b) => String(a.scheduled_for ?? '').localeCompare(String(b.scheduled_for ?? '')))[0];
}

/** Store-connected, flag-gated card for Train. */
export default function PlanExplanationCard(): React.ReactElement | null {
  const program = useTutorialStore((s) => s.payload?.program ?? null);
  const coachName = useTutorialStore((s) => s.payload?.coach?.display_name ?? null);
  const coachless = useCoachlessClient();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const assignments = useMyWorkoutAssignments();
  if (!featureFlags.clientTutorial || !program?.name) return null;
  const first = firstPendingAssignment(assignments.data);
  // Same cross-tab route as Train's own "Open workout" (MoreStack screens).
  const open = (screen: string, params?: object) =>
    navigation.getParent()?.navigate('MoreTab', { screen, ...(params ? { params } : {}), initial: false });
  const next: PlanNextDay | null = first
    ? {
        title: first.workout_plan?.name ?? 'Your first workout',
        when: weekdayOf(first.scheduled_for),
        onPress: () => open('WorkoutAssignmentDetail', { assignmentId: first.id }),
      }
    : assignments.isLoading
      ? null
      : { title: null, when: null, onPress: () => open('ClientWorkoutViewer') };
  return (
    <TutorialTarget id="plan-card">
      <PlanExplanationCardView program={program} coachName={coachName} next={next} coachless={coachless} />
    </TutorialTarget>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.5,
    borderRadius: radius.card,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
    marginBottom: 20,
  },
  eyebrow: { ...typography.eyebrow },
  title: { marginTop: 10 },
  meta: { ...typography.bodySmall, marginTop: 2 },
  disclosure: {
    minHeight: 44,
    marginTop: 14,
    borderTopWidth: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disclosureText: { ...typography.bodyMd },
  grow: { flex: 1, marginRight: 8 },
  body: { paddingBottom: 14 },
  reason: { ...typography.bodySmall, marginTop: 6 },
  note: { ...typography.caption, marginTop: 10 },
});
