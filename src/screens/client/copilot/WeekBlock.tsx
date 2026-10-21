/**
 * The week block in the "Your path" masthead (style A frames 02, 13): "Week {n} with {coach}" and three tiles, the
 * daily target (with "Changed {weekday}" when it changed this week), workouts this week and the last check-in. After a
 * question the masthead folds to two chips (frame 03, CP-A-13). Missing data reads "—", never a made-up number.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, radius, typography } from '../../../theme/tokens';
import type { CopilotWeek } from '../../../api/copilotApi';
import { ASK_COPY as A, changedThisWeek, dayMonth } from './askWords';

export function WeekBlock({ week, compact, now }: { week: CopilotWeek; compact: boolean; now?: Date }) {
  const { semanticColors: sc } = useTheme();
  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  const kcal = week.target ? Math.round(week.target.kcal).toLocaleString('en-US') : null;
  const { done, total } = week.workouts;

  if (compact) {
    const chips = [kcal ? A.targetChip(kcal) : null, total > 0 ? A.workoutsChip(done, total) : null].filter((c): c is string => !!c);
    return chips.length ? (
      <View style={s.row} testID="copilot-week-chips">
        {chips.map((c) => (
          <View key={c} style={[s.chip, { backgroundColor: sc.surface.forestBand }]}>
            <Text style={[typography.bodySmall, light]}>{c}</Text>
          </View>
        ))}
      </View>
    ) : null;
  }

  const changed = week.target ? changedThisWeek(week.target.from, now) : null;
  const tiles = [
    { key: 'target', value: kcal ?? A.none, label: A.target, chip: changed ? A.changed(changed) : null },
    { key: 'workouts', value: total > 0 ? A.of(done, total) : A.none, label: A.workouts, chip: null },
    { key: 'checkin', value: week.lastCheckIn ? dayMonth(week.lastCheckIn) : A.none, label: A.checkIn, chip: null },
  ];
  return (
    <View style={s.wrap} testID="copilot-week">
      {week.number && week.coach ? <Text style={[typography.bodySmall, muted]}>{A.week(week.number, week.coach)}</Text> : null}
      <View style={s.row}>
        {tiles.map((t) => (
          <View key={t.key} style={[s.tile, { backgroundColor: sc.surface.forestBand, borderColor: sc.data.frameOnDark }]}
            accessible accessibilityLabel={[t.label, t.value === A.none ? 'none yet' : t.value, t.chip].filter(Boolean).join('. ')}
            testID={`copilot-week-${t.key}`}>
            <Text style={[s.value, light]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t.value}</Text>
            <Text style={[typography.bodySmall, s.label, muted]}>{t.label}</Text>
            {t.chip ? (
              <View style={[s.changed, { backgroundColor: forestPop.leaf }]}>
                <Text style={[typography.micro, { color: forestPop.deep }]}>{t.chip}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: radius.button, paddingHorizontal: 10, paddingVertical: 4 },
  tile: { flex: 1, minWidth: 96, minHeight: 104, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: 12, gap: 4 },
  value: { ...typography.h4, fontFamily: 'Inter_600SemiBold', fontSize: 22, lineHeight: 28, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 17 },
  changed: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
});
