/**
 * The week block in the "Your path" masthead (style A frames 02, 13): "Week {n} with {coach}" and three tiles, the
 * daily target (with "Changed {weekday}" when it changed this week), workouts this week and the last check-in. After a
 * question the masthead folds to two chips (frame 03, CP-A-13). Missing data reads "—", never a made-up number.
 * Three tiles across at normal text (also at 360 wide); two plus one from 120% text, as frame 02 at 130% draws them; only
 * very large text on a narrow phone stacks them as full-width rows, so no value is cut (Sol B-851-G1).
 */
import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius } from '../../../theme/tokens';
import type { CopilotWeek } from '../../../api/copilotApi';
import { ASK_COPY as A, dayMonth, targetChangedOn } from './askWords';
import { ledger, ledgerType } from './ledger';

export function WeekBlock({ week, compact, now }: { week: CopilotWeek; compact: boolean; now?: Date }) {
  const { semanticColors: sc } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stack = fontScale >= 1.2 && width / fontScale < 200;
  const half = fontScale >= 1.2 && !stack;
  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  const kcal = week.target ? Math.round(week.target.kcal).toLocaleString('en-US') : null;
  const { done, total } = week.workouts;

  if (compact) {
    const chips = [kcal ? A.targetChip(kcal) : null, total > 0 ? A.workoutsChip(done, total) : null].filter((c): c is string => !!c);
    return chips.length ? (
      <View style={s.row} testID="copilot-week-chips">
        {chips.map((c) => (
          <View key={c} style={[s.chip, { backgroundColor: ledger.mini }]}>
            <Text style={[ledgerType.mini, light]}>{c}</Text>
          </View>
        ))}
      </View>
    ) : null;
  }

  const changed = targetChangedOn(week.target, now);
  const tiles = [
    { key: 'target', value: kcal ?? A.none, label: A.target, chip: changed ? A.changed(changed) : null },
    { key: 'workouts', value: total > 0 ? A.of(done, total) : A.none, label: A.workouts, chip: null },
    { key: 'checkin', value: week.lastCheckIn ? dayMonth(week.lastCheckIn) : A.none, label: A.checkIn, chip: null },
  ];
  return (
    <View style={s.wrap} testID="copilot-week">
      {week.number && week.coach ? <Text style={[ledgerType.sub, muted]}>{A.week(week.number, week.coach)}</Text> : null}
      <View style={s.tiles}>
        {tiles.map((t) => (
          <View key={t.key} style={[s.tile, half && s.half, stack && s.stacked, { backgroundColor: ledger.tile, borderColor: ledger.tileLine }]}
            accessible accessibilityLabel={[t.label, t.value === A.none ? 'none yet' : t.value, t.chip].filter(Boolean).join('. ')}
            testID={`copilot-week-${t.key}`}>
            <Text style={[ledgerType.stat, light]} numberOfLines={stack ? undefined : 1} adjustsFontSizeToFit={!stack} minimumFontScale={0.8}>{t.value}</Text>
            <Text style={[ledgerType.statLabel, s.label, stack && s.grow, muted]} testID={`copilot-week-${t.key}-label`}>{t.label}</Text>
            {t.chip ? (
              <View style={[s.changed, { backgroundColor: ledger.changed }]} testID="copilot-week-changed">
                <Text style={[ledgerType.changed, { color: ledger.changedInk }]} numberOfLines={1}>{t.chip}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Style A's week (.mh .sub, .stats, .stat, .chg, .mhs .mini; Opus B-878-G2): tiles padded 12/10/11 so three fit
  // on one line each at 360 wide; the changed chip never wraps.
  wrap: { gap: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tile: { flex: 1, minWidth: 96, borderWidth: 1, borderRadius: radius.card, paddingTop: 12, paddingHorizontal: 10, paddingBottom: 11 },
  half: { flexGrow: 0, flexShrink: 0, flexBasis: '48%' },
  stacked: { flexBasis: '100%', minHeight: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, paddingVertical: 10 },
  grow: { flex: 1, minWidth: 120 },
  label: { marginTop: 4 },
  changed: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
});
