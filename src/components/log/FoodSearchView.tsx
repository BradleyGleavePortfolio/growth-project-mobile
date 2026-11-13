import React from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
  Image,
  useWindowDimensions,
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
import { SheetGlyph } from './AddSheetGlyphs';

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

const shownNumber = (value: number) => Number.isFinite(value) ? String(Math.round(value)) : '—';

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
  // REFINE-968 (ruling 6): with no photo, the C_add cream tile with its bowl.
  return <FoodImage name={item.name || '?'} size={48} drawn />;
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
  // "manually" is one long word: past 100% text it would run out of a third of the row, so the tile takes two shares.
  const wideTile = useWindowDimensions().fontScale > 1;
  const browseList = recentTab === 'recent' ? recentFoods : frequentFoods;
  const showList = searchQuery.length >= 2 ? searchResults : browseList;
  const showEmpty =
    searchQuery.length >= 2 && !searching && searchResults.length === 0 && didYouMean.length === 0;
  const searchingNow = searchQuery.length >= 2;

  return (
    <View style={styles.modalBody}>
      {!searchingNow ? (
        // REFINE-968 (C_add.html :121 .c-big2): the drawn three columns, main's manual entry in the first with main's
        // words (the drawn "Quick add" words wait: renaming the tile turns unlisted tests red, see m#968 FIX ROUND 1);
        // columns 2 and 3 hold their place for MEAL-PHOTO-M's Photo of a meal and a later barcode tile (never a dead tile).
        <View style={styles.toolsRow} testID="food-tools">
          <HapticPressable
            intent="light"
            containerStyle={[styles.toolCell, wideTile && styles.toolCellWide]}
            style={styles.toolTile}
            onPress={onEnterManualMode}
            accessibilityRole="button"
          >
            <Ionicons name="create-outline" size={24} color={sc.accentText} />
            <Text style={styles.toolTileText}>Enter manually</Text>
          </HapticPressable>
          <View style={styles.toolCell} />
          <View style={styles.toolCell} />
        </View>
      ) : null}
      <View style={[styles.searchBar, searchingNow && styles.searchBarAlone]} testID="food-search-line">
        <SheetGlyph name="search" size={22} color={sc.textMuted} />
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
            <Ionicons name="close-circle" size={18} color={colors.graphite} />
          </HapticPressable>
        )}
      </View>

      {searchError && (
        <View style={styles.searchErrorBanner} accessibilityRole="alert" testID="food-search-error">
          <Ionicons name="information-circle-outline" size={16} color={colors.graphite} />
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
        <View style={styles.tabRow} testID="food-search-tabs">
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
    marginTop: 12,
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
  repeatSubtitle: { fontSize: 13, lineHeight: 19, color: colors.graphite, marginTop: 2, fontVariant: ['tabular-nums'] },
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
  // REFINE-968, C_add.html :121-122 (.c-big2): three equal columns, gap 8, 12 above and below; the tile a 1 pt forest
  // border, corner 16, at least 72 tall, the 24 pt glyph above the label (gap 6), padding 8 12, Inter 500 15/19.
  toolsRow: { flexDirection: 'row', gap: 8, marginHorizontal: layout.gutter, marginTop: 12, marginBottom: 12 },
  toolCell: { flex: 1 },
  toolCellWide: { flex: 2 },
  toolTile: {
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    alignItems: 'flex-start',
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: sc.accent,
  },
  toolTileText: { fontFamily: typography.bodyMd.fontFamily, fontSize: 15, lineHeight: 19, color: sc.accentText },
  // :112 (.c-search): gap 10, a 1.5 pt ink underline, at least 50 tall.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: layout.gutter,
    gap: 10,
    minHeight: 50,
    borderBottomWidth: 1.5,
    borderBottomColor: sc.textPrimary,
  },
  searchBarAlone: { marginTop: 12 },
  searchInput: {
    minHeight: 44, fontFamily: 'Inter_400Regular',
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    color: sc.textPrimary,
  },
  // :113-115 (.c-tabs): gap 22, 10 above and 2 below, a 1 pt line under the row; each tab at least 44 tall, Inter 500 15
  // muted, the active one ink over a 2 pt gold underline (gold[300], the app's gold for this underline; #C9A961 is
  // only named for Roman).
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: layout.gutter,
    marginTop: 10,
    marginBottom: 2,
    gap: 22,
    borderBottomWidth: 1,
    borderBottomColor: sc.border,
  },
  tabChipActive: {
    borderBottomColor: gold[300],
  },
  tabChipText: {
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: sc.textMuted,
  },
  // :120 (.c-li .ph): the photo tile 48, corner 12.
  foodThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.input,
  },
  // :116 (.c-li): gap 12, at least 56 tall, padding 6 0, a line under (#EFE8DC is not a token: the hairline border).
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    minHeight: layout.rowMinHeight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  // :117 (.nm): Cormorant 500 18/23.4.
  searchResultName: {
    fontFamily: typography.h3.fontFamily,
    fontWeight: typography.h3.fontWeight,
    fontSize: 18,
    lineHeight: 23.4,
    color: sc.textPrimary,
  },
  // :118 (.st): Inter 13/18.2, muted.
  searchResultMacros: {
    fontSize: 13,
    lineHeight: 18.2,
    color: sc.textMuted,
    fontVariant: ['tabular-nums'],
  },
  // :119 (.k): Inter 500 14, charcoal.
  searchResultCals: {
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 14,
    color: colors.charcoal,
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  manualLink: { marginTop: 16 },
  searchErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: layout.gutter,
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  searchErrorText: {
    fontSize: 13,
    color: colors.graphite,
    flex: 1,
  },
  slowSearchBanner: {
    marginHorizontal: layout.gutter,
    marginTop: 8,
    marginBottom: 8,
  },
  slowSearchText: {
    fontSize: 13,
    color: colors.graphite,
  },
  tabChip: {
    minHeight: layout.touchMin,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabChipTextActive: {
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
    color: colors.graphite,
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
  },
});
