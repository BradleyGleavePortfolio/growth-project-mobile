/**
 * WORKOUT-DETAIL-M: an exercise's page shows the client's own history as the picked C1 Style C v2 drawing draws it
 * (planning/MOCKUP3/C1/style-c-v2/C2_detail_ios390_100.png; pixel rows and columns at 2x in each comment): the Best
 * ever tile, the Since week 1 tile with its line, and YOUR HISTORY rows with a strip and the coach's comments. Used
 * only by ExerciseDetailScreen. Every number is the server's answer as sent (GET /workouts/exercise-history); gold and
 * the star mark the best only (index-v2.md section 4). Colours come from the theme only. Any other history state
 * (loading, failed, none) draws nothing here: the page is then exactly as it was.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { PeakStar } from '../../../ui/charts/StyleCMarks';
import { radius, spacing, typography } from '../../../theme/tokens';
import type { SemanticTokens } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import type { ExerciseHistory, HistoryPoint, HistorySession, TopSet } from '../../../api/exerciseHistoryApi';
import { sectionHead, useCoachItalic } from './workoutStyleC';
import { readsBW } from '../../../utils/workout/bodyWeight';

// ─── The rules ──────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
/**
 * "Oct 13" (spoken "October 13") for the server's "2026-10-13": that calendar day, read from its parts, so no time
 * zone can move it (a Date parsed from it would be UTC midnight, the day before in Los Angeles).
 */
export function dayLabel(date: string, spoken = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return date;
  return `${spoken ? month : month.slice(0, 3)} ${Number(m[3])}`;
}

/**
 * A top set as drawn: "155 × 6"; a body-weight exercise's set with no added load reads "BW × 12". Body weight comes
 * from the exercise, never from a 0 weight (bodyWeight.ts, FIX-928-BW; LS-986R1 B1): a weighted exercise at 0 reads
 * "0 × 10". The page passes whether its exercise is body weight.
 */
export const setText = (t: TopSet, bodyWeight = true): string =>
  `${readsBW(bodyWeight, t.weight_lbs) ? 'BW' : t.weight_lbs} × ${t.reps}`;
/** A history row's set: "155 × 6 lb", "0 × 10 lb"; "BW × 12" has no unit. */
export const rowSetText = (t: TopSet, bodyWeight = true): string =>
  (readsBW(bodyWeight, t.weight_lbs) ? setText(t, bodyWeight) : `${setText(t, bodyWeight)} lb`);
/** Spoken: "155 pounds by 6", "0 pounds by 10", "body weight by 12". */
export const spokenSet = (t: TopSet, bodyWeight = true): string =>
  `${readsBW(bodyWeight, t.weight_lbs) ? 'body weight' : `${t.weight_lbs} pounds`} by ${t.reps}`;
/** The Since week 1 change as drawn: "+20 lb", a fall "−10 lb", none "+0 lb". */
export const changeText = (n: number): string => `${n < 0 ? '−' : '+'}${Math.abs(n)} lb`;

const sameSet = (a: TopSet | null | undefined, b: TopSet | null | undefined): boolean =>
  !!a && !!b && a.weight_lbs === b.weight_lbs && a.reps === b.reps;
const isBest = (p: HistoryPoint, best: HistoryPoint | null): boolean =>
  !!best && p.date === best.date && sameSet(p.top_set, best.top_set);

/** The one row the star sits on: date and top set equal best's; two such rows (same day, same set): the older. */
export function starRow(h: ExerciseHistory): number {
  let at = -1;
  h.sessions.forEach((s, i) => {
    if (isBest(s, h.best)) at = i; // newest first, so the last hit is the oldest
  });
  return at;
}

export interface SinceWeek1 {
  /** The newest top set's weight minus week 1's. */
  change: number;
  /** The line: each weighted top set, oldest to newest, from week 1. */
  weights: number[];
  from: number;
  to: number;
  /** Gold end: the newest point is the best (the same session the star marks). */
  endIsBest: boolean;
}

/**
 * Week 1 is the server's first; today is the newest session with a weighted top set. Absent when week 1 has no top
 * set or weight 0, or when the weighted sessions fall on fewer than two dates. Week 1 leads the line when it is older
 * than every returned session (past 100 sessions); with 100 or fewer it is the oldest returned row.
 */
export function sinceWeek1(h: ExerciseHistory): SinceWeek1 | null {
  const first = h.first;
  if (!first?.top_set || !(first.top_set.weight_lbs > 0)) return null;
  const weighted = [...h.sessions].reverse().filter((s) => !!s.top_set && s.top_set.weight_lbs > 0);
  const oldest = h.sessions[h.sessions.length - 1];
  const points: HistoryPoint[] = oldest && first.date < oldest.date ? [first, ...weighted] : weighted;
  if (new Set(points.map((p) => p.date)).size < 2) return null;
  const end = points[points.length - 1];
  const weights = points.map((p) => (p.top_set as TopSet).weight_lbs);
  const from = first.top_set.weight_lbs;
  const to = (end.top_set as TopSet).weight_lbs;
  return { change: Math.round((to - from) * 10) / 10, weights, from, to, endIsBest: isBest(end, h.best) };
}

/**
 * Each row's dot along its strip (0 to 1), one scale for the page: C2_detail puts the lowest top set a quarter in
 * (145 at col 302 of the 192-636 track) and the highest three quarters in (155 at col 523). All equal: centred. No
 * top set: no dot.
 */
export function stripSpots(sessions: HistorySession[]): (number | null)[] {
  const weights = sessions.map((s) => (s.top_set ? s.top_set.weight_lbs : null));
  const known = weights.filter((w): w is number => w !== null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  return weights.map((w) => (w === null ? null : hi > lo ? 0.25 + (0.5 * (w - lo)) / (hi - lo) : 0.5));
}

// ─── The drawing ────────────────────────────────────────────────────────────

/** Sizes read from C2_detail at 2x. */
const C2 = {
  /** Tiles 165 pt each at 390 (cols 48-377, 402-731); side by side down to 150 (360), stacked below that. */
  tileMin: 150,
  /** The date column: the value starts at col 192 (72 pt in); "Sep 29" wraps at 130%. */
  dateWidth: 56,
  /** The line: ink from col 440 to the end point's centre at col 646 (103 pt), rows 700-751 with its end point. */
  lineWidth: 102,
  lineHeight: 20,
  /** End point, rows 700-720: 10 pt. */
  end: 10,
  /** REFINE-986: tile rows 574-831 (128.5 pt): eyebrow ink 16 pt under the tile top, caption ink 16.5 pt over its foot. */
  tilePadY: 14,
  /** The line stays on rows 700-751 under the closer number. */
  lineTop: 2,
  /** The meta line's baseline (row 307) to the next block (row 346): 19.5 pt (20.5 at 130%); the meta keeps main's 12. */
  tilesTop: 1,
  /** Strip: track rows 986-989 (2 pt); moss dot cols 404-423 (10 pt); the best's gold dot cols 512-535 (12 pt). */
  track: 2,
  dot: 10,
  bestDot: 12,
  /** Stars: the eyebrow's cols 83-102, the row's cols 351-372. */
  eyebrowStar: 11,
  rowStar: 12,
  /** REFINE-986, a row: the rule (row 891) to the value's cap (926) 17.5 pt; the strip on rows 976-999. */
  rowTop: 10,
  stripTop: 6,
  /** Strip to the comment's ink (999 to 1017) 9 pt; comment ink to the next rule (1050 to 1072) 11 pt; a row with no
   *  comment keeps 13.5 pt from its dot to the rule (1179 to 1206). */
  stripBottom: 3,
  commentTop: 3,
  rowBottom: 10,
  /** The value's end (col 337) to the star (col 351): 7 pt, the star's own 1.5 pt inset included. */
  starGap: 6,
} as const;

function SinceLine({ since, sc }: { since: SinceWeek1; sc: SemanticTokens }) {
  const r = C2.end / 2;
  const { weights } = since;
  const lo = Math.min(...weights);
  const hi = Math.max(...weights);
  const pts = weights.map((w, k) => ({
    x: r + (weights.length > 1 ? (k / (weights.length - 1)) * C2.lineWidth : C2.lineWidth),
    y: r + (hi > lo ? (1 - (w - lo) / (hi - lo)) * C2.lineHeight : C2.lineHeight / 2),
  }));
  const end = pts[pts.length - 1];
  return (
    <View
      style={{ width: C2.lineWidth + C2.end, height: C2.lineHeight + C2.end, marginTop: C2.lineTop }}
      accessible accessibilityRole="image"
      accessibilityLabel={`Top set, week 1 to today: ${since.from} to ${since.to} lb`}
      testID="exercise-history-since-line"
    >
      <Svg width={C2.lineWidth + C2.end} height={C2.lineHeight + C2.end}>
        <Polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={sc.data.moss}
          strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />
      </Svg>
      <View
        testID="exercise-history-since-end"
        style={[
          { position: 'absolute', left: end.x - r, top: end.y - r, width: C2.end, height: C2.end, borderRadius: r },
          since.endIsBest
            ? { backgroundColor: sc.data.peak, borderWidth: 1, borderColor: sc.data.peakInk }
            : { backgroundColor: sc.data.moss },
        ]}
      />
    </View>
  );
}

export function ExerciseHistoryStyleC({ history, bodyWeight }: { history: ExerciseHistory; bodyWeight: boolean }) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const italic = useCoachItalic();
  const best = history.best?.top_set ? history.best : null;
  if (!best || history.sessions.length === 0) return null;
  const top = best.top_set as TopSet;
  const star = starRow(history);
  const since = sinceWeek1(history);
  const spots = stripSpots(history.sessions);

  return (
    <View style={s.section} testID="exercise-history">
      <View style={s.tiles} testID="exercise-history-tiles">
        <View style={[s.tile, { backgroundColor: sc.surface.masthead }]} testID="exercise-history-best">
          <View style={s.eyebrowRow}>
            <PeakStar size={C2.eyebrowStar} onDark />
            <Text style={[s.eyebrow, { color: sc.data.peak }]}>Best ever</Text>
          </View>
          <Text style={[s.tileNumber, { color: sc.textOnAccent }]} accessibilityLabel={spokenSet(top, bodyWeight)}>
            {setText(top, bodyWeight)}
          </Text>
          <Text style={[s.small, { color: sc.textOnMastheadMuted }]} accessibilityLabel={dayLabel(best.date, true)}>
            {dayLabel(best.date)}
          </Text>
        </View>
        {since ? (
          <View style={[s.tile, { backgroundColor: sc.surface.sage }]} testID="exercise-history-since">
            {/* "week 1" never splits at 130% on a 150 pt tile (it wraps as SINCE / WEEK 1). */}
            <Text style={[s.eyebrow, { color: sc.textMuted }]}>{'Since week\u00a01'}</Text>
            {/* "+20 lb" in the drawing's forest (rows 645-680; LO-986R1 C1): the data forest, green in dark too. */}
            <Text style={[s.tileNumber, { color: sc.data.forest }]}>{changeText(since.change)}</Text>
            <SinceLine since={since} sc={sc} />
            <Text style={[s.small, s.caption, { color: sc.textMuted }]}>on your top set</Text>
          </View>
        ) : (
          <View style={s.half} />
        )}
      </View>

      <Text style={[sectionHead(sc), s.head]}>Your history</Text>
      {history.sessions.map((row, i) => {
        const spot = spots[i];
        const isStar = i === star;
        return (
          <View key={`${row.workout_id}-${i}`} style={[s.row, i > 0 && s.rowRule]} testID={`exercise-history-row-${i}`}>
            <Text style={s.date} accessibilityLabel={dayLabel(row.date, true)}>{dayLabel(row.date)}</Text>
            <View style={s.middle}>
              <View style={s.valueLine} testID={`exercise-history-value-${i}`}>
                {row.top_set ? (
                  <Text style={s.value} accessibilityLabel={spokenSet(row.top_set, bodyWeight)}>
                    {rowSetText(row.top_set, bodyWeight)}
                  </Text>
                ) : null}
                {isStar ? <PeakStar size={C2.rowStar} label="Best ever" testID="exercise-history-star" /> : null}
              </View>
              <View
                style={s.strip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                testID={`exercise-history-strip-${i}`}
              >
                <View style={s.track} testID={`exercise-history-track-${i}`} />
                {spot === null ? null : (
                  <View
                    testID={`exercise-history-dot-${i}`}
                    style={[isStar ? s.bestDot : s.dot, { left: `${spot * 100}%` as `${number}%` }]}
                  />
                )}
              </View>
              {(row.coach_comments ?? []).map((c, k) => (
                <Text key={k} style={[s.comment, k > 0 && s.commentNext, italic]}>{`${c.coach_name}: ${c.body}`}</Text>
              ))}
            </View>
            <Text style={[s.small, s.sets]}>{`${row.sets} ${row.sets === 1 ? 'set' : 'sets'}`}</Text>
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(sc: SemanticTokens) {
  // "Oct 13" in the tile (rows 705-721), "on your top set" and "3 sets" (rows 921-937): Inter at 12 pt.
  const small: TextStyle = { ...typography.bodySmall, fontSize: 12, lineHeight: 18 };
  return StyleSheet.create({
    // The demonstration follows 12 pt under the last row, as it follows the meta line on main.
    section: { marginBottom: spacing.md },
    // Rows 574-831: two tiles, 12 pt apart; they wrap to one per line when either would fall under 150 pt.
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: C2.tilesTop },
    tile: {
      flexGrow: 1, flexBasis: 0, minWidth: C2.tileMin, borderRadius: radius.card, paddingHorizontal: spacing.lg,
      paddingVertical: C2.tilePadY,
    },
    // With no Since week 1 tile, Best ever keeps its half and the right half stays empty (the same padding, so the
    // two halves grow from the same base).
    half: { flexGrow: 1, flexBasis: 0, paddingHorizontal: spacing.lg, paddingVertical: C2.tilePadY },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    eyebrow: { ...typography.eyebrow },
    // Rows 606-798 of the Since tile: eyebrow, number, line and caption close up to the drawn 129 pt tile.
    tileNumber: { ...typography.h2, marginTop: spacing.xs },
    small,
    caption: { marginTop: spacing.xs },
    // "YOUR HISTORY" (rows 868-891): the imported head with this head's drawn gaps (REFINE-986, H-4): 18.5 pt under
    // the tiles (831 to 868) and its rule 3.5 pt under the eyebrow (883 to 890); the first row starts at the rule.
    // MUSCLES, EQUIPMENT and HOW TO keep sectionHead as main draws them.
    head: { marginTop: spacing.lg, paddingBottom: 0, marginBottom: 0 },
    // A row: date | value, strip and comments | sets; a hairline between rows (rows 1072, 1206, 1428).
    row: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: C2.rowTop, paddingBottom: C2.rowBottom },
    rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
    date: { ...typography.bodySmall, color: sc.textMuted, width: C2.dateWidth, marginRight: spacing.lg },
    middle: { flex: 1 },
    valueLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: C2.starGap },
    // "155 × 6 lb" (cols 193-337): Inter Medium 16 with the drawing's proportional figures.
    value: { ...typography.bodyMd, color: sc.textPrimary },
    strip: { height: C2.bestDot, marginTop: C2.stripTop, marginBottom: C2.stripBottom, justifyContent: 'center' },
    track: { height: C2.track, borderRadius: C2.track / 2, backgroundColor: sc.data.trackLight },
    dot: {
      position: 'absolute', top: (C2.bestDot - C2.dot) / 2, width: C2.dot, height: C2.dot, borderRadius: C2.dot / 2,
      marginLeft: -C2.dot / 2, backgroundColor: sc.data.moss,
    },
    bestDot: {
      position: 'absolute', top: 0, width: C2.bestDot, height: C2.bestDot, borderRadius: C2.bestDot / 2,
      marginLeft: -C2.bestDot / 2, backgroundColor: sc.data.peak, borderWidth: 1, borderColor: sc.data.peakInk,
    },
    // Rows 1017-1050: the coach's words in Cormorant italic (useCoachItalic; the roman serif until it loads), 16 on 20.
    comment: { ...typography.h2, fontSize: 16, lineHeight: 20, letterSpacing: 0, color: sc.textPrimary, marginTop: C2.commentTop },
    // A second comment on one session (no drawing shows two) keeps R1's 8 pt.
    commentNext: { marginTop: spacing.sm },
    sets: { color: sc.textMuted, marginLeft: spacing.md, textAlign: 'right' },
  });
}
