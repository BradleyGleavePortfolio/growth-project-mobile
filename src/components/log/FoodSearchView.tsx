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
import { colors, gold, layout, radius, typography } from '../../theme/tokens';
import HapticPressable from '../HapticPressable';
import { QuietOverline } from '../../ui/sections/QuietSection';
import { useTheme } from '../../theme/useTheme';
import { TextLink } from '../../ui';
import { QuietText as Text } from '../../ui/progress/QuietBar';
import FoodImage from '../FoodImage';
import { SearchResult } from '../../utils/log/types';
import type { PastMeal } from '../../hooks/useFoodBrowse';
import { formatPortion } from '../../utils/log/quickLog';
import { calcMacros } from '../../utils/log/macros';

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

const shownNumber = (value: number) => Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '—';

// STYLEC-916 (C2 C_add): one portion and protein line, and the calories of that same portion.
// A food from the log shows the portion logged last time; any other food shows its nutrition basis.
export function foodRowFacts(item: SearchResult): { line: string; kcal: string } {
  let portion = item.nutrient_basis === 'PER_SERVING' ? (item.serving_size || '1 serving') : '100 g';
  let { calories, protein } = item;
  if (item.last_quantity && item.last_quantity > 0 && item.last_unit) {
    const last = calcMacros(item, item.last_quantity, item.last_unit);
    portion = formatPortion(item.last_quantity, item.last_unit);
    calories = last.calories;
    protein = last.protein;
  }
  const line = [item.brand, portion, `${shownNumber(protein)} g protein`].filter(Boolean).join(', ');
  return { line, kcal: Number.isFinite(calories) ? String(Math.round(calories)) : '—' };
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
    <View style={styles.thumbSlot}>
      <FoodImage name={item.name || '?'} size={48} />
    </View>
  );
}

function FoodRow({ item, onPress }: { item: SearchResult; onPress: () => void }) {
  const styles = makeStyles(useTheme().semanticColors);
  const facts = foodRowFacts(item);
  return (
    <HapticPressable
      intent="light"
      style={styles.searchResultItem}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${facts.line}, ${facts.kcal} kcal`}
    >
      <FoodThumb item={item} />
      <View style={styles.searchResultLeft}>
        <Text style={styles.searchResultName}>{item.name}</Text>
        <Text style={styles.searchResultMacros}>{facts.line}</Text>
      </View>
      <Text style={styles.searchResultCals}>{facts.kcal}</Text>
    </HapticPressable>
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
  const searchingNow = searchQuery.length >= 2;

  return (
    <View style={styles.modalBody}>
      {!searchingNow ? (
        <View style={styles.toolsRow}>
          <HapticPressable
            intent="light"
            style={styles.toolTile}
            onPress={onEnterManualMode}
            accessibilityRole="button"
          >
            <Ionicons name="create-outline" size={22} color={sc.accentText} />
            <Text style={styles.toolTileText}>Enter manually</Text>
          </HapticPressable>
        </View>
      ) : null}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={colors.graphite} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search foods..."
          placeholderTextColor={colors.graphite}
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
            <FoodRow key={`dym-${idx}`} item={item} onPress={() => onSelectFood(item)} />
          ))}
        </View>
      )}

      <FlatList
        data={showList}
        keyExtractor={(item, index) => `${item.id || item.name}-${index}`}
        ListHeaderComponent={
          searchQuery.length < 2 && browseList.length === 0 ? (
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
        renderItem={({ item }) => <FoodRow item={item} onPress={() => onSelectFood(item)} />}
        ListFooterComponent={searchingNow ? (
          <TextLink label="Enter manually" tone="accent" onPress={onEnterManualMode} style={styles.manualLink} />
        ) : null}
        contentContainerStyle={styles.searchList}
        keyboardShouldPersistTaps="handled"
      />

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
  clearButton: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  modalBody: {
    flex: 1,
  },
  toolsRow: { flexDirection: 'row', marginHorizontal: layout.gutter, marginTop: 8 },
  toolTile: {
    minWidth: '31%',
    minHeight: 88,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: sc.accent,
  },
  toolTileText: { fontFamily: typography.bodyMd.fontFamily, fontSize: 16, lineHeight: 21, color: sc.accentText },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: layout.gutter,
    marginTop: 16,
    marginBottom: 8,
    gap: 10,
    minHeight: layout.buttonHeight,
    borderBottomWidth: 1,
    borderBottomColor: sc.textPrimary,
  },
  searchInput: {
    minHeight: 44, fontFamily: 'Inter_400Regular',
    flex: 1,
    fontSize: 17,
    color: sc.textPrimary,
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: layout.gutter,
    marginTop: 8,
    gap: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  tabChipActive: {
    borderBottomColor: gold[300],
  },
  tabChipText: {
    fontSize: 16,
    color: colors.graphite,
  },
  foodThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.input,
    marginRight: 16,
  },
  thumbSlot: { marginRight: 16 },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    minHeight: layout.rowMinHeight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  searchResultName: {
    fontFamily: typography.h2.fontFamily,
    fontSize: 21,
    lineHeight: 27,
    color: sc.textPrimary,
  },
  searchResultMacros: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.graphite,
    fontVariant: ['tabular-nums'],
  },
  searchResultCals: {
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 16,
    color: sc.textPrimary,
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  manualLink: { marginTop: 16 },
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
  tabChip: {
    minHeight: layout.touchMin,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
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
  searchResultLeft: {
    flex: 1,
    marginRight: 12,
  },
});
