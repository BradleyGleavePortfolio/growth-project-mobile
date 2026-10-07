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
  targetCells,
  type MacroDisplayMode,
} from '../../macros/macroDisplay';
import { reportMacroDisplay, useMacroDisplayMode } from '../../macros/macroDisplayStore';
import { typography, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { useTodayLog } from '../../hooks/useApi';
import { getTodayString } from '../../utils/date';
import QuietBar from '../../ui/progress/QuietBar';

export default function ClientMacrosScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const { data, isLoading, isError, refetch, isRefetching } =
    useCurrentMacrosForSelf();
  const currentUser = useCurrentUser();
  const mode = useMacroDisplayMode(currentUser?.id ?? null);
  const daily = useTodayLog(getTodayString());
  const coach = useQuery({
    queryKey: ['macro-target-coach', currentUser?.id],
    queryFn: async () => (await api.get<{ id: string; name: string }>('/v1/clients/me/coach')).data,
    enabled: !!currentUser?.id && !!data?.coach_id,
  });
  const totals = !daily.isError && daily.data && typeof daily.data === 'object'
    ? daily.data as Record<string, unknown> : null;
  const consumed = (key: string) => { const value = totals?.[key]; return typeof value === 'number' ? value : null; };
  useEffect(() => {
    if (data) reportMacroDisplay(data);
  }, [data]);

  const onRefresh = useCallback(() => {
    void refetch();
    void daily.refetch();
  }, [refetch, daily.refetch]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching || daily.isRefetching}
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
          Loading daily targets...
        </Text>
      ) : isError ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Could not load your targets right now. Pull to retry.
        </Text>
      ) : data ? (
        <>
          <TargetCard target={data} mode={mode} styles={styles} sc={sc}
            coachName={data.coach_id === coach.data?.id ? coach.data?.name.trim().split(/\s+/)[0] : undefined}
            eaten={{ calories: consumed('total_calories'), protein: consumed('total_protein_g'), carbs: consumed('total_carbs_g'), fat: consumed('total_fat_g'), fiber: null }} />
          {daily.isError ? <Text style={[typography.bodySmall, { color: sc.textMuted }]}>Today's food totals did not load. Pull to retry.</Text>
            : daily.isLoading ? <Text style={[typography.bodySmall, { color: sc.textMuted }]}>Loading today's food totals...</Text> : null}
        </>
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
  coachName,
  eaten,
}: {
  target: MacroTarget;
  mode?: MacroDisplayMode;
  styles: Styles;
  sc: SemanticTokens;
  coachName?: string;
  eaten: Record<'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', number | null>;
}) {
  const values = {
    protein: target.protein_g,
    carbs: target.carbs_g,
    fat: target.fats_g,
    fiber: target.fiber_g,
  };
  const effective = formatDate(target.effective_from);
  return (
    <View style={styles.card}>
      <Text style={[typography.eyebrow, { color: sc.textMuted }]}>{coachName ? `Set by ${coachName}` : 'Your target'}</Text>
      <View>
        <Text style={[typography.display, { color: sc.textPrimary, fontVariant: ['tabular-nums'] }]}>
          {target.calories_kcal}
        </Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          kcal per day
        </Text>
        {eaten.calories != null ? <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{`${Math.round(eaten.calories)} kcal eaten today`}</Text> : null}
      </View>

      <View style={styles.hairline} />

      <View style={styles.macroGrid}>
        {targetCells(mode).map((k) => (
          <MacroCell key={k} label={CELL_LABEL[k]} value={values[k]} current={eaten[k]} sc={sc} />
        ))}
      </View>

      {mode === 'simple' ? (
        <Text
          style={[typography.bodySmall, { color: sc.textMuted }]}
          testID="macros-simple-note"
        >
          Only calories and protein are shown in this view.
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
            {coachName ? 'Note from your coach' : 'Target note'}
          </Text>
          <Text style={[typography.body, { color: sc.textPrimary }]}>
            {target.notes}
          </Text>
        </View>
      ) : null}

      {effective ? <Text style={[typography.bodySmall, { color: sc.textMuted }]}>Effective {effective}</Text> : null}
    </View>
  );
}

function MacroCell({
  label,
  value,
  sc,
  current,
}: {
  label: string;
  value: number | null;
  sc: SemanticTokens;
  current: number | null;
}) {
  if (label !== 'Fiber') {
    const over = current != null && value != null && current > value ? ` · ${Math.round(current - value)}g over target` : '';
    return <QuietBar label={label} current={current ?? 0} target={current != null && value != null ? value : undefined}
      value={current != null ? `${Math.round(current)}g eaten / ${value}g target${over}` : `${value}g target`} />;
  }
  return (
    <View style={{ paddingVertical: spacing.sm }}>
      <Text
        style={[
          typography.bodySmall,
          { color: sc.textMuted, marginBottom: spacing.xs },
        ]}
      >
        {label}
      </Text>
      <Text style={[typography.body, { color: sc.textPrimary, fontVariant: ['tabular-nums'] }]}>
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
        Daily targets appear here when set.
      </Text>
    </View>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
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
      paddingVertical: spacing.lg,
      gap: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    hairline: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: sc.border,
    },
    macroGrid: { gap: spacing.lg },
  });
}
