import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  RefreshControl,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import PushPermissionCard from '../../components/home/PushPermissionCard';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ClientsStackParamList } from '../../navigation/CoachNavigator';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';

import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { SkeletonClientCard } from '../../ui/skeletons';
import { EmptyState, EmptyStateNoClients, EmptyStateNoResults, IconPeople } from '../../ui/empty-states';
import {
  rosterActivityLine,
  rosterCountLine,
  rosterDisplayName,
  rosterReviewBadge,
  sortRoster,
  type RosterClient,
  type RosterSort,
} from '../../utils/coach/clientRoster';

type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'ClientsList'>;
};

type RosterFilter = 'all' | 'active' | 'archived';
const FILTERS: Array<{ key: RosterFilter; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

function initials(c: RosterClient): string {
  const name = rosterDisplayName(c);
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${second}`.toUpperCase();
}

export default function ClientsListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const {
    clients,
    isLoading,
    loadError,
    searchQuery,
    filterStatus,
    loadClients,
    setSearchQuery,
    setFilterStatus,
    getFilteredClients,
  } = useCoachStore();
  // UX-COACHLOOKUP-124: name A to Z by default (fastest way to find one
  // person); "Recent" puts the clients who logged most recently first and the
  // quiet ones last.
  const [sort, setSort] = useState<RosterSort>('name');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (currentUser) {
      loadClients(currentUser.id, filterStatus);
    }
  }, [currentUser?.id, filterStatus]);

  // Coming back from a client (archived, messaged, reviewed a check-in) or
  // from another tab that reloaded the shared list: refresh in place. The
  // first focus is the mount, already loaded above.
  const focusedOnce = useRef(false);
  const coachId = currentUser?.id;
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (!focusedOnce.current) {
          focusedOnce.current = true;
          return;
        }
        if (coachId) loadClients(coachId, filterStatus, { silent: true });
      }),
    [navigation, coachId, filterStatus, loadClients],
  );

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    try {
      await loadClients(currentUser.id, filterStatus, { silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [currentUser?.id, filterStatus, loadClients]);

  const searching = searchQuery.trim().length > 0;
  const shownClients = sortRoster(getFilteredClients(), sort);
  const total = clients.length;
  const countLine = rosterCountLine(shownClients, total, filterStatus, searching);

  const renderClient = ({ item }: { item: RosterClient }) => {
    const name = rosterDisplayName(item);
    const line = rosterActivityLine(item);
    const review = rosterReviewBadge(item);
    const archived = item.status === 'archived';
    const lineColor =
      line.tone === 'quiet' ? colors.warning : line.tone === 'ok' ? colors.textSecondary : colors.textMuted;
    const a11y = [name, line.text, review, archived ? 'Archived' : null].filter(Boolean).join(', ');
    return (
      <HapticPressable
        intent="light"
        style={styles.clientCard}
        onPress={() =>
          navigation.navigate('ClientDetail', {
            clientId: item.id,
            clientName: name,
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`Open client ${a11y}`}
        testID={`client-row-${item.id}`}
      >
        <View style={[styles.avatar, archived && styles.avatarArchived]}>
          <Text style={styles.avatarText}>{initials(item)}</Text>
        </View>
        <View style={styles.clientInfo}>
          <Text style={styles.clientName} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.activityRow}>
            {line.tone !== 'muted' ? (
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: line.tone === 'quiet' ? colors.warning : colors.success },
                ]}
              />
            ) : null}
            <Text style={[styles.activityText, { color: lineColor }]} numberOfLines={1}>
              {line.text}
            </Text>
          </View>
        </View>
        {review ? (
          <View style={styles.reviewBadge}>
            <Text style={styles.reviewBadgeText}>{review}</Text>
          </View>
        ) : null}
        {archived ? (
          <View style={styles.archivedTag}>
            <Text style={styles.archivedTagText}>Archived</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </HapticPressable>
    );
  };

  // Audit fix CR-4 / Coach #8: a single goToInviteCodes handler
  // reused by the header pill (always visible) and by
  // EmptyStateNoClients (zero-clients state). Without these the
  // brand-new coach has no path to the invite-code surface — the
  // empty-state CTA renders no button (EmptyState guards on
  // ctaLabel && onCta) and no header CTA exists. After this change
  // the path exists from both the empty roster and the populated
  // roster.
  const goToInviteCodes = () => navigation.navigate('InviteCodes');
  // S-REACH: the risk board (GET /coach/clients/risk-board, nightly PTM
  // scores) had its only entry on the retired Dashboard screen. Head coaches
  // and the owner read it; the route answers 403 to every other role, so the
  // pill is not shown to them (no dead end).
  const canSeeRiskBoard = currentUser?.role === 'coach' || currentUser?.role === 'owner';
  const goToRiskBoard = () => navigation.navigate('RiskBoard');

  const emptyList = searchQuery ? (
    <EmptyStateNoResults query={searchQuery} onClearSearch={() => setSearchQuery('')} />
  ) : filterStatus === 'archived' ? (
    <EmptyState
      icon={<IconPeople />}
      headline="No archived clients"
      body="Clients you archive from their profile appear here."
    />
  ) : (
    <EmptyStateNoClients onInvite={goToInviteCodes} />
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Clients</Text>
            <Text style={styles.subtitle} testID="clients-count">
              {isLoading ? ' ' : countLine}
            </Text>
          </View>
          {canSeeRiskBoard ? (
            <HapticPressable
              intent="light"
              onPress={goToRiskBoard}
              style={[styles.invitePill, styles.riskPill]}
              accessibilityRole="button"
              accessibilityLabel="Clients at risk"
              accessibilityHint="Opens the clients who may need a check-in, sorted by risk"
              testID="clients-risk-pill"
            >
              <Ionicons name="pulse-outline" size={16} color={colors.primary} />
              <Text style={styles.invitePillText}>At risk</Text>
            </HapticPressable>
          ) : null}
          <HapticPressable
            intent="light"
            onPress={goToInviteCodes}
            style={styles.invitePill}
            accessibilityRole="button"
            accessibilityLabel="Invite codes"
            accessibilityHint="Opens the invite-codes screen so you can add a client"
            testID="clients-invite-pill"
          >
            <Ionicons name="person-add-outline" size={16} color={colors.primary} />
            <Text style={styles.invitePillText}>Invite</Text>
          </HapticPressable>
        </View>
      </View>

      {/* C-S-PUSH-3: the coach landing screen carries the same deferred push
          ask as client Home (once per account, dismissible, OS prompt only on
          tap), so client messages and new-client alerts reach a fresh install. */}
      <View style={styles.pushCardWrap}>
        <PushPermissionCard audience="coach" />
      </View>

      {/* Psych #2: Trust as Emotion — coach-side privacy context banner */}
      <View style={styles.privacyBanner}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.info} style={{ marginTop: 1 }} />
        <Text style={styles.privacyBannerText}>
          Clients choose what they share with you. Anything not shared stays private.
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by name or email"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search clients"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          testID="clients-search"
        />
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map(({ key, label }) => (
          <HapticPressable
            key={key}
            intent="light"
            style={[styles.filterChip, filterStatus === key && styles.filterChipActive]}
            onPress={() => setFilterStatus(key)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${label.toLowerCase()} clients`}
            accessibilityState={{ selected: filterStatus === key }}
            testID={`clients-filter-${key}`}
          >
            <Text
              style={[
                styles.filterChipText,
                filterStatus === key && styles.filterChipTextActive,
              ]}
            >
              {label}
            </Text>
          </HapticPressable>
        ))}
        <View style={styles.filterSpacer} />
        <HapticPressable
          intent="light"
          style={styles.sortToggle}
          onPress={() => setSort(sort === 'name' ? 'recent' : 'name')}
          accessibilityRole="button"
          accessibilityLabel={sort === 'name' ? 'Sorted by name. Sort by most recent log' : 'Sorted by most recent log. Sort by name'}
          testID="clients-sort"
        >
          <Ionicons name="swap-vertical" size={14} color={colors.textSecondary} />
          <Text style={styles.sortToggleText}>{sort === 'name' ? 'Name' : 'Recent'}</Text>
        </HapticPressable>
      </View>

      {loadError && shownClients.length > 0 ? (
        // A reload failed while an earlier list is on screen: say so instead
        // of showing the old list as current.
        <Text style={styles.staleText} testID="clients-stale">
          Clients did not refresh. Pull down to try again.
        </Text>
      ) : null}

      {isLoading ? (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonClientCard key={i} />
          ))}
        </>
      ) : loadError && shownClients.length === 0 ? (
        // Network/server failure with no prior data — show an explicit error
        // surface with a retry button instead of falling through to the
        // empty-roster CTA (which falsely implied the coach had no clients).
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{loadError}</Text>
          <HapticPressable
            intent="medium"
            style={styles.retryButton}
            onPress={() => currentUser && loadClients(currentUser.id, filterStatus)}
            accessibilityRole="button"
            accessibilityLabel="Retry loading clients"
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </HapticPressable>
        </View>
      ) : (
        <FlatList
          data={shownClients}
          renderItem={renderClient}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={emptyList}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 60,
  },
  header: {
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  pushCardWrap: {
    paddingHorizontal: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  titleBlock: { flex: 1 },
  title: {
    fontSize: 28,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  invitePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primaryPale,
  },
  riskPill: {
    marginRight: 8,
  },
  invitePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    letterSpacing: 0.2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 2, // radius.md
    paddingHorizontal: 16,
    marginHorizontal: 24,
    marginBottom: 16,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.textOnPrimary,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  clientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 2, // radius.md
    padding: 16,
    marginBottom: 10,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '500',
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  activityText: {
    flexShrink: 1,
    fontSize: 13,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  avatarArchived: {
    backgroundColor: colors.textMuted,
  },
  reviewBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primaryPale,
  },
  reviewBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  archivedTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  archivedTagText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  filterSpacer: { flex: 1 },
  sortToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sortToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  staleText: {
    fontSize: 13,
    color: colors.textSecondary,
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  loader: {
    marginTop: 40,
  },
  // Psych #2: Trust as Emotion
  privacyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.primaryTint,
    borderRadius: 4, // radius.lg
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  privacyBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.info,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  retryButtonText: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },


  });

