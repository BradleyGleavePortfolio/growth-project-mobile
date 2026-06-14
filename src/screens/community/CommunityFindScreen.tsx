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
import { useCommunityMe } from '../../hooks/useCommunity';
import { useCommunitySearch } from '../../hooks/useCommunitySearch';
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
      switch (result.kind) {
        case 'post':
        case 'voice_note_transcript':
          navigation.navigate('CommunityThread', { postId: result.targetId });
          break;
        case 'classroom_lesson':
          navigation.navigate('CommunityLessonDetail', {
            postId: result.targetId,
          });
          break;
        case 'event':
          navigation.navigate('CommunityEventDetail', {
            eventId: result.targetId,
          });
          break;
      }
    },
    [navigation],
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
  }, [search.isSuccess, resultCount, trimmed]);

  const header = (
    <View style={styles.searchWrap}>
      <SearchBar value={input} onChangeText={setInput} />
    </View>
  );

  // Defense-in-depth: never reachable with the flag off (route not registered).
  if (!featureFlags.communitySearch) {
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
});
