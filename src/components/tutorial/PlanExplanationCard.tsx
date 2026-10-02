/**
 * PlanExplanationCard (C08) — the assigned program with the reasons it fits
 * the client's answers, pinned on Train. Every field comes from the
 * onboarding complete payload (`program.name`, `weeks`, `days_per_week`,
 * `why[]`); the card renders nothing without a program. Opening "Why this
 * plan" is the real action that satisfies the tutorial's plan step.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import { emitTutorialSignal } from '../../tutorial/tutorialEvents';
import { useTutorialStore } from '../../tutorial/tutorialStore';
import type { OnboardingProgram } from '../../tutorial/types';
import TutorialTarget from './TutorialTarget';

export function planMeta(p: OnboardingProgram): string {
  const parts: string[] = [];
  if (p.weeks) parts.push(`${p.weeks} weeks`);
  if (p.days_per_week) parts.push(`${p.days_per_week} days a week`);
  return parts.join(' · ');
}

export function PlanExplanationCardView({
  program,
  coachName,
}: {
  program: OnboardingProgram;
  coachName: string | null;
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
      <Text style={[styles.title, { color: sc.textPrimary }]} accessibilityRole="header">
        {program.name}
      </Text>
      {meta ? <Text style={[styles.meta, { color: sc.textMuted }]}>{meta}</Text> : null}
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
          <Text style={[styles.note, { color: sc.textMuted }]}>
            Start each session light and learn the moves first. Your coach can adjust the plan at any time.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Store-connected, flag-gated card for Train. */
export default function PlanExplanationCard(): React.ReactElement | null {
  const program = useTutorialStore((s) => s.payload?.program ?? null);
  const coachName = useTutorialStore((s) => s.payload?.coach?.display_name ?? null);
  if (!featureFlags.clientTutorial || !program?.name) return null;
  return (
    <TutorialTarget id="plan-card">
      <PlanExplanationCardView program={program} coachName={coachName} />
    </TutorialTarget>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.5,
    borderRadius: radius.lg,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
    marginBottom: 20,
  },
  eyebrow: { ...typography.eyebrow },
  title: { ...typography.h2, marginTop: 10 },
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
  body: { paddingBottom: 14 },
  reason: { ...typography.bodySmall, marginTop: 6 },
  note: { ...typography.caption, marginTop: 10 },
});
