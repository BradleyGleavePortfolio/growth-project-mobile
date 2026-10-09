import React from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { layout, radius, typography } from '../../theme/tokens';
import HapticPressable from '../HapticPressable';
import { QuietOverline } from '../../ui/sections/QuietSection';
import { useTheme } from '../../theme/useTheme';
import { QuietText as Text } from '../../ui/progress/QuietBar';
import FoodImage from '../FoodImage';
import { SearchResult } from '../../utils/log/types';
import type { PastMeal } from '../../hooks/useFoodBrowse';
import { formatPortion } from '../../utils/log/quickLog';

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
  // No day of the week could be read: an empty list is not "nothing logged".
  browseUnavailable?: boolean;

  onSelectFood: (food: SearchResult) => void;
  onEnterManualMode: () => void;

  // Most recent earlier meal in this slot, offered as a one-tap repeat.
  repeatMeal?: PastMeal | null;
  repeatMealTitle?: string;
  onRepeatMeal?: () => void;
  saving?: boolean;
}

// "From your log · Last time 2 servings" for foods the client has logged.
function logNote(item: SearchResult): string | null {
  const last = item.last_quantity && item.last_unit ? `Last time ${formatPortion(item.last_quantity, item.last_unit)}` : null;
  if (item.from_log) return last ? `From your log · ${last}` : 'From your log';
  return last;
}

function FoodThumb({ item }: { item: SearchResult }) {
  const styles = makeStyles(useTheme().semanticColors);
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
  browseUnavailable,
  onSelectFood,
  onEnterManualMode,
  repeatMeal,
  repeatMealTitle,
  onRepeatMeal,
  saving,
}: Props) {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const browseList = recentTab === 'recent' ? recentFoods : frequentFoods;
  const showList = searchQuery.length >= 2 ? searchResults : browseList;
  const showEmpty =
    searchQuery.length >= 2 && !searching && searchResults.length === 0 && didYouMean.length === 0;
  const nutrient = (value: number) => Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '—';
  const basisLabel = (item: SearchResult) => item.nutrient_basis === 'PER_SERVING' ? 'Per portion' : 'Per 100g';

  return (
    <View style={styles.modalBody}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={sc.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search foods..."
          placeholderTextColor={sc.textMuted}
          value={searchQuery}
          onChangeText={onSearchChange}
          autoFocus
        />
        {searching && <ActivityIndicator size="small" color={sc.accentText} />}
        {searchQuery.length > 0 && (
          <HapticPressable intent="light" disableAnimation onPress={onClearSearch} style={styles.clearButton} accessibilityRole="button" accessibilityLabel="Clear food search">
            <Ionicons name="close-circle" size={18} color={sc.textMuted} />
          </HapticPressable>
        )}
      </View>

      {searchError && (
        <View style={styles.searchErrorBanner} accessibilityRole="alert" testID="food-search-error">
          <Ionicons name="information-circle-outline" size={16} color={sc.textMuted} />
          <Text style={styles.searchErrorText}>{searchError}</Text>
        </View>
      )}

      {searching && showSlowMessage && (
        <View style={styles.slowSearchBanner}>
          <Text style={styles.slowSearchText}>Searching the food catalog…</Text>
        </View>
      )}

      {searchQuery.length < 2 && repeatMeal && repeatMeal.entries.length > 0 && onRepeatMeal ? (
        <View style={styles.repeatCard}>
          <View style={styles.repeatText}>
            <Text style={styles.repeatTitle}>{repeatMealTitle}</Text>
            <Text style={styles.repeatSubtitle} numberOfLines={2}>
              {repeatMeal.entries.map((e) => e.name).join(', ')} · {Math.round(repeatMeal.calories)} kcal
            </Text>
          </View>
          <HapticPressable
            intent="medium"
            style={[styles.repeatButton, saving && styles.repeatButtonBusy]}
            onPress={onRepeatMeal}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={`${repeatMealTitle}: add all ${repeatMeal.entries.length} ${repeatMeal.entries.length === 1 ? 'food' : 'foods'}`}
          >
            {saving ? (
              <ActivityIndicator size="small" color={sc.accentText} />
            ) : (
              <Text style={styles.repeatButtonText}>Add all</Text>
            )}
          </HapticPressable>
        </View>
      ) : null}

      {searchQuery.length < 2 && (
        <View style={styles.tabRow}>
          {(['recent', 'frequent'] as const).map((tab) => (
            <HapticPressable
              key={tab}
              intent="light"
              disableAnimation
              style={[styles.tabChip, recentTab === tab && styles.tabChipActive]}
              onPress={() => onRecentTabChange(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: recentTab === tab }}
            >
              <Text style={[styles.tabChipText, recentTab === tab && styles.tabChipTextActive]}>{tab === 'recent' ? 'Recent' : 'Frequent'}</Text>
            </HapticPressable>
          ))}
        </View>
      )}

      {didYouMean.length > 0 && (
        <View style={styles.didYouMeanContainer}>
          <View style={styles.didYouMeanHeaderRow}>
            <QuietOverline style={styles.overlineFlush}>Did you mean</QuietOverline>
          </View>
          {didYouMean.map((item, idx) => (
            <HapticPressable
              key={`dym-${idx}`}
              intent="light"
              style={styles.didYouMeanItem}
              onPress={() => onSelectFood(item)}
            >
              <View style={styles.searchResultLeft}>
                <Text style={styles.searchResultName}>{item.name}</Text>
                {item.brand ? (
                  <Text style={styles.searchResultBrand}>{item.brand}</Text>
                ) : null}
                <Text style={styles.searchResultMacros}>
                  Protein {nutrient(item.protein)}g · Carbs {nutrient(item.carbs)}g · Fat {nutrient(item.fat)}g
                </Text>
                <Text style={styles.searchResultMacros}>{basisLabel(item)}</Text>
              </View>
              <Text style={styles.searchResultCals}>{Number.isFinite(item.calories) ? Math.round(item.calories) : '—'} kcal</Text>
            </HapticPressable>
          ))}
        </View>
      )}

      <FlatList
        data={showList}
        keyExtractor={(item, index) => `${item.id || item.name}-${index}`}
        ListHeaderComponent={
          searchQuery.length < 2 && browseList.length > 0 ? (
            <QuietOverline style={styles.listHeader}>
              {recentTab === 'recent' ? 'Recent foods, last 7 days' : 'Most logged, last 7 days'}
            </QuietOverline>
          ) : searchQuery.length < 2 && browseList.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              {browseUnavailable ? (
                <>
                  <Text style={styles.emptyStateTitle}>Recent foods could not load</Text>
                  <Text style={styles.emptyStateSubtitle}>Check the connection, or tap Enter manually to save this food now.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyStateTitle}>{recentTab === 'recent' ? 'No foods logged in the last 7 days' : 'No frequent foods yet'}</Text>
                  <Text style={styles.emptyStateSubtitle}>Search for a food above or enter its label details manually.</Text>
                </>
              )}
            </View>
          ) : showEmpty ? (
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateTitle}>{searchError ? 'Search unavailable' : 'No results found'}</Text>
              <Text style={styles.emptyStateSubtitle}>
                {searchError ? 'Check the connection and retry, or enter food details manually below.' : 'Try a simpler name, check spelling, or log it manually below.'}
              </Text>
              <HapticPressable intent="light" style={styles.retryButton} onPress={onRetrySearch}>
                <Text style={styles.retryText}>Try again</Text>
              </HapticPressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <HapticPressable
            intent="light"
            style={styles.searchResultItem}
            onPress={() => onSelectFood(item)}
          >
            <FoodThumb item={item} />
            <View style={styles.searchResultLeft}>
              <Text style={styles.searchResultName}>{item.name}</Text>
              {item.brand ? (
                <Text style={styles.searchResultBrand}>{item.brand}</Text>
              ) : null}
              <Text style={styles.searchResultMacros}>
                Protein {nutrient(item.protein)}g · Carbs {nutrient(item.carbs)}g · Fat {nutrient(item.fat)}g
              </Text>
              <Text style={styles.searchResultMacros}>
                {basisLabel(item)}{item.serving_size ? ` · Serving: ${item.serving_size}` : ''}
              </Text>
              {logNote(item) ? <Text style={styles.logNote}>{logNote(item)}</Text> : null}
            </View>
            <Text style={styles.searchResultCals}>{Number.isFinite(item.calories) ? Math.round(item.calories) : '—'} kcal</Text>
          </HapticPressable>
        )}
        contentContainerStyle={styles.searchList}
        keyboardShouldPersistTaps="handled"
      />

      <HapticPressable
        intent="light"
        style={styles.manualButton}
        onPress={onEnterManualMode}
        accessibilityRole="button"
      >
        <Ionicons name="create-outline" size={18} color={sc.accentText} />
        <Text style={styles.manualButtonText}>Enter manually</Text>
      </HapticPressable>
    </View>
  );
}

const makeStyles = (sc: ReturnType<typeof useTheme>['semanticColors']) => StyleSheet.create({
  repeatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: layout.gutter,
    marginBottom: 12,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
    backgroundColor: sc.bgSurface,
    gap: 12,
  },
  repeatText: { flex: 1 },
  repeatTitle: { ...typography.h3, color: sc.textPrimary },
  repeatSubtitle: { fontSize: 13, lineHeight: 19, color: sc.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },
  repeatButton: {
    minHeight: layout.touchMin,
    minWidth: 88,
    paddingHorizontal: 16,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: sc.accent,
  },
  repeatButtonBusy: { borderColor: sc.border },
  repeatButtonText: { color: sc.accentText, fontFamily: typography.bodyMd.fontFamily, fontSize: 14 },
  logNote: { fontSize: 13, color: sc.textMuted, marginTop: 2 },
  clearButton: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  modalBody: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: layout.gutter,
    marginTop: 16,
    marginBottom: 12,
    paddingLeft: 14,
    paddingRight: 4,
    gap: 8,
    minHeight: layout.buttonHeight,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
    backgroundColor: sc.bgSurface,
  },
  searchInput: {
    minHeight: 44, fontFamily: 'Inter_400Regular',
    flex: 1,
    fontSize: 16,
    color: sc.textPrimary,
  },
  searchErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: layout.gutter,
    marginBottom: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  searchErrorText: {
    fontSize: 13,
    color: sc.textMuted,
    flex: 1,
  },
  slowSearchBanner: {
    marginHorizontal: layout.gutter,
    marginBottom: 8,
  },
  slowSearchText: {
    fontSize: 13,
    color: sc.textMuted,
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: layout.gutter,
    marginBottom: 8,
    gap: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  tabChip: {
    minHeight: layout.touchMin,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  tabChipActive: {
    borderBottomColor: sc.accent,
  },
  tabChipText: {
    fontSize: 14,
    color: sc.textMuted,
  },
  tabChipTextActive: {
    fontFamily: typography.bodyMd.fontFamily,
    color: sc.textPrimary,
  },
  overlineFlush: { marginBottom: 0 },
  didYouMeanContainer: {
    marginHorizontal: layout.gutter,
    marginBottom: 10,
  },
  didYouMeanHeaderRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  didYouMeanItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  emptyStateContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 8,
    gap: 8,
  },
  emptyStateTitle: {
    ...typography.h3,
    color: sc.textPrimary,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 13,
    color: sc.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  retryButton: { minHeight: layout.touchMin, justifyContent: 'center', paddingHorizontal: 24, marginTop: 4 },
  retryText: { color: sc.accentText, fontFamily: typography.bodyMd.fontFamily, fontSize: 14 },
  searchList: {
    paddingHorizontal: layout.gutter,
    paddingBottom: 80,
  },
  listHeader: {
    marginBottom: 4,
    marginTop: 8,
  },
  foodThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.input,
    marginRight: 12,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: layout.rowMinHeight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  searchResultLeft: {
    flex: 1,
    marginRight: 12,
  },
  searchResultName: {
    fontSize: 16,
    lineHeight: 22,
    color: sc.textPrimary,
  },
  searchResultBrand: {
    fontSize: 13,
    color: sc.textMuted,
    marginTop: 1,
  },
  searchResultMacros: {
    fontSize: 13,
    color: sc.textMuted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  searchResultCals: {
    fontSize: 14,
    color: sc.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: layout.touchMin,
    paddingVertical: 12,
    marginHorizontal: layout.gutter,
    marginBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
  },
  manualButtonText: {
    fontSize: 15,
    fontFamily: typography.bodyMd.fontFamily,
    color: sc.accentText,
  },
});
