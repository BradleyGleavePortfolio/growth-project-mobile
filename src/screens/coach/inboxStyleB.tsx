/**
 * K2 Style B parts for the coach Messages tab and Roman's drafts (owner #196-D10: "BUILD THE PICKED STYLES AND
 * SCREENS"; drawing planning/MOCKUP3/K2/style-b). Colours come from `coachInboxB` in theme/tokens.
 *
 * Words: only words in the app today or owner-approved. The drawn parts that need new server data (Needs you order,
 * wait times, Draft ready, safety rows) or new words are not here; they are listed in the PR split plan.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { coachInboxB as B, radius } from '../../theme/tokens';
import { usePendingAiDrafts } from '../../hooks/usePendingAiDrafts';
import { isStream2Capability, type AiActionDraftRow } from '../../api/types/coachAiExecution';
import RomanAvatar from '../../components/roman/RomanAvatar';

const SERIF = 'CormorantGaramond_400Regular';

/** Roles that see Roman's drafts (the gateway's @Roles('coach', 'owner')). */
export const canSeeDrafts = (role?: string | null): boolean => role === 'coach' || role === 'owner';

export function initialsOf(name: string): string {
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

export interface DraftKindCount { count: number; label: string }
/** Stream 2 drafts by kind, as the coach Home counts them; kinds with none are left out. */
export function draftKinds(rows: AiActionDraftRow[]): { total: number; kinds: DraftKindCount[] } {
  const queue = rows.filter((d) => isStream2Capability(d.capability));
  const n = (cap: string) => queue.filter((d) => d.capability === cap).length;
  const kinds = ([
    [n('draft.assign_workout'), 'Workout', 'Workouts'],
    [n('draft.assign_meal_plan'), 'Meal plan', 'Meal plans'],
    [n('draft.send_notification'), 'Nudge', 'Nudges'],
  ] as const)
    .filter(([c]) => c > 0)
    .map(([c, one, many]) => ({ count: c, label: c === 1 ? one : many }));
  return { total: queue.length, kinds };
}

/** Roman's drafts the coach sees (the one visible-drafts rule in usePendingAiDrafts), by kind. */
export function useRomanDrafts(enabled: boolean): { total: number; kinds: DraftKindCount[] } {
  return draftKinds(usePendingAiDrafts({ enabled }).data?.drafts ?? []);
}

/** The drawn forest card: shown only while Stream 2 drafts wait; opens the Pending AI drafts screen. */
export function RomanDraftsHero(): React.ReactElement | null {
  const isFocused = useIsFocused();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { total: n, kinds } = useRomanDrafts(isFocused);
  // A narrow phone with large text (320 pt at 130%) keeps the portrait above, so the headline has the card's width.
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / Math.max(fontScale, 1) < 260;
  if (n === 0) return null;
  return (
    <View style={s.hero} testID="inbox-roman-drafts">
      {/* LS-952 C1: the portrait sits beside the headline, as the drawing's portrait row does, so the card stays compact */}
      <View style={[s.heroTop, stacked && s.heroTopStacked]}>
        <View style={s.ring}><RomanAvatar crop="neutral" size={44} /></View>
        <Text style={s.heroTitle} maxFontSizeMultiplier={1.3}>{`Roman has ${n} ${n === 1 ? 'draft' : 'drafts'} ready`}</Text>
      </View>
      <View style={s.heroChips}>
        {kinds.map((k) => (
          <View key={k.label} style={s.heroChip}>
            <Text style={s.heroChipText}>{`${k.count} ${k.label}`}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={() => navigation.navigate('ClientsStack', { screen: 'PendingAiDrafts', initial: false })}
        accessibilityRole="button"
        accessibilityLabel={`Approve Roman's drafts, ${n}`}
        testID="inbox-drafts-open"
        style={({ pressed }) => [s.heroBtn, pressed && s.pressed]}
      >
        <Text style={s.heroBtnText} numberOfLines={2} maxFontSizeMultiplier={1.3}>{"Approve Roman's drafts\u00a0→"}</Text>
      </Pressable>
    </View>
  );
}

export interface InboxTileProps {
  name: string;
  preview: string;
  time?: string;
  unread?: number;
  pinned?: boolean;
  muted?: boolean;
  italic?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
}

/** One conversation: cream tile, forest monogram, name and time, two-line preview, unread count pill. */
export function InboxTile(p: InboxTileProps): React.ReactElement {
  const unread = p.unread ?? 0;
  return (
    <Pressable
      style={({ pressed }) => [s.tile, pressed && s.pressed]}
      onPress={p.onPress}
      onLongPress={p.onLongPress}
      delayLongPress={p.onLongPress ? 350 : undefined}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      accessibilityHint={p.accessibilityHint}
      testID={p.testID}
    >
      <View style={s.mono}><Text style={s.monoText} maxFontSizeMultiplier={1.2}>{initialsOf(p.name)}</Text></View>
      <View style={s.tileBody}>
        <View style={s.topLine}>
          <Text style={s.name} numberOfLines={2}>{p.name}</Text>
          {p.pinned ? <Ionicons name="pin" size={14} color={B.muted} accessibilityLabel="Pinned" /> : null}
          {p.muted ? <Ionicons name="notifications-off-outline" size={14} color={B.muted} accessibilityLabel="Muted" /> : null}
          {p.time ? <Text style={s.time}>{p.time}</Text> : null}
        </View>
        <Text style={[s.preview, p.italic && s.italic]} numberOfLines={2}>{p.preview}</Text>
        {unread > 0 ? (
          <View style={s.pill}>
            <Text style={[s.pillText, p.muted && s.pillTextMuted]}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The drawn loading state: plain shapes, no words (Roman's card shape only for a coach who sees drafts). */
export function InboxSkeleton({ rows = 5, hero = false }: { rows?: number; hero?: boolean }): React.ReactElement {
  return (
    <View testID="inbox-loading" accessibilityLabel="Loading" accessible>
      {hero ? <View style={s.ghostHero} /> : null}
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={s.ghostTile} />
      ))}
    </View>
  );
}

/** Shared page styles for the two inbox screens (each screen keeps its own search field: memberContentAccess EXEMPT rows). */
export const inboxB = StyleSheet.create({
  page: { backgroundColor: B.page },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  headerEntries: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { fontFamily: SERIF, fontSize: 34, lineHeight: 43, fontWeight: '400', color: B.ink },
  summary: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, color: B.muted, marginTop: 2 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: radius.chip, borderWidth: 1, borderColor: B.line, backgroundColor: B.chip },
  chipOn: { backgroundColor: B.deep, borderColor: B.deep },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, fontWeight: '600', color: B.body },
  chipTextOn: { color: B.onDeep },
  errorCard: { backgroundColor: B.tile, borderRadius: radius.card, padding: 20, gap: 8 },
  errorTitle: { fontFamily: SERIF, fontSize: 24, lineHeight: 31, color: B.ink },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, color: B.body },
  retry: { marginTop: 8, minHeight: 48, borderRadius: radius.button, borderWidth: 1.5, borderColor: B.deep, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, fontWeight: '600', color: B.deep },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, backgroundColor: B.chip, borderRadius: radius.input, borderWidth: 1, borderColor: B.line, paddingHorizontal: 14 },
  searchOn: { borderColor: B.deep, borderWidth: 1.5 },
  // LS-952 C2: minWidth 0 lets the field give way to the clear control (a web input keeps its own width otherwise)
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, fontFamily: 'Inter_400Regular', fontSize: 16, color: B.ink, paddingVertical: 10 },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  allRead: { backgroundColor: B.tile, borderRadius: radius.card, padding: 20, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, color: B.body },
});

const s = StyleSheet.create({
  pressed: { opacity: 0.85 },
  hero: { backgroundColor: B.deep, borderRadius: radius.sheet, padding: 20, gap: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroTopStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  ring: { flexShrink: 0, borderWidth: 2, borderColor: B.goldEdge, borderRadius: radius.chip, padding: 2 },
  heroTitle: { flexShrink: 1, fontFamily: SERIF, fontSize: 30, lineHeight: 38, fontWeight: '400', fontVariant: ['lining-nums'], color: B.onDeep },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroChip: { borderRadius: radius.chip, borderWidth: 1, borderColor: B.onDeepMuted, paddingHorizontal: 12, paddingVertical: 6 },
  heroChipText: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 20, color: B.onDeep },
  heroBtn: { minHeight: 52, borderRadius: radius.button, backgroundColor: B.onDeep, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  heroBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 17, lineHeight: 22, fontWeight: '600', color: B.deep, textAlign: 'center' },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: B.tile, borderRadius: radius.card, paddingVertical: 16, paddingHorizontal: 14, marginBottom: 10 },
  ghostTile: { height: 72, borderRadius: radius.card, backgroundColor: B.ghost, marginBottom: 10 },
  ghostHero: { height: 200, borderRadius: radius.sheet, backgroundColor: B.ghostHero, marginBottom: 10 },
  mono: { width: 36, height: 36, borderRadius: radius.chip, backgroundColor: B.deep, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontFamily: SERIF, fontSize: 16, lineHeight: 20, color: B.onDeep },
  tileBody: { flex: 1, gap: 4 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: 'Inter_600SemiBold', fontSize: 17, lineHeight: 22, fontWeight: '600', color: B.ink },
  time: { marginLeft: 'auto', flexShrink: 0, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 19, color: B.muted },
  preview: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, color: B.body },
  italic: { fontStyle: 'italic' },
  pill: { alignSelf: 'flex-start', marginTop: 4, minWidth: 32, borderRadius: radius.chip, backgroundColor: B.chip, paddingHorizontal: 12, paddingVertical: 4, alignItems: 'center' },
  pillText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19, fontWeight: '600', color: B.deep },
  pillTextMuted: { color: B.muted },
});
