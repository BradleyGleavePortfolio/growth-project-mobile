/**
 * FR-871R7 (agent 180; m#871 Sol B871-1 / Opus B1): a member's Space info, from the (i) in the space chat header: what
 * the space is for and who is in it. The purpose is the space's description as its coach wrote it (SC-PURPOSE-BE,
 * backend#1178); none, no line. The people come from GET community/cohorts/:id/members (spaceMembers.ts), laid out after
 * mockup C6CHAT-S-V2 c07: Coach, Team (only when the space has one), then Members with the viewer first ("You"), each on
 * the space chat's tiles (the coach deep with a gold serif initial, members on the Studio greens, SpaceChatRow tileFor).
 * People are asked for only once the server let the viewer in on this visit (`people: 'open'`), so a page drawn from the
 * saved cache never lists them for someone who lost the space ('wait' shows the loading rows, or the connection line when
 * offline; 'closed' shows none). 'failed' (FR-897, m#897 LO-897 B1): the chat's own read failed without a refusal, so
 * the people cannot be asked for yet; the could-not-load line, and Try again reloads the chat (`onRetry`).
 * Loading and could-not-load come from src/ui (QuietLoading, QuietError with Try again); Show more asks for the next 50.
 * No coach controls here: the coach's space page has them. Look: the safety sheet's (white, radius.sheet top corners,
 * grab), 44 pt targets, small grey text in graphite (owner #168-13).
 */
import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuietOverline } from '../../../ui';
import { QuietError, QuietLoading, loadFailureMessage } from '../../../ui/states/QuietStates';
import HapticPressable from '../../HapticPressable';
import { CommunityApiError } from '../../../api/apiCall';
import { colors, forestPop as fp, neutral, radius, spacing, typography, withAlpha } from '../../../theme/tokens';
import { HashGlyph, SMALL_GREY, tileFor } from './SpaceChatRow';
import { useSpaceMembers, type SpaceMember } from './spaceMembers';

export type SpacePeopleAccess = 'wait' | 'open' | 'closed' | 'failed';

export interface SpaceInfoSheetProps {
  cohortId: string;
  name: string;
  /** "{n} members" (C6-S-10), as the header has it. */
  members: string;
  /** What the space is for; null or absent draws no purpose line. */
  description?: string | null;
  viewerId?: string | null;
  people: SpacePeopleAccess;
  /** 'failed': the chat read's error, and the page's reload with whether it is under way. */
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  offline: boolean;
  onClose: () => void;
}

/** The connection sentence of loadFailureMessage, for a sheet opened offline before any answer came back. */
const NO_CONNECTION = { isAxiosError: true };
const shown = (err: unknown, offline: boolean) => (offline || (err instanceof CommunityApiError && err.kind === 'network') ? NO_CONNECTION : err);

export default function SpaceInfoSheet(p: SpaceInfoSheetProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const purpose = p.description?.trim();
  return (
    <Modal transparent visible animationType="slide" statusBarTranslucent onRequestClose={p.onClose}>
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={p.onClose} accessibilityRole="button" accessibilityLabel="Close" testID="space-info-scrim" />
        <View style={[s.sheet, { maxHeight: height * 0.85, paddingBottom: insets.bottom + spacing.xl }]} accessibilityViewIsModal onAccessibilityEscape={p.onClose} testID="space-info-sheet">
          <View style={s.grab} />
          <View style={s.titleRow} accessible accessibilityRole="header">
            <HashGlyph color={SMALL_GREY} />
            <Text style={s.title} numberOfLines={2}>{p.name}</Text>
          </View>
          <Text style={s.sub}>{p.members}</Text>
          <ScrollView style={s.scroll} contentContainerStyle={s.body} showsVerticalScrollIndicator={false} testID="space-info-scroll">
            {purpose ? <Text style={s.purpose} testID="space-info-purpose">{purpose}</Text> : null}
            {p.people === 'failed' ? (
              <QuietError message={loadFailureMessage(shown(p.error, p.offline), 'People')} onRetry={p.onRetry} retrying={p.retrying}
                layout="inline" testID="space-info-people-failed" />
            ) : p.people === 'wait' && p.offline ? (
              // Offline on the saved page: the connection line, no button; the chat's own read lets the people in once back.
              <QuietError message={loadFailureMessage(NO_CONNECTION, 'People')} layout="inline" testID="space-info-people-offline" />
            ) : p.people === 'wait' ? <QuietLoading label="Loading people" rows={3} testID="space-info-people-loading" /> : null}
            {p.people === 'open' ? <People cohortId={p.cohortId} viewerId={p.viewerId} offline={p.offline} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function People({ cohortId, viewerId, offline }: { cohortId: string; viewerId?: string | null; offline: boolean }): React.ReactElement | null {
  const q = useSpaceMembers(cohortId, true);
  if (!q.data) {
    if (q.error) {
      // 403 / 404: the server no longer lets this viewer read the space (the page says so); the sheet lists no one.
      if (q.error instanceof CommunityApiError && (q.error.kind === 'forbidden' || q.error.status === 404)) return null;
      return (
        <QuietError message={loadFailureMessage(shown(q.error, offline), 'People')} onRetry={() => void q.refetch()} retrying={q.isFetching}
          layout="inline" testID="space-info-people-error" />
      );
    }
    return <QuietLoading label="Loading people" rows={3} testID="space-info-people-loading" />;
  }
  // A page can repeat someone if the space changed between two pages: each person shows once.
  const seen = new Set<string>();
  const all = q.data.pages.flatMap((pg) => pg.members).filter((m) => (seen.has(m.user_id) ? false : (seen.add(m.user_id), true)));
  const coach = all.filter((m) => m.role === 'coach');
  const team = all.filter((m) => m.role === 'co_coach');
  const rest = all.filter((m) => m.role !== 'coach' && m.role !== 'co_coach');
  const members = [...rest.filter((m) => m.user_id === viewerId), ...rest.filter((m) => m.user_id !== viewerId)];
  const alone = !q.hasNextPage && !all.some((m) => m.user_id !== viewerId);
  return (
    <View testID="space-info-people">
      <Group label="Coach" people={coach} viewerId={viewerId} />
      <Group label="Team" people={team} viewerId={viewerId} />
      <Group label="Members" people={members} viewerId={viewerId} />
      {alone ? <Text style={s.alone} testID="space-info-alone">No one else is here yet.</Text> : null}
      {q.hasNextPage && q.isFetchNextPageError ? (
        <QuietError message={loadFailureMessage(shown(q.error, offline), 'People')} onRetry={() => void q.fetchNextPage()} retrying={q.isFetchingNextPage}
          layout="inline" testID="space-info-more-error" />
      ) : q.hasNextPage ? (
        <HapticPressable intent="light" onPress={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} accessibilityRole="button"
          accessibilityLabel="Show more people" accessibilityState={{ disabled: q.isFetchingNextPage, busy: q.isFetchingNextPage }}
          testID="space-info-more" style={({ pressed }) => [s.more, pressed ? s.pressed : null]}>
          {q.isFetchingNextPage ? <ActivityIndicator color={fp.deep} /> : <Text style={s.moreText}>Show more</Text>}
        </HapticPressable>
      ) : null}
    </View>
  );
}

function Group({ label, people, viewerId }: { label: string; people: SpaceMember[]; viewerId?: string | null }): React.ReactElement | null {
  if (people.length === 0) return null;
  return (
    <View style={s.group}>
      <QuietOverline style={s.overline} accessibilityRole="header">{label}</QuietOverline>
      {people.map((m) => <Person key={m.user_id} m={m} you={m.user_id === viewerId} />)}
    </View>
  );
}

function Person({ m, you }: { m: SpaceMember; you: boolean }): React.ReactElement {
  const coach = m.role === 'coach';
  const tile = coach ? { bg: fp.deep, fg: fp.gold, edge: undefined } : tileFor(m.user_id);
  return (
    <View style={s.person} accessible accessibilityLabel={you ? `${m.display_name}, you` : m.display_name} testID={`space-info-person-${m.user_id}`}>
      <View style={[s.avatar, { backgroundColor: tile.bg }, tile.edge ? { borderWidth: 1, borderColor: tile.edge } : null]}>
        <Text style={[coach ? s.coachInitial : s.initial, { color: tile.fg }]}>{m.display_name.trim().charAt(0).toUpperCase()}</Text>
      </View>
      <View style={s.who}>
        <Text style={s.name} numberOfLines={1}>{m.display_name}</Text>
        {you ? <Text style={s.you}>You</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(colors.ink, 0.4) },
  sheet: { backgroundColor: neutral[0], borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 20, paddingTop: 8, gap: 2 },
  grab: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10, backgroundColor: fp.sageLine },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 19, lineHeight: 24, color: fp.ink, flexShrink: 1 },
  sub: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: SMALL_GREY },
  scroll: { flexGrow: 0, marginTop: spacing.md },
  body: { gap: spacing.md, paddingBottom: spacing.xs },
  purpose: { ...typography.body, fontSize: 15, lineHeight: 22, color: fp.ink },
  group: { gap: 2 },
  overline: { color: SMALL_GREY, marginTop: spacing.sm, marginBottom: spacing.xs },
  // The space chat's avatar (SpaceChatRow: 40 pt, 12 pt corners) beside a 44 pt row.
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingVertical: 6 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  coachInitial: { ...typography.h3, fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 18 },
  who: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 15, lineHeight: 20, color: fp.ink },
  you: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: SMALL_GREY },
  alone: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: SMALL_GREY, marginTop: spacing.xs },
  more: {
    minHeight: 44, borderRadius: radius.button, borderWidth: 1, borderColor: fp.deep, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.lg, marginTop: spacing.sm,
  },
  moreText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 15, lineHeight: 20, color: fp.deep },
  pressed: { opacity: 0.7 },
});
