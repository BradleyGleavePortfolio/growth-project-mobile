import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
  Image,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, colors } from '../../theme/index';
import FoodImage from '../FoodImage';
import { SearchResult } from '../../utils/log/types';

interface Props {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
  onRetrySearch: () => void;
  searching: boolean;
  showSlowMessage: boolean;
  searchError: string | null;
  searchResults: SearchResult[];
  didYouMean: SearchResult[];

  recentTab: 'recent' | 'frequent';
  onRecentTabChange: (tab: 'recent' | 'frequent') => void;
  recentFoods: SearchResult[];
  frequentFoods: SearchResult[];

  onSelectFood: (food: SearchResult) => void;
  onEnterManualMode: () => void;
}

function FoodThumb({ item }: { item: SearchResult }) {
  if (item.image_url) {
    return (
      <Image
        source={{ uri: item.image_url }}
        style={styles.foodThumb}
        resizeMode="cover"
      />
    );
  }
  return (
    <View style={{ marginRight: 12 }}>
      <FoodImage name={item.name || '?'} size={48} />
    </View>
  );
}

export default function FoodSearchView({
  searchQuery,
  onSearchChange,
  onClearSearch,
  onRetrySearch,
  searching,
  showSlowMessage,
  searchError,
  searchResults,
  didYouMean,
  recentTab,
  onRecentTabChange,
  recentFoods,
  frequentFoods,
  onSelectFood,
  onEnterManualMode,
}: Props) {
  const browseList = recentTab === 'recent' ? recentFoods : frequentFoods;
  const showList = searchQuery.length >= 2 ? searchResults : browseList;
  const showEmpty =
    searchQuery.length >= 2 && !searching && searchResults.length === 0 && didYouMean.length === 0;

  return (
    <View style={styles.modalBody}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search foods..."
          placeholderTextColor={Colors.textMuted}
          value={searchQuery}
          onChangeText={onSearchChange}
          autoFocus
        />
        {searching && <ActivityIndicator size="small" color={Colors.primary} />}
        {!searching && searchQuery.length > 0 && (
          <TouchableOpacity onPress={onClearSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {searchError && (
        <View style={styles.searchErrorBanner}>
          <Ionicons name="warning-outline" size={16} color={Colors.error} />
          <Text style={styles.searchErrorText}>{searchError}</Text>
        </View>
      )}

      {searching && showSlowMessage && (
        <View style={styles.slowSearchBanner}>
          <Text style={styles.slowSearchText}>Searching 1M+ foods...</Text>
        </View>
      )}

      {searchQuery.length < 2 && (
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabChip, recentTab === 'recent' && styles.tabChipActive]}
            onPress={() => onRecentTabChange('recent')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabChipText, recentTab === 'recent' && styles.tabChipTextActive]}>Recent</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabChip, recentTab === 'frequent' && styles.tabChipActive]}
            onPress={() => onRecentTabChange('frequent')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabChipText, recentTab === 'frequent' && styles.tabChipTextActive]}>Frequent</Text>
          </TouchableOpacity>
        </View>
      )}

      {didYouMean.length > 0 && (
        <View style={styles.didYouMeanContainer}>
          <View style={styles.didYouMeanHeaderRow}>
            <Ionicons name="bulb-outline" size={16} color={Colors.gold} />
            <Text style={styles.didYouMeanHeaderText}>Did you mean…?</Text>
          </View>
          {didYouMean.map((item, idx) => (
            <TouchableOpacity
              key={`dym-${idx}`}
              style={styles.didYouMeanItem}
              onPress={() => onSelectFood(item)}
              activeOpacity={0.7}
            >
              <View style={styles.searchResultLeft}>
                <Text style={styles.searchResultName}>{item.name}</Text>
                {item.brand ? (
                  <Text style={styles.searchResultBrand}>{item.brand}</Text>
                ) : null}
                <Text style={styles.searchResultMacros}>
                  P: {Math.round(item.protein)}g · C: {Math.round(item.carbs)}g · F: {Math.round(item.fat)}g
                </Text>
              </View>
              <Text style={styles.searchResultCals}>{Math.round(item.calories)} kcal</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={showList}
        keyExtractor={(item, index) => `${item.id || item.name}-${index}`}
        ListHeaderComponent={
          searchQuery.length < 2 && browseList.length > 0 ? (
            <Text style={styles.listHeader}>
              {recentTab === 'recent' ? 'Recent Foods' : 'Frequent Foods'}
            </Text>
          ) : showEmpty ? (
            <View style={styles.emptyStateContainer}>
              <Ionicons name="search-outline" size={36} color={Colors.textMuted} />
              <Text style={styles.emptyStateTitle}>No results found</Text>
              <Text style={styles.emptyStateSubtitle}>
                Try a simpler name, check spelling, or log it manually below.
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10, marginTop: 12 }}
                onPress={onRetrySearch}
              >
                <Text style={{ color: Colors.white, fontWeight: '600', fontSize: 14 }}>Retry Search</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.searchResultItem}
            onPress={() => onSelectFood(item)}
            activeOpacity={0.7}
          >
            <FoodThumb item={item} />
            <View style={styles.searchResultLeft}>
              <Text style={styles.searchResultName}>{item.name}</Text>
              {item.brand ? (
                <Text style={styles.searchResultBrand}>{item.brand}</Text>
              ) : null}
              <Text style={styles.searchResultMacros}>
                P: {Math.round(item.protein)}g · C: {Math.round(item.carbs)}g · F: {Math.round(item.fat)}g
                {item.serving_size ? ` · ${item.serving_size}` : ''}
              </Text>
            </View>
            <Text style={styles.searchResultCals}>{Math.round(item.calories)} kcal</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.searchList}
        keyboardShouldPersistTaps="handled"
      />

      <TouchableOpacity
        style={styles.manualButton}
        onPress={onEnterManualMode}
        activeOpacity={0.8}
      >
        {/* usePressFeedback not needed here — TouchableOpacity retained to avoid FlatList interaction conflict */}
        <Ionicons name="create-outline" size={18} color={Colors.primary} />
        <Text style={styles.manualButtonText}>Enter Manually</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBody: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.dark,
  },
  searchErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 10,
    backgroundColor: colors.feedback.errorBg,
    borderRadius: 0, // radius.sm
    borderWidth: 1,
    borderColor: Colors.error,
  },
  searchErrorText: {
    fontSize: 13,
    color: colors.feedback.errorText,
    flex: 1,
  },
  slowSearchBanner: {
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
  },
  slowSearchText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 8,
    gap: 8,
  },
  tabChip: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  tabChipTextActive: {
    color: Colors.white,
  },
  didYouMeanContainer: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  didYouMeanHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  didYouMeanHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.gold,
  },
  didYouMeanItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  emptyStateContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark,
    marginTop: 8,
  },
  emptyStateSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  searchList: {
    paddingHorizontal: 20,
    paddingBottom: 80,
  },
  listHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: 8,
    marginTop: 4,
  },
  foodThumb: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    marginRight: 12,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchResultLeft: {
    flex: 1,
    marginRight: 12,
  },
  searchResultName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark,
  },
  searchResultBrand: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  searchResultMacros: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  searchResultCals: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  manualButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
});
