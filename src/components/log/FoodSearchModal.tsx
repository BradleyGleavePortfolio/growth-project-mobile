import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import HapticPressable from '../HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { layout, typography, type SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { TextLink, useScreenInsets } from '../../ui';
import { SearchResult, MEAL_SECTIONS } from '../../utils/log/types';
import { MealType } from '../../types';
import type { PastMeal } from '../../hooks/useFoodBrowse';
import FoodSearchView from './FoodSearchView';
import ManualFoodEntryForm, { ManualFields } from './ManualFoodEntryForm';

interface Props {
  visible: boolean;
  activeMealType: MealType;
  onClose: () => void;
  addedFoodName?: string | null;

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
  browseUnavailable?: boolean;

  onSelectFood: (food: SearchResult) => void;

  repeatMeal?: PastMeal | null;
  repeatMealTitle?: string;
  onRepeatMeal?: () => void;

  manualMode: boolean;
  onEnterManualMode: () => void;
  onExitManualMode: () => void;

  manualFields: ManualFields;
  onManualFieldChange: (field: keyof ManualFields, value: string) => void;
  onManualLog: () => void;
  saving?: boolean;
  portionPicker?: React.ReactNode;
}

export default function FoodSearchModal(props: Props) {
  const {
    visible,
    activeMealType,
    onClose,
    manualMode,
    onEnterManualMode,
    onExitManualMode,
    manualFields,
    onManualFieldChange,
    onManualLog,
  } = props;
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  // iOS presents a page sheet below the status bar; Android shows a full
  // edge-to-edge window, so only Android takes the top inset. Both take the
  // bottom one so the last action clears the home indicator / nav bar.
  const insets = useScreenInsets();
  const frame = {
    backgroundColor: sc.bgPrimary,
    paddingTop: Platform.OS === 'android' ? insets.top : 0,
    paddingBottom: insets.bottom,
  };

  return (
    <Modal testID="food-search-sheet" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {props.portionPicker ? (
        <View style={[styles.modalContainer, frame]}>{props.portionPicker}</View>
      ) : (
        <KeyboardAvoidingView
          style={[styles.modalContainer, frame]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <HapticPressable intent="light" onPress={onClose} disabled={props.saving} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close food search">
              <Ionicons name="close" size={22} color={sc.textPrimary} />
            </HapticPressable>
            <Text style={styles.modalTitle} accessibilityRole="header" numberOfLines={1}>
              Add to {MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}
            </Text>
            {props.addedFoodName ? (
              <TextLink label="Done" tone="accent" underline={false} disabled={props.saving} onPress={onClose} style={styles.closeButton} />
            ) : <View style={styles.closeButton} />}
          </View>

          {props.addedFoodName ? (
            <Text style={styles.addedMessage} accessibilityLiveRegion="polite">
              Added {props.addedFoodName}.
            </Text>
          ) : null}

          {!manualMode ? (
            <FoodSearchView
              searchQuery={props.searchQuery}
              onSearchChange={props.onSearchChange}
              onClearSearch={props.onClearSearch}
              onRetrySearch={props.onRetrySearch}
              searching={props.searching}
              showSlowMessage={props.showSlowMessage}
              searchError={props.searchError}
              searchResults={props.searchResults}
              didYouMean={props.didYouMean}
              recentTab={props.recentTab}
              onRecentTabChange={props.onRecentTabChange}
              recentFoods={props.recentFoods}
              frequentFoods={props.frequentFoods}
              browseUnavailable={props.browseUnavailable}
              onSelectFood={props.onSelectFood}
              repeatMeal={props.repeatMeal}
              repeatMealTitle={props.repeatMealTitle}
              onRepeatMeal={props.onRepeatMeal}
              saving={props.saving}
              onEnterManualMode={onEnterManualMode}
            />
          ) : (
            <ManualFoodEntryForm
              fields={manualFields}
              onFieldChange={onManualFieldChange}
              onBack={onExitManualMode}
              onSubmit={onManualLog}
              saving={props.saving}
            />
          )}
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  addedMessage: { ...typography.bodySmall, color: sc.accentText, paddingHorizontal: layout.gutter, paddingTop: 12 },
  closeButton: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter - 12,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  modalTitle: {
    ...typography.h3,
    flexShrink: 1,
    textAlign: 'center',
    color: sc.textPrimary,
  },
});
