import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ClientsStackParamList } from '../../navigation/CoachNavigator';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';
import { Colors } from '../../constants/colors';
import { User } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'ClientsList'>;
};

export default function ClientsListScreen({ navigation }: Props) {
  const currentUser = useCurrentUser();
  const {
    isLoading,
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
            { backgroundColor: item.status === 'active' ? Colors.success : Colors.textMuted },
          ]}
        />
        <Text style={styles.statusText}>{item.status}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
    </HapticPressable>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Clients</Text>
        <Text style={styles.subtitle}>{filteredClients.length} total</Text>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search clients..."
          placeholderTextColor={Colors.textMuted}
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
        <ActivityIndicator
          size="large"
          color={Colors.primary}
          style={styles.loader}
        />
      ) : (
        <FlatList
          data={filteredClients}
          renderItem={renderClient}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No clients found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: 60,
  },
  header: {
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginHorizontal: 24,
    marginBottom: 16,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.textPrimary,
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
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: Colors.textOnPrimary,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  clientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: Colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  clientEmail: {
    fontSize: 13,
    color: Colors.textSecondary,
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
    color: Colors.textSecondary,
  },
  loader: {
    marginTop: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textMuted,
  },
});
