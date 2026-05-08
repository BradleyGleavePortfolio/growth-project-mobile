import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ClientsStackParamList } from '../../navigation/CoachNavigator';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';

import { User } from '../../types';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { SkeletonClientCard } from '../../ui/skeletons';
import { EmptyStateNoClients, EmptyStateNoResults } from '../../ui/empty-states';

type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'ClientsList'>;
};

export default function ClientsListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const {
    isLoading,
    loadError,
    searchQuery,
    filterStatus,
    loadClients,
    setSearchQuery,
    setFilterStatus,
    getFilteredClients,
  } = useCoachStore();

  useEffect(() => {
    if (currentUser) {
      loadClients(currentUser.id, filterStatus === 'all' ? undefined : filterStatus);
    }
  }, [currentUser?.id, filterStatus]);

  const filteredClients = getFilteredClients();
  const filters: Array<'all' | 'active' | 'archived'> = ['all', 'active', 'archived'];

  const renderClient = ({ item }: { item: User }) => (
    <HapticPressable
      intent="light"
      style={styles.clientCard}
      onPress={() =>
        navigation.navigate('ClientDetail', {
          clientId: item.id,
          clientName: `${item.firstName} ${item.lastName}`,
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Open client ${item.firstName} ${item.lastName}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(item.firstName || '?')[0]}
          {(item.lastName || '')[0]}
        </Text>
      </View>
      <View style={styles.clientInfo}>
        <Text style={styles.clientName}>
          {item.firstName} {item.lastName}
        </Text>
        <Text style={styles.clientEmail}>{item.email}</Text>
      </View>
      <View style={styles.statusBadge}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: item.status === 'active' ? colors.success : colors.textMuted },
          ]}
        />
        <Text style={styles.statusText}>{item.status}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </HapticPressable>
  );

  // Audit fix CR-4 / Coach #8: a single goToInviteCodes handler
  // reused by the header pill (always visible) and by
  // EmptyStateNoClients (zero-clients state). Without these the
  // brand-new coach has no path to the invite-code surface — the
  // empty-state CTA renders no button (EmptyState guards on
  // ctaLabel && onCta) and no header CTA exists. After this change
  // the path exists from both the empty roster and the populated
  // roster.
  const goToInviteCodes = () => navigation.navigate('InviteCodes');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Clients</Text>
            <Text style={styles.subtitle}>{filteredClients.length} total</Text>
          </View>
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

      {/* Psych #2: Trust as Emotion — coach-side privacy context banner */}
      <View style={styles.privacyBanner}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.info} style={{ marginTop: 1 }} />
        <Text style={styles.privacyBannerText}>
          Your students see what they share. You only see what they log.
        </Text>
      </View>

      {/* Phase 11 / Track 6 — Workout Builder quick-access tile */}
      <HapticPressable
        intent="light"
        style={styles.workoutBuilderTile}
        onPress={() => navigation.navigate('WorkoutBuilder')}
        accessibilityLabel="Open Workout Builder"
        accessibilityRole="button"
      >
        <Ionicons name="barbell-outline" size={20} color={colors.primary} />
        <Text style={styles.workoutBuilderTileText}>Workout Builder</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
      </HapticPressable>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search clients..."
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search clients"
        />
      </View>

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <HapticPressable
            key={f}
            intent="light"
            style={[styles.filterChip, filterStatus === f && styles.filterChipActive]}
            onPress={() => setFilterStatus(f)}
            accessibilityRole="button"
            accessibilityLabel={`Filter ${f}`}
            accessibilityState={{ selected: filterStatus === f }}
          >
            <Text
              style={[
                styles.filterChipText,
                filterStatus === f && styles.filterChipTextActive,
              ]}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </HapticPressable>
        ))}
      </View>

      {isLoading ? (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonClientCard key={i} />
          ))}
        </>
      ) : loadError && filteredClients.length === 0 ? (
        // Network/server failure with no prior data — show an explicit error
        // surface with a retry button instead of falling through to the
        // empty-roster CTA (which falsely implied the coach had no clients).
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{loadError}</Text>
          <HapticPressable
            intent="medium"
            style={styles.retryButton}
            onPress={() =>
              currentUser &&
              loadClients(currentUser.id, filterStatus === 'all' ? undefined : filterStatus)
            }
            accessibilityRole="button"
            accessibilityLabel="Retry loading clients"
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </HapticPressable>
        </View>
      ) : (
        <FlatList
          data={filteredClients}
          renderItem={renderClient}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            searchQuery
              ? <EmptyStateNoResults query={searchQuery} onClearSearch={() => setSearchQuery('')} />
              : <EmptyStateNoClients onInvite={goToInviteCodes} />
          }
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
  clientEmail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    color: colors.textSecondary,
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

  workoutBuilderTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: (colors as ThemeColors).surface,
    borderWidth: 1,
    borderColor: (colors as ThemeColors).border,
  },
  workoutBuilderTileText: {
    fontSize: 15,
    fontWeight: '600',
    color: (colors as ThemeColors).textPrimary,
  },
});
