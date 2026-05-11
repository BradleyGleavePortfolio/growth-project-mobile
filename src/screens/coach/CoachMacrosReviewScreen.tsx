/**
 * CoachMacrosReviewScreen — coach view of a single client's macro
 * history with a CTA to prescribe a new target (Sprint B-2 will add
 * the prescriber form in a follow-up).
 *
 * Reads /coach/clients/:clientId/macros and surfaces:
 *   - the current target prominently (most recent row whose
 *     effective_from <= today)
 *   - the rolling history below it, newest first
 *
 * No mutation from this screen yet — the prescriber form
 * (computePreset + manual edit + save) lands in a follow-up commit so
 * we can keep this screen small and shipped.
 *
 * Param: `route.params.clientId`. Stack registration is deferred to a
 * separate navigation-config commit; defining the param shape here
 * keeps the registration mechanical when it happens.
 */

import React, { useMemo } from 'react';
import { RouteProp } from '@react-navigation/native';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MacroTarget } from '../../api/macrosApi';
import {
  useClientMacroHistory,
  useCurrentMacrosForClient,
} from '../../hooks/useMacros';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';

// Local param shape — will be hoisted into the coach stack param list
// when the screen is registered. Decoupling here avoids touching the
// root navigator config in this PR.
export type CoachMacrosReviewParams = {
  clientId: string;
  clientName?: string;
};

interface CoachMacrosReviewScreenProps {
  route: RouteProp<{ CoachMacrosReview: CoachMacrosReviewParams }, 'CoachMacrosReview'>;
}

export default function CoachMacrosReviewScreen({
  route,
}: CoachMacrosReviewScreenProps) {
  const { clientId, clientName } = route.params;
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);

  const currentQ = useCurrentMacrosForClient(clientId);
  const historyQ = useClientMacroHistory(clientId);

  const previous = useMemo<MacroTarget[]>(() => {
    const rows = historyQ.data ?? [];
    if (!currentQ.data) return rows;
    return rows.filter((r) => r.id !== currentQ.data?.id);
  }, [historyQ.data, currentQ.data]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Text style={[typography.eyebrow, { color: sc.textMuted }]}>
        Macros
      </Text>
      <Text style={[typography.h2, { color: sc.textPrimary }]}>
        {clientName ?? 'Client'}
      </Text>

      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        Current target
      </Text>
      {currentQ.isLoading ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Loading...
        </Text>
      ) : currentQ.data ? (
        <TargetCard target={currentQ.data} styles={styles} sc={sc} highlight />
      ) : (
        <View style={styles.card}>
          <Text style={[typography.body, { color: sc.textMuted }]}>
            No target set. Use the prescriber to issue the first target.
          </Text>
        </View>
      )}

      <Text style={[typography.bodySmall, { color: sc.textMuted, marginTop: spacing.lg }]}>
        Previous targets
      </Text>
      {historyQ.isLoading ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Loading history...
        </Text>
      ) : previous.length === 0 ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          No prior targets recorded.
        </Text>
      ) : (
        previous.map((t) => (
          <TargetCard key={t.id} target={t} styles={styles} sc={sc} />
        ))
      )}
    </ScrollView>
  );
}

function TargetCard({
  target,
  styles,
  sc,
  highlight,
}: {
  target: MacroTarget;
  styles: Styles;
  sc: SemanticTokens;
  highlight?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        highlight ? { borderColor: sc.accent, borderWidth: 1 } : null,
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[typography.h3, { color: sc.textPrimary }]}>
          {target.calories_kcal} kcal
        </Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          {formatDate(target.effective_from)}
        </Text>
      </View>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        P {target.protein_g}g • C {target.carbs_g}g • F {target.fats_g}g
        {target.fiber_g !== null ? ` • Fiber ${target.fiber_g}g` : ''}
      </Text>
      {target.notes ? (
        <Text style={[typography.bodySmall, { color: sc.textPrimary }]}>
          {target.notes}
        </Text>
      ) : null}
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: { padding: spacing.lg, gap: spacing.sm },
    card: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
  });
}
