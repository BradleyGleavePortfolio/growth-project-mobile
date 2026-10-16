/**
 * K1-OVERVIEW — the client file in Style C (planning/MOCKUP3/K1, owner pick "K1 - STYLE C"), behind
 * featureFlags.coachTabsV2: a deep-forest masthead (radius 24 at the bottom) with the name, the week ring and
 * day strip (StyleCMarks, onDark) and light text tabs with a leaf underline, pinned while the file scrolls.
 * A switch the client keeps off reads "Not shared by {first}" with a lock and is not a button.
 */
import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, layout, radius, typography } from '../../../theme/tokens';
import { DayMark, SegmentedRing } from '../../../ui/charts/StyleCMarks';
import { DAY_LABELS } from '../../client/habits/constants';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { checkInLine, dayLabel, doneLine, foodLine, toGoLine, weekHeadline, workoutsLine, type WorkoutWeek } from './thisWeek';
import type { ThisWeekRead } from './useThisWeek';
import type { TabKey } from './types';

const CAP = 1.3;
export const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The masthead above the tabs: Back, More, the name and, when known, the week. `onMore` is absent while the
 * archive status is unknown (never a dead button); `drawKey` draws the ring once per client per week;
 * `rounded`: no tabs below (loading, error), so the masthead rounds its own bottom.
 */
export function FileHead({ name, onBack, onMore, week, drawKey, rounded }: {
  name: string; onBack: () => void; onMore?: () => void; week?: WorkoutWeek | null; drawKey?: string; rounded?: boolean;
}) {
  const sc = useTheme().semanticColors;
  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  const lastDone = week ? week.segments.lastIndexOf('done') : -1;
  return (
    <View style={[s.head, rounded && s.rounded, { backgroundColor: sc.surface.masthead }]} testID="file-masthead">
      <View style={s.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={s.icon} testID="file-back">
          <Ionicons name="chevron-back" size={26} color={sc.textOnAccent} />
        </Pressable>
        {onMore ? (
          <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel="More" style={s.icon} testID="file-more">
            <Ionicons name="ellipsis-horizontal" size={24} color={sc.textOnAccent} />
          </Pressable>
        ) : null}
      </View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} numberOfLines={2} style={[typography.h1, light]}>{name}</Text>
      {week && week.total > 0 ? (
        <View testID="file-week">
          <View style={s.weekRow}>
            <SegmentedRing
              onDark size={104} segments={week.segments} label={doneLine(week)} testID="file-week-ring"
              drawIndex={lastDone >= 0 ? lastDone : undefined} event={drawKey}
            >
              <Text maxFontSizeMultiplier={1.15} style={[typography.h2, light]}>{`${week.done} of ${week.total}`}</Text>
              <Text maxFontSizeMultiplier={1.15} style={[typography.eyebrow, muted]}>done</Text>
            </SegmentedRing>
            <View style={s.weekWords}>
              <Text maxFontSizeMultiplier={CAP} style={[typography.eyebrow, muted]}>This week · Workouts</Text>
              <Text maxFontSizeMultiplier={CAP} style={[typography.h1, light]}>{weekHeadline(week)}</Text>
              {toGoLine(week) ? <Text maxFontSizeMultiplier={CAP} style={[typography.body, muted]}>{toGoLine(week)}</Text> : null}
            </View>
          </View>
          <View style={s.strip}>
            {week.days.map((state, d) => (
              <View key={d} style={s.day}>
                <Text maxFontSizeMultiplier={CAP} style={[typography.caption, muted]} importantForAccessibility="no" aria-hidden>{DAY_LABELS[d]}</Text>
                <DayMark onDark state={state} day={week.dates[d]} label={dayLabel(week, d)} testID={`file-day-${d}`} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** The light text tabs with a leaf underline, the bottom of the masthead. */
export function FileTabs({ tabs, active, onTab }: { tabs: { key: TabKey; label: string }[]; active: TabKey; onTab: (k: TabKey) => void }) {
  const sc = useTheme().semanticColors;
  return (
    <View style={[s.tabsWrap, { backgroundColor: sc.surface.masthead }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Pressable
              key={t.key} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: on }}
              style={s.tab} testID={`file-tab-${t.key}`}
              onPress={() => { if (!on) { HapticService.selection(); onTab(t.key); } }}
            >
              <Text maxFontSizeMultiplier={CAP} style={[typography.bodyMd, { color: on ? sc.textOnAccent : sc.textOnMastheadMuted }]}>{t.label}</Text>
              <View style={[s.underline, { backgroundColor: on ? sc.data.leaf : 'transparent' }]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** K1-S-118 and Try again (K1-S-119): a warm notice, read as an alert; one error haptic per failure. */
export function FileNotice({ first, onRetry }: { first: string; onRetry: () => void }) {
  const sc = useTheme().semanticColors;
  useEffect(() => { HapticService.error(); }, []);
  return (
    <View testID="file-error">
      <View accessibilityRole="alert" style={[s.notice, { backgroundColor: colors.warningBg, borderColor: sc.border }]}>
        <Ionicons name="alert-circle-outline" size={22} color={sc.textPrimary} />
        <Text maxFontSizeMultiplier={CAP} style={[typography.body, s.flex, { color: sc.textPrimary }]}>
          {`${first}'s file did not load. Check the connection and try again.`}
        </Text>
      </View>
      <Pressable onPress={onRetry} accessibilityRole="button" style={[s.retry, { borderColor: sc.accentText }]} testID="file-retry">
        <Text maxFontSizeMultiplier={CAP} style={[typography.bodyMd, { color: sc.accentText }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

/** Static card placeholders (no shimmer); a screen reader hears K1-S-115. */
export function FilePlaceholders({ first }: { first: string }) {
  const bg = { backgroundColor: useTheme().semanticColors.bgSurface };
  return (
    <View accessible accessibilityLabel={`Loading ${first}'s file`} testID="file-loading">
      {[0, 1, 2].map((i) => <View key={i} style={[s.card, s.placeholder, bg]} />)}
    </View>
  );
}

/** The one forest primary, pinned: "Message {first}" (K1-S-29, approved wording). */
export function MessageButton({ label, onPress, bottom }: { label: string; onPress: () => void; bottom: number }) {
  const sc = useTheme().semanticColors;
  return (
    <View style={[s.footer, { paddingBottom: bottom, backgroundColor: sc.bgPrimary }]}>
      <Pressable
        onPress={() => { HapticService.mediumImpact(); onPress(); }}
        accessibilityRole="button" style={[s.primary, { backgroundColor: sc.surface.forestBand }]} testID="file-message"
      >
        <Ionicons name="chatbox-outline" size={20} color={sc.textOnAccent} />
        <Text maxFontSizeMultiplier={CAP} numberOfLines={1} style={[typography.bodyMd, { color: sc.textOnAccent }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

export interface WeekCard { key: string; title: string; line?: string | null; shared: boolean; onPress: () => void }

/** One This week card: a button to its tab, or (not shared) a locked line that is not a button. */
export function FileCard({ card, first }: { card: WeekCard; first: string }) {
  const sc = useTheme().semanticColors;
  return (
    <Pressable
      onPress={card.shared ? () => { HapticService.selection(); card.onPress(); } : undefined}
      accessibilityRole={card.shared ? 'button' : undefined} style={[s.card, s.row, { backgroundColor: sc.bgSurface }]} testID={`file-card-${card.key}`}
    >
      <View style={s.flex}>
        <Text maxFontSizeMultiplier={CAP} style={[typography.h4, { color: sc.textPrimary }]}>{card.title}</Text>
        {card.shared ? (
          card.line ? <Text maxFontSizeMultiplier={CAP} style={[typography.bodySmall, { color: sc.textMuted }]}>{card.line}</Text> : null
        ) : (
          <View style={s.locked}>
            <Ionicons name="lock-closed-outline" size={16} color={sc.textMuted} />
            <Text maxFontSizeMultiplier={CAP} style={[typography.bodySmall, s.flex, { color: sc.textMuted }]}>{`Not shared by ${first}`}</Text>
          </View>
        )}
      </View>
      {card.shared ? <Ionicons name="chevron-forward" size={20} color={sc.textMuted} /> : null}
    </Pressable>
  );
}

/** The This week tab: Workouts, Food, Check-ins and Weigh-ins, each opening its tab. */
export function ThisWeekBody({ first, read, week, onOpen, onRetry }: {
  first: string; read: ThisWeekRead; week?: WorkoutWeek | null; onOpen: (tab: TabKey) => void; onRetry: () => void;
}) {
  const sc = useTheme().semanticColors;
  if (read.kind === 'loading') return <FilePlaceholders first={first} />;
  if (read.kind === 'error') return <FileNotice first={first} onRetry={onRetry} />;
  const { sharing } = read;
  const cards: WeekCard[] = [
    { key: 'workouts', title: 'Workouts', shared: sharing.workouts, line: week && week.total > 0 ? workoutsLine(week) : null, onPress: () => onOpen('workouts') },
    { key: 'food', title: 'Food', shared: sharing.food, line: foodLine(read.food, read.target), onPress: () => onOpen('logs') },
    { key: 'checkins', title: 'Check-ins', shared: sharing.checkIns, line: checkInLine(read.checkIns), onPress: () => onOpen('timeline') },
    { key: 'weighins', title: 'Weigh-ins', shared: sharing.weighIns, onPress: () => onOpen('progress') },
  ];
  return (
    <View testID="file-this-week">
      {cards.some((c) => !c.shared) ? (
        <Text maxFontSizeMultiplier={CAP} style={[typography.bodySmall, s.privacy, { color: sc.textMuted }]}>
          Clients choose what they share with you. Anything not shared stays private.
        </Text>
      ) : null}
      {cards.map((c) => <FileCard key={c.key} card={c} first={first} />)}
    </View>
  );
}

const s = StyleSheet.create({
  privacy: { marginTop: 16 },
  flex: { flex: 1 },
  head: { paddingHorizontal: layout.gutter, paddingTop: 4, paddingBottom: 8 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -10, marginBottom: 4 },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16 },
  weekWords: { flex: 1, gap: 2 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  day: { alignItems: 'center', gap: 6, minWidth: 40 },
  rounded: { borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, paddingBottom: 24 },
  tabsWrap: { borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, overflow: 'hidden' },
  tabs: { paddingHorizontal: layout.gutter, gap: 24 },
  tab: { minHeight: 48, minWidth: 44, justifyContent: 'center', paddingTop: 8 },
  underline: { height: 3, marginTop: 8, borderRadius: 2 },
  notice: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radius.card, borderWidth: 1, marginTop: 16 },
  retry: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center', paddingHorizontal: 20, borderRadius: radius.button, borderWidth: 1.5, marginTop: 12 },
  card: { borderRadius: radius.card, padding: 20, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  placeholder: { height: 88 },
  footer: { paddingHorizontal: layout.gutter, paddingTop: layout.footerTopGap },
  primary: {
    minHeight: layout.buttonHeight, borderRadius: radius.button, flexDirection: 'row', gap: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
});
