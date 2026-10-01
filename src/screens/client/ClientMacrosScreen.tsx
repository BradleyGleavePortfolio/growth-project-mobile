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
 *
 * Lighter start (clinic contract v1 addition 8): while the client's macro
 * display mode is 'simple', only calories and protein are shown, with one
 * quiet line saying carbohydrate and fat join after the first week.
 */

import React, { useCallback, useEffect } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MacroTarget } from '../../api/macrosApi';
import { useCurrentMacrosForSelf } from '../../hooks/useMacros';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  SIMPLE_VIEW_NOTE,
  targetCells,
  type MacroDisplayMode,
} from '../../macros/macroDisplay';
import { reportMacroDisplay, useMacroDisplayMode } from '../../macros/macroDisplayStore';
import { typography, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';

export default function ClientMacrosScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const { data, isLoading, isError, refetch, isRefetching } =
    useCurrentMacrosForSelf();
  const currentUser = useCurrentUser();
  const mode = useMacroDisplayMode(currentUser?.id ?? null);
  useEffect(() => {
    if (data) reportMacroDisplay(data);
  }, [data]);

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
        <TargetCard target={data} mode={mode} styles={styles} sc={sc} />
      ) : (
        <EmptyState styles={styles} sc={sc} />
      )}
    </ScrollView>
  );
}

const CELL_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fats', fiber: 'Fiber' } as const;

function TargetCard({
  target,
  mode = 'full',
  styles,
  sc,
}: {
  target: MacroTarget;
  mode?: MacroDisplayMode;
  styles: Styles;
  sc: SemanticTokens;
}) {
  const values = {
    protein: target.protein_g,
    carbs: target.carbs_g,
    fat: target.fats_g,
    fiber: target.fiber_g,
  };
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
        {targetCells(mode).map((k) => (
          <MacroCell key={k} label={CELL_LABEL[k]} value={values[k]} sc={sc} />
        ))}
      </View>

      {mode === 'simple' ? (
        <Text
          style={[typography.bodySmall, { color: sc.textMuted }]}
          testID="macros-simple-note"
        >
          {SIMPLE_VIEW_NOTE}
        </Text>
      ) : null}

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
