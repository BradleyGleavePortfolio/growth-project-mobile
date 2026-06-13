/**
 * CommunityDmListScreen — the DM inbox (product plan §2.10: 1:1 messaging,
 * gated by the per-workspace dm_enabled policy on the backend). Lists the
 * caller's conversation threads (REST, never realtime payloads), each opening a
 * single conversation. Coach threads carry the Roman monogram accent.
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
import { spacing, radius } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useDmThreads } from '../../hooks/useCommunity';
import {
  CommunityEmptyState,
  DmRow,
} from '../../components/community';
import HapticPressable from '../../components/HapticPressable';
import type { CommunityDmThread } from '../../api/communityApi';
import type { CommunityNav } from './communityNavTypes';

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
  const isEmpty = !threads.isLoading && (threads.isError || data.length === 0);

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
            We could not load your messages. Please try again.
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

  return (
    <Container>
      {isEmpty ? (
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
          data={data}
          keyExtractor={(t) => t.thread_id}
          renderItem={({ item }) => (
            <DmRow
              thread={item}
              participantLabel="Coach"
              isCoach
              onPress={openThread}
              testID={`dm-row-${item.thread_id}`}
            />
          )}
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
  list: { paddingVertical: 8 },
});
