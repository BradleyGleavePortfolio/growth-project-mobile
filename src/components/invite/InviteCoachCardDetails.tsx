/**
 * The coach card lines under "You will be paired with ..." in the join flow
 * (RoleSelection and CreateAccount invite boxes). COACH-CARD-134: the coach's
 * headline (K1) and specialties (K2) from the coach consultation, served by
 * GET /invite/:code/preview (backend b#897). Each line renders only when
 * present, so a coach who skipped them leaves no blank row; nothing at all
 * when both are absent. Plain text on the page (no box, no chips).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { lightTokens, typography } from '../../theme/tokens';
import { SPECIALTY_OPTIONS } from '../../lib/coachConsultation/flow';

const LABEL: ReadonlyMap<string, string> = new Map(
  SPECIALTY_OPTIONS.filter((o) => o.value !== 'other').map((o) => [o.value, o.label]),
);

/** "Specialises in strength, fat loss and beginners." or null (unknown keys and "other" dropped). */
export function specialtiesSentence(keys: readonly string[] | null | undefined): string | null {
  const labels = (keys ?? []).flatMap((k) => {
    const label = LABEL.get(k);
    return label ? [label.toLowerCase()] : [];
  });
  if (labels.length === 0) return null;
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `Specialises in ${list}.`;
}

interface Props {
  headline?: string | null;
  specialties?: readonly string[] | null;
  testID?: string;
}

export default function InviteCoachCardDetails({ headline, specialties, testID }: Props) {
  const { semanticColors: colors = lightTokens } = useTheme();
  const head = headline?.trim() || null;
  const spec = specialtiesSentence(specialties);
  if (!head && !spec) return null;
  return (
    <View style={styles.wrap} testID={testID}>
      {head ? (
        <Text style={[styles.headline, { color: colors.textPrimary }]} testID={testID ? `${testID}-headline` : undefined}>
          {head}
        </Text>
      ) : null}
      {spec ? (
        <Text style={[styles.specialties, { color: colors.textMuted }]} testID={testID ? `${testID}-specialties` : undefined}>
          {spec}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 4 },
  headline: { ...typography.bodySmall },
  specialties: { ...typography.bodySmall },
});
