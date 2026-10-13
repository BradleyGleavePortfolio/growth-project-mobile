/**
 * UI-2 second PR (V1_1_UI_SPEC UI-2, owner 10-09 "render 2"): the filter chips and the Steady wall with its
 * legend, to the mockup in tgp-agent-context planning/v1_1_ui/ui-2-coach-home. Theme colours, type and radius
 * tokens only.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, layout, radius, typography } from '../../../theme/tokens';
import { QuietOverline } from '../../../ui';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { Monogram } from './HomeParts';
import type { FilterChip, RosterFilter, WallMember } from './rosterWall';

const COLS = 6;
const COL_GAP = 4;
const RING = 48;
const FACE = 40;
/** Four rows; past that the last place says how many more and opens Clients. */
export const WALL_MAX = 24;

/**
 * The chip row: one selected (forest), each with its count; a tap switches what the roster section shows. A lone
 * chip has nothing to switch to, so it is the same pill as a heading, never a button that does nothing.
 */
export function FilterChips({ chips, selected, onSelect }: {
  chips: FilterChip[]; selected: RosterFilter | null; onSelect?: (key: RosterFilter) => void;
}) {
  const { semanticColors: sc } = useTheme();
  const pick = chips.length > 1 ? onSelect : undefined;
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}
      testID="coach-home-v11-chips"
    >
      {chips.map((c) => {
        const on = c.key === selected;
        const look = [styles.chip, on ? { backgroundColor: sc.accent, borderColor: sc.accent } : { backgroundColor: sc.bgSurface, borderColor: sc.border }];
        const words = (
          <>
            <Text style={[styles.chipText, { color: on ? sc.textOnAccent : sc.textPrimary }]} maxFontSizeMultiplier={1.3}>{c.label}</Text>
            <Text style={[styles.chipText, on ? [styles.onCount, { color: sc.textOnAccent }] : { color: sc.textMuted }]} maxFontSizeMultiplier={1.3}>{c.count}</Text>
          </>
        );
        return pick ? (
          <Pressable
            key={c.key}
            onPress={() => { if (on) return; void HapticService.selection(); pick(c.key); }}
            accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${c.label}, ${c.count}`}
            hitSlop={{ top: 4, bottom: 4 }} testID={`coach-home-v11-chip-${c.key}`} style={look}
          >
            {words}
          </Pressable>
        ) : (
          <View key={c.key} accessible accessibilityRole="header" accessibilityLabel={`${c.label}, ${c.count}`} testID={`coach-home-v11-chip-${c.key}`} style={look}>
            {words}
          </View>
        );
      })}
    </ScrollView>
  );
}

function WallFace({ member, width, onPress }: { member: WallMember; width: number; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  const ringColor = member.ring === 'logged' ? sc.accent : member.ring === 'notYet' ? sc.border : 'transparent';
  const state = member.ring === 'logged' ? 'Logged today' : member.ring === 'notYet' ? 'Not yet today' : null;
  return (
    <Pressable
      onPress={() => { void HapticService.softImpact(); onPress(); }}
      accessibilityRole="button" accessibilityLabel={[member.name, state].filter(Boolean).join('. ')}
      testID={`coach-home-v11-wall-${member.id}`} style={({ pressed }) => [styles.cell, { width }, pressed && styles.pressed]}
    >
      <View style={[styles.ring, { borderColor: ringColor }]} testID={`coach-home-v11-wall-${member.id}-${member.ring}`}>
        <Monogram name={member.name} size={FACE} bordered={member.ring === 'unknown'} />
      </View>
      <Text style={[styles.first, { color: sc.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{member.label}</Text>
    </Pressable>
  );
}

/**
 * "Steady, {n}" and how many logged today, a six-across wall of the steady clients (forest ring: logged today;
 * hairline ring: not yet; no ring when the client shares no logs), and the legend. Each face opens that client.
 */
export function SteadyWall({ members, width, total, flushTop, onSelect, onOpenClients }: {
  members: WallMember[]; width: number; total: number; flushTop?: boolean;
  onSelect: (id: string, name: string) => void; onOpenClients: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const known = members.some((m) => m.ring !== 'unknown');
  const logged = members.filter((m) => m.ring === 'logged').length;
  const shown = members.length > WALL_MAX ? members.slice(0, WALL_MAX - 1) : members;
  const more = members.length - shown.length;
  const cell = (width - (COLS - 1) * COL_GAP) / COLS;
  return (
    <View style={flushTop ? styles.wallFlush : styles.wall} testID="coach-home-v11-wall">
      <View style={styles.head}>
        <QuietOverline style={styles.flat} accessibilityRole="header">{`Steady, ${members.length}`}</QuietOverline>
        {known ? <Text style={[styles.note, { color: sc.textMuted }]} maxFontSizeMultiplier={1.3}>{`${logged} logged today`}</Text> : null}
      </View>
      <View style={styles.grid}>
        {shown.map((m) => <WallFace key={m.id} member={m} width={cell} onPress={() => onSelect(m.id, m.name)} />)}
        {more > 0 ? (
          <Pressable
            onPress={() => { void HapticService.softImpact(); onOpenClients(); }}
            accessibilityRole="button" accessibilityLabel={`All ${total} clients. Open Clients`} testID="coach-home-v11-wall-more"
            style={({ pressed }) => [styles.cell, { width: cell }, pressed && styles.pressed]}
          >
            <View style={[styles.ring, styles.more, { borderColor: sc.border }]}>
              <Text style={[styles.moreText, { color: sc.textPrimary }]} maxFontSizeMultiplier={1.2}>{`+${more}`}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {known ? (
        <View style={styles.legend} testID="coach-home-v11-wall-legend">
          <View style={styles.key}><View style={[styles.swatch, { borderColor: sc.accent }]} /><Text style={[styles.note, { color: sc.textMuted }]}>Logged today</Text></View>
          <View style={styles.key}><View style={[styles.swatch, { borderColor: sc.border }]} /><Text style={[styles.note, { color: sc.textMuted }]}>Not yet today</Text></View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipScroll: { marginHorizontal: -layout.gutter, flexGrow: 0 },
  chipRow: { paddingHorizontal: layout.gutter, gap: 8 },
  chip: { minHeight: 36, borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 18 },
  // The mockup's count on the selected chip: bone at 82%.
  onCount: { opacity: 0.82 },
  wall: { marginTop: 28 },
  wallFlush: { marginTop: 14 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 12 },
  flat: { marginBottom: 0 },
  note: { ...typography.bodySmall, fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: COL_GAP, rowGap: 16, marginTop: 14 },
  cell: { alignItems: 'center', minHeight: 44 },
  ring: { width: RING, height: RING, borderRadius: radius.chip, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  more: { backgroundColor: colors.cream },
  moreText: { ...typography.caption, fontSize: 13, lineHeight: 16, letterSpacing: 0 },
  first: { ...typography.caption, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16, letterSpacing: 0, marginTop: 4, maxWidth: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 14 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: radius.chip, borderWidth: 3 },
  pressed: { opacity: 0.6 },
});
