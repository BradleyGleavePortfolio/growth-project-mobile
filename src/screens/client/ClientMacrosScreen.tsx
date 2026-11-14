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
 * Lighter start (onboarding contract v1 addition 8): while the client's macro
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
  type StyleProp,
  type TextStyle,
} from 'react-native';
import type { MacroTarget } from '../../api/macrosApi';
import { useCurrentMacrosForSelf } from '../../hooks/useMacros';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  targetCells,
  type MacroDisplayMode,
} from '../../macros/macroDisplay';
import { reportMacroDisplay, useMacroDisplayMode } from '../../macros/macroDisplayStore';
import { lightTokens, radius, typography, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { useTodayLog } from '../../hooks/useApi';
import { getTodayString } from '../../utils/date';
import QuietBar from '../../ui/progress/QuietBar';
import { formatPlanNumber, MastLine, mast, MastTile, PlanMasthead, planStyleC, useCoachItalic } from './mealplan/planStyleC';

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

  const coachName = data && data.coach_id === coach.data?.id ? coach.data?.name.trim().split(/\s+/)[0] : undefined;
  const eaten = { calories: consumed('total_calories'), protein: consumed('total_protein_g'), carbs: consumed('total_carbs_g'), fat: consumed('total_fat_g'), fiber: null };
  const italic = useCoachItalic();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching || daily.isRefetching}
          onRefresh={onRefresh}
          // Forest pull-down above the masthead: the light ink (LO-927R2 B1).
          tintColor={mast.ink}
        />
      }
    >
      {/* K5 Style C (the nearest drawing, the coach's macros): the deep forest masthead with a rounded foot. */}
      <PlanMasthead title="Your daily targets" testID="macros-masthead" ground={lightTokens.surface.masthead} foot="round"
        eyebrow={!isLoading && !isError && data ? (coachName ? `Set by ${coachName}` : 'Your target') : null}>
        {!isLoading && !isError && data ? (
          <>
            {/* K5 Style C: the day's number large in the serif with its unit beside it. */}
            <View accessible testID="macros-day-target">
              <View style={styles.kcalRow}>
                <Text style={styles.kcal}>{formatPlanNumber(data.calories_kcal)}</Text>
                <MastLine muted style={styles.kcalUnit}>kcal per day</MastLine>
              </View>
              {eaten.calories != null ? <MastLine>{`${formatPlanNumber(eaten.calories)} kcal eaten today`}</MastLine> : null}
            </View>
            {/* K5 Style C: one outlined tile per macro target on the forest. */}
            <View style={styles.tiles} testID="macros-tiles">
              {targetCells(mode).filter((k) => k !== 'fiber').map((k) => (
                <MastTile key={k} label={CELL_LABEL[k]} testID={`macros-tile-${k}`}
                  value={targetValue(data, k) === null ? '—' : `${targetValue(data, k)}g`} />
              ))}
            </View>
          </>
        ) : null}
      </PlanMasthead>

      {/* K5: the cards on the page under the masthead's foot (14 pt, y 603 to 632 px). */}
      <View style={styles.page}>
        {isLoading ? (
          <View style={styles.skeleton} accessible accessibilityRole="progressbar" testID="macros-loading">
            <Text style={[typography.body, { color: sc.textMuted }]}>
              Loading daily targets...
            </Text>
            <View style={[styles.bone, { backgroundColor: sc.border }]} />
            <View style={[styles.bone, styles.boneShort, { backgroundColor: sc.border }]} />
          </View>
        ) : isError ? (
          <View style={[planStyleC.card, styles.cardFill]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[typography.body, { color: sc.textPrimary }]}>
              Could not load your targets right now. Pull to retry.
            </Text>
          </View>
        ) : data ? (
          <>
            <TargetCard target={data} mode={mode} styles={styles} sc={sc} coachName={coachName} eaten={eaten} italic={italic} />
            {daily.isError ? <Text style={[typography.bodySmall, styles.after, { color: sc.textMuted }]} accessibilityLiveRegion="polite">Today's food totals did not load. Pull to retry.</Text>
              : daily.isLoading ? <Text style={[typography.bodySmall, styles.after, { color: sc.textMuted }]}>Loading today's food totals...</Text> : null}
          </>
        ) : (
          <EmptyState styles={styles} sc={sc} />
        )}
      </View>
    </ScrollView>
  );
}

const CELL_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fats', fiber: 'Fiber' } as const;

function targetValue(target: MacroTarget, k: keyof typeof CELL_LABEL): number | null {
  const v = { protein: target.protein_g, carbs: target.carbs_g, fat: target.fats_g, fiber: target.fiber_g }[k];
  return typeof v === 'number' ? v : null;
}

/**
 * Under the masthead (K5 Style C cards on the paper): the macro lines in one
 * card, full width so the eaten / target line fits; the coach's note in the
 * sage note card; then the date it took effect.
 */
function TargetCard({
  target,
  mode = 'full',
  styles,
  sc,
  coachName,
  eaten,
  italic,
}: {
  target: MacroTarget;
  mode?: MacroDisplayMode;
  styles: Styles;
  sc: SemanticTokens;
  coachName?: string;
  eaten: Record<'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', number | null>;
  italic: StyleProp<TextStyle>;
}) {
  const values = {
    protein: target.protein_g,
    carbs: target.carbs_g,
    fat: target.fats_g,
    fiber: target.fiber_g,
  };
  const effective = formatDate(target.effective_from);
  return (
    <View style={styles.stack}>
      <View style={[planStyleC.card, styles.cardFill, styles.macroGrid]} testID="macros-cells">
        {targetCells(mode).map((k) => (
          <MacroCell key={k} label={CELL_LABEL[k]} value={values[k]} current={eaten[k]} sc={sc} />
        ))}
        {mode === 'simple' ? (
          <Text
            style={[typography.bodySmall, { color: sc.textMuted }]}
            testID="macros-simple-note"
          >
            Only calories and protein are shown in this view.
          </Text>
        ) : null}
      </View>

      {target.notes ? (
        <View style={[styles.note, { backgroundColor: sc.surface.sage }]} testID="macros-note">
          <Text style={[planStyleC.eyebrow, { color: sc.accentText, marginBottom: spacing.sm }]}>
            {coachName ? 'Note from your coach' : 'Target note'}
          </Text>
          <Text style={[planStyleC.name, italic, { color: sc.textPrimary }]}>
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
    <View style={[planStyleC.card, styles.cardFill, styles.empty]}>
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
    content: { flexGrow: 1 },
    // K5 Style C: the number at 52 pt in the display serif (its digits 67 px tall at 2x, y 252-318), the unit on its
    // baseline (wraps under at large text).
    kcalRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: spacing.md, marginTop: spacing.md },
    // Lining figures, as K5 sets its number (Cormorant's default figures are old-style).
    kcal: { ...typography.display, fontSize: 52, lineHeight: 62, letterSpacing: 0, color: mast.ink, fontVariant: ['lining-nums', 'tabular-nums'] },
    kcalUnit: { ...typography.body, marginTop: 0 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
    // K5: the cards in the paper colour on the page.
    cardFill: { backgroundColor: sc.bgSurface, borderColor: sc.border },
    page: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: 14, paddingBottom: spacing['3xl'] },
    stack: { gap: spacing.xl },
    macroGrid: { gap: spacing.lg },
    note: { borderRadius: radius.card, padding: spacing.lg },
    empty: { gap: spacing.sm },
    after: { marginTop: spacing.lg },
    skeleton: { gap: spacing.md },
    bone: { height: 14, borderRadius: radius.control, width: '80%' },
    boneShort: { width: '50%' },
  });
}
