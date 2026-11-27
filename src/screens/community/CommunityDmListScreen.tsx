/**
 * CommunityDmListScreen — the DM inbox (product plan §2.10: 1:1 messaging,
 * gated by the per-workspace dm_enabled policy on the backend). Lists the
 * caller's conversation threads (REST, never realtime payloads), each opening a
 * single conversation. Coach threads carry the Roman monogram accent.
 * COACH-DM-CLIENT-M: only my own coach's thread (client.coach_id) is "your coach", with the coach's name the app knows
 * (useMyCoachName, the read Community home makes) or "Coach" until then; anyone else, a former coach included, is
 * NO_NAME, as the coach's own list says a person with no name. Rows wait for the signed-in person.
 * REFINE-985R3 (owner pick 203-P2, DM-LIST-MOCK Style 1 "Coach first"): a client who has a coach sees the coach in a
 * forest card at the top (DmCoachCard), with or without a thread, then "Conversations" over every other thread in the
 * server's order (DmRow's Studio row: a blank tile, a chevron, no name the phone was not given). With no thread at all
 * the card is followed by the action, the title and Roman's line, in the drawing's order.
 *
 * Empty inbox → Roman-voiced empty state with a primary action ("Send your
 * coach a message"). Standardized on semanticColors / tokens.ts.
 *
 * The workspace prerequisite (useCommunityMe) is resolved BEFORE any empty
 * inbox state so a still-loading or failed prerequisite is never shown as "no
 * conversations yet". When the Community tab embeds this surface it threads the
 * real `/community/me` truth (loading / error / retry) through props so a load
 * error renders the SAME calm retryable error the route renders instead of
 * collapsing a null workspace id into an inert empty inbox.
 */
import React from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { brand, colors, forestPop as fp, spacing, radius } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useDmThreads, useMyCoachName } from '../../hooks/useCommunity';
import {
  CommunityEmptyState,
  DmRow,
} from '../../components/community';
import DmCoachCard from '../../components/community/DmCoachCard';
import { romanCopy } from '../../components/community/romanVoice';
import HapticPressable from '../../components/HapticPressable';
import type { CommunityDmThread } from '../../api/communityApi';
import type { CommunityNav } from './communityNavTypes';
import { NO_NAME, initialsOf } from './coach-dm/coachDm';

/** The threads read is one page (backend community-dms.service.ts DEFAULT_PAGE; this list passes no limit). A full page
 * that does not hold her coach's thread cannot say whether there is one, so the card then draws no time line (KT-10). */
const THREADS_PAGE = 30;

interface Props {
  embedded?: boolean;
  /**
   * Workspace id — DMs are workspace-scoped on the backend. When the Community
   * tab embeds this surface it passes the resolved id; an explicit `null` means
   * the parent's prerequisite is still loading or errored and is treated as
   * not-yet-resolved, never as a real empty inbox.
   */
  workspaceId?: string | null;
  /**
   * The embedded prerequisite (`useCommunityMe`) truth, threaded from the parent
   * tab so a real `/community/me` error renders the SAME calm, retryable error
   * state instead of collapsing a load error into a null id that shows an inert
   * empty inbox. When these are absent the screen falls back to treating a null
   * id as still-pending (loading), preserving the prior behaviour.
   */
  prerequisiteLoading?: boolean;
  prerequisiteError?: boolean;
  /** Refetches `/community/me`; wired to the error-state retry button. */
  onRetryPrerequisite?: () => void;
}

export default function CommunityDmListScreen({
  embedded,
  workspaceId,
  prerequisiteLoading: prerequisiteLoadingProp,
  prerequisiteError: prerequisiteErrorProp,
  onRetryPrerequisite,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const client = useCurrentUser();
  const threads = useDmThreads(workspaceId);
  const coachId = client?.coach_id ?? null;
  const coachName = useMyCoachName(coachId).name;

  // The workspace prerequisite must SUCCEED before we can decide "no
  // conversations". The parent threads the real `me.isLoading`/`me.isError`
  // truth so a `/community/me` error renders the calm retryable error here
  // instead of an inert empty inbox (the null-id fallback covers a parent that
  // has not yet wired the props). A genuine workspace_id=null SUCCESS (no
  // membership) is distinguished from failure: it falls through to the calm
  // empty/onboarding state, never the error state. Uses `isLoading` (not
  // `isFetching`) so a background refetch does not flash the loading branch.
  const prerequisiteLoading = prerequisiteLoadingProp ?? workspaceId === null;
  const prerequisiteError = prerequisiteErrorProp ?? false;
  const retryPrerequisite = onRetryPrerequisite ?? (() => {});

  const openThread = (thread: CommunityDmThread) =>
    navigation.navigate('CommunityDmThread', {
      recipientId: thread.other_user_id,
    });

  const startWithCoach = () =>
    navigation.navigate('CommunityComposer', {
      mode: 'dm',
      recipientId: '',
    });

  const data = threads.data ?? [];
  // A DM thread-list LOAD FAILURE must render a calm retryable error, never the
  // "no conversations yet" empty inbox — collapsing a failed `useDmThreads`
  // into an empty inbox silently hides the failure (R65 #36/#44). True-empty is
  // only a successful query that returned zero threads.
  const isThreadsError = !threads.isLoading && threads.isError;
  const isEmpty = !threads.isLoading && !threads.isError && data.length === 0;
  // REFINE-985R3 Style 1: her own coach's thread is the card; every other thread is a row, in the server's order.
  const coachFirst = !!client && !!coachId && !threads.isLoading;
  const coachThread = coachFirst ? data.find((t) => t.other_user_id === coachId) : undefined;
  const others = coachFirst ? data.filter((t) => t.other_user_id !== coachId) : data;
  const openCoach = () =>
    (coachThread ? openThread(coachThread) : navigation.navigate('CommunityDmThread', { recipientId: coachId as string }));

  const Container: React.ComponentType<{ children: React.ReactNode }> = embedded
    ? ({ children }) => <View style={styles.flex}>{children}</View>
    : ({ children }) => (
        <SafeAreaView
          style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
          edges={['top']}
        >
          {children}
        </SafeAreaView>
      );

  // Resolve the prerequisite BEFORE any inbox state so a still-loading or
  // failed prerequisite is never mistaken for an empty inbox.
  if (prerequisiteLoading) {
    return (
      <Container>
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-dmlist-prereq-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading…
          </Text>
        </View>
      </Container>
    );
  }

  if (prerequisiteError) {
    return (
      <Container>
        <View style={styles.center} testID="community-dmlist-prereq-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Your messages did not load. Check your connection, then try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={retryPrerequisite}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-dmlist-prereq-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  // A DM thread-list load failure renders a calm retryable error using
  // `threads.refetch()` instead of collapsing into the empty inbox state.
  if (isThreadsError) {
    return (
      <Container>
        <View style={styles.center} testID="community-dmlist-threads-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Your conversations did not load. Check your connection, then try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => threads.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-dmlist-threads-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  const header = coachFirst ? (
    <>
      <DmCoachCard
        name={coachName ?? 'Coach'}
        letter={coachName ? Array.from(initialsOf(coachName) ?? '')[0] ?? null : null}
        lastMessageAt={coachThread ? coachThread.last_message_at : threads.isSuccess && data.length < THREADS_PAGE ? null : undefined}
        onPress={openCoach}
        testID={coachThread ? `dm-row-${coachThread.thread_id}` : 'dm-coach-card'}
      />
      {isEmpty ? (
        // Style 1 L4 (.empty :57-60, .btn :40): the action, the title, then Roman's line.
        <View style={styles.empty} testID="community-dmlist-empty">
          <HapticPressable
            intent="medium"
            onPress={startWithCoach}
            accessibilityRole="button"
            accessibilityLabel="Send your coach a message"
            testID="community-dmlist-empty-action"
            style={styles.emptyAction}
          >
            <Text style={styles.emptyActionLabel}>Send your coach a message</Text>
          </HapticPressable>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyBody}>{romanCopy('dmInboxEmpty', { firstName: client?.firstName ?? client?.name ?? null })}</Text>
        </View>
      ) : null}
    </>
  ) : null;
  // Style 1 .sect :49, over the other rows only (700 in the drawing; the app's heaviest Inter is 600).
  const overline = client && others.length > 0 ? <Text style={styles.overline}>Conversations</Text> : null;

  return (
    <Container>
      {isEmpty && !coachFirst ? (
        <View style={styles.center} testID="community-dmlist-screen">
          <CommunityEmptyState
            stem="dmInboxEmpty"
            firstName={client?.firstName ?? client?.name ?? null}
            title="No conversations yet"
            actionLabel="Send your coach a message"
            onAction={startWithCoach}
            testID="community-dmlist-empty"
          />
        </View>
      ) : (
        <FlatList
          testID="community-dmlist-screen"
          data={others}
          keyExtractor={(t) => t.thread_id}
          ListHeaderComponent={<>{header}{overline}</>}
          renderItem={({ item }) => {
            if (!client) return null;
            // Anyone but her own coach, a former coach included: no name was read, so "Direct message" and a blank tile.
            return (
              <DmRow
                thread={item}
                participantLabel={NO_NAME}
                initials={null}
                chevron
                coachFirst
                onPress={openThread}
                testID={`dm-row-${item.thread_id}`}
              />
            );
          }}
          contentContainerStyle={styles.list}
          style={{ backgroundColor: semanticColors.bgPrimary }}
        />
      )}
    </Container>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  muted: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: {
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLabel: { fontSize: 14, fontWeight: '600' },
  list: { paddingBottom: 8 },
  // REFINE-985R3, Style 1 (S1_L1_ios.html): .sect padding 16 18 6, 11.5, letter-spacing .14em, #3A5C46, upper case.
  overline: {
    paddingTop: 16, paddingHorizontal: 18, paddingBottom: 6, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11.5,
    letterSpacing: 1.61, textTransform: 'uppercase', color: brand[500],
  },
  // .empty: centred, gap 12, padding 16 28 0; .btn 48 pt, radius 12, #2C4A36, 600 16 #FBF7F0, padding 8 20, 10 below;
  // h2 600 20/1.25; p 15/1.45 #3D3D3A.
  empty: { alignItems: 'center', gap: 12, paddingTop: 16, paddingHorizontal: 28 },
  emptyAction: { minHeight: 48, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 20, marginBottom: 10, justifyContent: 'center', backgroundColor: fp.forest },
  emptyActionLabel: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 20, textAlign: 'center', color: fp.onDeep },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 20, lineHeight: 25, textAlign: 'center', color: fp.ink },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21.75, textAlign: 'center', color: colors.charcoal },
});
