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
import { Colors, typographyTokens } from '../../theme/index';
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

  return (
    <Modal testID="food-search-sheet" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {props.portionPicker ?? (
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <HapticPressable intent="light" onPress={onClose} disabled={props.saving} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close food search">
              <Ionicons name="close" size={24} color={Colors.dark} />
            </HapticPressable>
            <Text style={styles.modalTitle}>
              Add to {MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}
            </Text>
            {props.addedFoodName ? (
              <HapticPressable intent="light" onPress={onClose} disabled={props.saving} style={styles.closeButton} accessibilityRole="button">
                <Text style={styles.doneText}>Done</Text>
              </HapticPressable>
            ) : <View style={{ width: 44 }} />}
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

const styles = StyleSheet.create({
  doneText: { ...typographyTokens.bodyMd, fontSize: 15, color: Colors.primary },
  addedMessage: { ...typographyTokens.bodySmall, fontSize: 15, color: Colors.textSecondary, paddingHorizontal: 20, paddingVertical: 12 },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.dark,
  },
});
