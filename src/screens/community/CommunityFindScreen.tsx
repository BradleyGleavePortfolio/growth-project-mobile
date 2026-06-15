/**
 * CommunityFindScreen — the v3-4 community SEARCH surface. A SearchBar (debounced
 * here, not in the input component) drives useCommunitySearch; matching posts /
 * lessons / events / voice-note transcripts render as SearchResultRows. The
 * surface has FOUR distinct states that are never conflated
 * (DESIGN_INTELLIGENCE: distinct idle / loading / empty / error):
 *
 *   - idle       — no term yet: the idle empty state (no network call fires).
 *   - loading    — a term is searching: a busy indicator.
 *   - error      — the search failed: a calm retry.
 *   - noResults  — the server returned zero hits for the term.
 *
 * The workspace prerequisite (useCommunityMe) is resolved BEFORE any result
 * state so a still-loading / failed prerequisite is never shown as "no results".
 * The list is cursor-paginated (onEndReached) so a large result set stays
 * bounded. Registered in CommunityNavigator ONLY when
 * `featureFlags.communitySearch` is true; a defense-in-depth guard renders a
 * neutral "not available" state if reached with the flag off.
 *
 * Tokens only (no raw hex); line Ionicons only (no emoji); fontWeight <= '600'.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { useCommunityMe } from '../../hooks/useCommunity';
import { useCommunitySearch } from '../../hooks/useCommunitySearch';
import { track } from '../../analytics/posthog.service';
import {
  AnalyticsEvents,
  type CommunitySearchResultTappedProps,
} from '../../analytics/events';
import { dedupeById } from '../../utils/dedupeById';
import { ThreadHeader } from '../../components/community';
import SearchBar from '../../components/community/SearchBar';
import SearchResultRow from '../../components/community/SearchResultRow';
import SearchEmptyState from '../../components/community/SearchEmptyState';
import HapticPressable from '../../components/HapticPressable';
import type { SearchResultRow as SearchResultRowModel } from '../../api/communitySearchApi';
import type { CommunityNav } from './communityNavTypes';

/** Debounce window for the search term (ms). */
const SEARCH_DEBOUNCE_MS = 300;

export default function CommunityFindScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();

  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? null;
  const prerequisiteLoading = me.isLoading;
  const prerequisiteError = me.isError;

  // Server-evaluated runtime gates (fail-safe OFF). `community_search` is the
  // inner gate for THIS surface; `community_classroom` / `community_events`
  // gate whether a lesson / event search HIT may be opened (F8) — a hit can
  // appear for a surface that is dark for this caller, so we must not navigate
  // into an unregistered route.
  const { flags } = useFeatureFlags();
  const runtimeEnabled = flags.community_search;

  // F8: when a dependent surface is off we cannot open that hit; surface a calm,
  // transient notice instead of dead-ending into a missing route.
  const [unavailableKind, setUnavailableKind] = useState<
    'classroom_lesson' | 'event' | null
  >(null);

  // The raw (immediate) input value vs the debounced term that drives the
  // query. Debouncing lives here so the SearchBar stays a pure input.
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setTerm(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  const trimmed = term.trim();
  const search = useCommunitySearch({
    workspaceId: workspaceId ?? undefined,
    term,
  });

  const data = useMemo(
    () => dedupeById(search.data?.pages.flatMap((p) => p.results) ?? []),
    [search.data],
  );

  const open = useCallback(
    (result: SearchResultRowModel) => {
      // F4: a result tap is the engagement signal. The position is the index in
      // the (deduped) result list; ids/excerpts are never sent as event props.
      const kindToResultType: Record<
        SearchResultRowModel['kind'],
        CommunitySearchResultTappedProps['result_type']
      > = {
        post: 'thread',
        voice_note_transcript: 'voice_note_transcript',
        classroom_lesson: 'classroom_lesson',
        event: 'event',
      };
      const position = data.findIndex((r) => r.id === result.id);
      track(AnalyticsEvents.COMMUNITY_SEARCH_RESULT_TAPPED, {
        result_type: kindToResultType[result.kind],
        position: position >= 0 ? position : 0,
      });

      setUnavailableKind(null);
      switch (result.kind) {
        case 'post':
          navigation.navigate('CommunityThread', { postId: result.targetId });
          break;
        case 'voice_note_transcript':
          // F1: a voice-note transcript hit opens the dedicated voice-note
          // detail with the VOICE NOTE id (not a postId), carrying the matched
          // transcript excerpt the row already held.
          navigation.navigate('CommunityVoiceNoteDetail', {
            voiceNoteId: result.targetId,
            excerpt: result.excerpt,
          });
          break;
        case 'classroom_lesson':
          // F8: the classroom surface may be dark for this caller even though a
          // lesson hit surfaced; only open the (flag-registered) route when the
          // server flag is ON, else show a calm notice.
          if (flags.community_classroom) {
            navigation.navigate('CommunityLessonDetail', {
              postId: result.targetId,
            });
          } else {
            setUnavailableKind('classroom_lesson');
          }
          break;
        case 'event':
          // F8: same containment for the events surface.
          if (flags.community_events) {
            navigation.navigate('CommunityEventDetail', {
              eventId: result.targetId,
            });
          } else {
            setUnavailableKind('event');
          }
          break;
      }
    },
    [navigation, data, flags.community_classroom, flags.community_events],
  );

  const onEndReached = useCallback(() => {
    if (search.hasNextPage && !search.isFetchingNextPage) {
      void search.fetchNextPage();
    }
  }, [search]);

  // Announce the result count once a search settles so a screen-reader user
  // knows the surface populated. A ref tracks the last announced count.
  const resultCount = data.length;
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    if (!search.isSuccess || trimmed.length === 0) return;
    const key = `${trimmed}:${resultCount}`;
    if (lastAnnounced.current === key) return;
    lastAnnounced.current = key;
    AccessibilityInfo.announceForAccessibility(
      resultCount > 0
        ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`
        : 'No results',
    );
    // F4: a settled search is the funnel signal. The raw term is NEVER sent
    // (only its length) so no free-text query leaves the device.
    track(AnalyticsEvents.COMMUNITY_SEARCH_SUBMITTED, {
      query_length: trimmed.length,
      result_count: resultCount,
    });
  }, [search.isSuccess, resultCount, trimmed]);

  const header = (
    <View style={styles.searchWrap}>
      <SearchBar value={input} onChangeText={setInput} />
    </View>
  );

  // Defense-in-depth: never reachable with the static flag off (route not
  // registered), and additionally hidden if the server flag resolves OFF.
  if (!featureFlags.communitySearch || !runtimeEnabled) {
    return (
      <SafeAreaView
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
      >
        <ThreadHeader title="Search" testID="community-find-header" />
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Search is not available right now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  let bodyContent: React.ReactElement;
  if (prerequisiteLoading) {
    bodyContent = (
      <View
        style={styles.center}
        accessibilityState={{ busy: true }}
        testID="community-find-prereq-loading"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading search"
        />
      </View>
    );
  } else if (prerequisiteError) {
    bodyContent = (
      <View style={styles.center} testID="community-find-prereq-error">
        <Ionicons
          name="alert-circle-outline"
          size={28}
          color={semanticColors.textMuted}
        />
        <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
          We could not open search. Please try again.
        </Text>
        <HapticPressable
          intent="light"
          onPress={() => void me.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID="community-find-prereq-retry"
          style={[styles.retry, { borderColor: semanticColors.accent }]}
        >
          <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
            Try again
          </Text>
        </HapticPressable>
      </View>
    );
  } else if (trimmed.length === 0) {
    bodyContent = <SearchEmptyState variant="idle" testID="community-find-idle" />;
  } else if (search.isLoading) {
    bodyContent = (
      <View
        style={styles.center}
        accessibilityState={{ busy: true }}
        testID="community-find-loading"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          accessibilityRole="progressbar"
          accessibilityLabel="Searching"
        />
      </View>
    );
  } else if (search.isError) {
    bodyContent = (
      <View style={styles.center} testID="community-find-error">
        <Ionicons
          name="alert-circle-outline"
          size={28}
          color={semanticColors.textMuted}
        />
        <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
          Search failed. Please try again.
        </Text>
        <HapticPressable
          intent="light"
          onPress={() => void search.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID="community-find-retry"
          style={[styles.retry, { borderColor: semanticColors.accent }]}
        >
          <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
            Try again
          </Text>
        </HapticPressable>
      </View>
    );
  } else if (data.length === 0) {
    bodyContent = (
      <SearchEmptyState
        variant="noResults"
        term={trimmed}
        testID="community-find-no-results"
      />
    );
  } else {
    bodyContent = (
      <FlatList
        data={data}
        accessibilityRole="list"
        accessibilityLabel={`Results, ${data.length} ${
          data.length === 1 ? 'item' : 'items'
        }`}
        renderItem={({ item }) => (
          <View role="listitem" testID={`community-search-listitem-${item.id}`}>
            <SearchResultRow result={item} onPress={open} />
          </View>
        )}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          search.isFetchingNextPage ? (
            <View style={styles.loadMore} testID="community-find-load-more">
              <ActivityIndicator
                color={semanticColors.accent}
                accessibilityRole="progressbar"
                accessibilityLabel="Loading more results"
              />
            </View>
          ) : null
        }
        testID="community-find-list"
      />
    );
  }

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
    >
      <ThreadHeader title="Search" testID="community-find-header" />
      {header}
      {unavailableKind ? (
        <View style={styles.notice} testID="community-find-unavailable-notice">
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.noticeText, { color: semanticColors.textMuted }]}>
            {unavailableKind === 'classroom_lesson'
              ? 'Lessons are not available right now.'
              : 'Events are not available right now.'}
          </Text>
        </View>
      ) : null}
      <View style={styles.flex}>{bodyContent}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
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
  listContent: { padding: spacing.lg, gap: spacing.sm },
  loadMore: { paddingVertical: spacing.lg, alignItems: 'center' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  noticeText: { fontSize: 13, flex: 1 },
});
