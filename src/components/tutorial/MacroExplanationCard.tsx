/**
 * MacroExplanationCard (C08) — the client's daily targets with Roman's plain
 * explanation, pinned on Home. Numbers are real: the live
 * `GET /me/macros/current` target when present, else the onboarding complete
 * payload snapshot. Renders nothing when neither exists (no invented
 * defaults). Opening "How to use these numbers" is the real action that
 * satisfies the tutorial's macro step.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import { emitTutorialSignal } from '../../tutorial/tutorialEvents';
import { resolveMacros, useTutorialStore } from '../../tutorial/tutorialStore';
import type { OnboardingMacros } from '../../tutorial/types';
import TutorialTarget from './TutorialTarget';

const fmt = (v: number): string => Math.round(v).toLocaleString('en-US');

export function macroExplanation(m: OnboardingMacros): string {
  const base =
    'These come from your answers: your body, how active you are, and your goal. Log what you eat during the day and aim to land close to each number by the end of it. A little over or under is normal. Aim for close, not perfect.';
  return m.floor_applied
    ? `${base} Your calories are held at a sensible minimum, so the target never drops too low.`
    : base;
}

export function MacroExplanationCardView({
  macros,
}: {
  macros: OnboardingMacros;
}): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const [open, setOpen] = useState(false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) emitTutorialSignal('macro_card_opened');
  };
  const cells: Array<[string, number]> = [
    ['Protein', macros.protein_g],
    ['Carbs', macros.carbs_g],
    ['Fat', macros.fat_g],
  ];
  return (
    <View
      style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}
      testID="macro-explanation-card"
      accessible={false}
    >
      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>YOUR DAILY TARGETS</Text>
      <View
        style={styles.calRow}
        accessible
        accessibilityLabel={`${fmt(macros.calories)} calories a day. Protein ${fmt(macros.protein_g)} grams, carbs ${fmt(macros.carbs_g)} grams, fat ${fmt(macros.fat_g)} grams.`}
      >
        <Text style={[styles.cal, { color: sc.textPrimary }]}>{fmt(macros.calories)}</Text>
        <Text style={[styles.unit, { color: sc.textMuted }]}>kcal</Text>
      </View>
      <View style={styles.grid} importantForAccessibility="no-hide-descendants">
        {cells.map(([label, v]) => (
          <View key={label} style={styles.cell}>
            <Text style={[styles.cellLabel, { color: sc.textMuted }]}>{label.toUpperCase()}</Text>
            <Text style={[styles.cellValue, { color: sc.textPrimary }]}>
              {fmt(v)}
              <Text style={[styles.unit, { color: sc.textMuted }]}> g</Text>
            </Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel="How to use these numbers"
        accessibilityState={{ expanded: open }}
        testID="macro-explanation-toggle"
        style={[styles.disclosure, { borderTopColor: sc.border }]}
      >
        <Text style={[styles.disclosureText, { color: sc.textPrimary }]}>How to use these numbers</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={sc.textMuted} />
      </Pressable>
      {open ? (
        <Text style={[styles.body, { color: sc.textPrimary }]} testID="macro-explanation-body">
          {macroExplanation(macros)}
        </Text>
      ) : null}
    </View>
  );
}

/** Store-connected, flag-gated card for Home. */
export default function MacroExplanationCard(): React.ReactElement | null {
  const macros = useTutorialStore(resolveMacros);
  if (!featureFlags.clientTutorial || !macros) return null;
  return (
    <TutorialTarget id="macro-card">
      <MacroExplanationCardView macros={macros} />
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
    marginBottom: 24,
  },
  eyebrow: { ...typography.eyebrow },
  calRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 10 },
  cal: { ...typography.h1 },
  unit: { ...typography.caption, marginLeft: 6 },
  grid: { flexDirection: 'row', marginTop: 14 },
  cell: { flex: 1 },
  cellLabel: { ...typography.eyebrow },
  cellValue: { ...typography.h3, marginTop: 6 },
  disclosure: {
    minHeight: 44,
    marginTop: 14,
    borderTopWidth: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disclosureText: { ...typography.bodyMd },
  body: { ...typography.bodySmall, paddingBottom: 14 },
});
