/**
 * ClientMacrosScreen — read-only view of the client's current macro
 * target (kcal + macros + fiber), plus the coach-supplied note when
 * present and a "last updated" pill.
 *
 * Backed by useCurrentMacrosForSelf() over GET /me/macros/current.
 * Returns null when no target has been set yet — we render an
 * honest empty state pointing the client at their coach rather than
 * fabricating placeholder numbers.
 *
 * Sprint B-2 wiring: no edits from this screen — clients view, coaches
 * prescribe via CoachMacrosReviewScreen. Mutation paths live there.
 */

import React, { useCallback } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MacroTarget } from '../../api/macrosApi';
import { useCurrentMacrosForSelf } from '../../hooks/useMacros';
import { typography, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';

export default function ClientMacrosScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const { data, isLoading, isError, refetch, isRefetching } =
    useCurrentMacrosForSelf();

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={onRefresh}
          tintColor={sc.accent}
        />
      }
    >
      <Text style={[typography.h2, { color: sc.textPrimary }]}>
        Your daily targets
      </Text>

      {isLoading ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Loading...
        </Text>
      ) : isError ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Could not load your targets right now. Pull to retry.
        </Text>
      ) : data ? (
        <TargetCard target={data} styles={styles} sc={sc} />
      ) : (
        <EmptyState styles={styles} sc={sc} />
      )}
    </ScrollView>
  );
}

function TargetCard({
  target,
  styles,
  sc,
}: {
  target: MacroTarget;
  styles: Styles;
  sc: SemanticTokens;
}) {
  return (
    <View style={styles.card}>
      <View>
        <Text style={[typography.display, { color: sc.textPrimary }]}>
          {target.calories_kcal}
        </Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          kcal per day
        </Text>
      </View>

      <View style={styles.hairline} />

      <View style={styles.macroGrid}>
        <MacroCell label="Protein" value={target.protein_g} sc={sc} />
        <MacroCell label="Carbs" value={target.carbs_g} sc={sc} />
        <MacroCell label="Fats" value={target.fats_g} sc={sc} />
        <MacroCell label="Fiber" value={target.fiber_g} sc={sc} />
      </View>

      {target.notes ? (
        <View>
          <Text
            style={[
              typography.eyebrow,
              { color: sc.textMuted, marginBottom: spacing.xs },
            ]}
          >
            Note from your coach
          </Text>
          <Text style={[typography.body, { color: sc.textPrimary }]}>
            {target.notes}
          </Text>
        </View>
      ) : null}

      <Text style={[typography.bodySmall, { color: sc.accent }]}>
        Effective {formatDate(target.effective_from)}
      </Text>
    </View>
  );
}

function MacroCell({
  label,
  value,
  sc,
}: {
  label: string;
  value: number | null;
  sc: SemanticTokens;
}) {
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, paddingVertical: spacing.sm }}>
      <Text
        style={[
          typography.bodySmall,
          { color: sc.textMuted, marginBottom: spacing.xs },
        ]}
      >
        {label}
      </Text>
      <Text style={[typography.h3, { color: sc.textPrimary }]}>
        {value === null ? '—' : `${value}g`}
      </Text>
    </View>
  );
}

function EmptyState({ styles, sc }: { styles: Styles; sc: SemanticTokens }) {
  return (
    <View style={styles.card}>
      <Text style={[typography.h3, { color: sc.textPrimary }]}>
        No targets yet
      </Text>
      <Text style={[typography.body, { color: sc.textMuted }]}>
        Your coach has not set macros for you yet. Once they do you will
        see your daily kcal, protein, carbs, fats, and fiber here.
      </Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'recently';
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
    content: { padding: spacing.lg, gap: spacing.lg },
    card: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    hairline: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: sc.border,
    },
    macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  });
}
