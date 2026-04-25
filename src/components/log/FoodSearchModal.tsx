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
import { Colors } from '../../theme/index';
import { SearchResult, MEAL_SECTIONS } from '../../utils/log/types';
import { MealType } from '../../types';
import FoodSearchView from './FoodSearchView';
import ManualFoodEntryForm, { ManualFields } from './ManualFoodEntryForm';

interface Props {
  visible: boolean;
  activeMealType: MealType;
  onClose: () => void;

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

  manualMode: boolean;
  onEnterManualMode: () => void;
  onExitManualMode: () => void;

  manualFields: ManualFields;
  onManualFieldChange: (field: keyof ManualFields, value: string) => void;
  onManualLog: () => void;
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <HapticPressable intent="light" onPress={onClose}>
            <Ionicons name="close" size={24} color={Colors.dark} />
          </HapticPressable>
          <Text style={styles.modalTitle}>
            Add to {MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}
          </Text>
          <View style={{ width: 24 }} />
        </View>

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
            onSelectFood={props.onSelectFood}
            onEnterManualMode={onEnterManualMode}
          />
        ) : (
          <ManualFoodEntryForm
            fields={manualFields}
            onFieldChange={onManualFieldChange}
            onBack={onExitManualMode}
            onSubmit={onManualLog}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    fontWeight: '700',
    color: Colors.dark,
  },
});
