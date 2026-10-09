import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import { Headline, Lede, PrimaryButton, footerBottomPadding, useScreenInsets } from '../../../ui';
import type { SemanticTokens } from '../../../theme/tokens';
import type { HabitsStyles } from './styles';

/** Bottom sheet for a new habit: rounded top corners, one forest action. */
export function AddHabitSheet({
  visible,
  onClose,
  newName,
  setNewName,
  newTarget,
  setNewTarget,
  newUnit,
  setNewUnit,
  onAdd,
  isSaving,
  sc,
  styles,
}: {
  visible: boolean;
  onClose: () => void;
  newName: string;
  setNewName: (s: string) => void;
  newTarget: string;
  setNewTarget: (s: string) => void;
  newUnit: string;
  setNewUnit: (s: string) => void;
  onAdd: () => void;
  isSaving: boolean;
  sc: SemanticTokens;
  styles: HabitsStyles;
}) {
  const insets = useScreenInsets();

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: footerBottomPadding(insets.bottom) }]} testID="add-habit-sheet">
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <Headline level="h2">New habit</Headline>
            <HapticPressable
              intent="light"
              disableAnimation
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close new habit"
            >
              <Ionicons name="close" size={22} color={sc.textPrimary} />
            </HapticPressable>
          </View>
          <Lede size="small">One thing to do each day, with this week shown beside it.</Lede>

          <Text style={styles.fieldLabel}>Habit name</Text>
          <TextInput
            style={styles.fieldInput}
            accessibilityLabel="Habit name"
            placeholder="e.g. Drink 8 glasses of water"
            placeholderTextColor={sc.textMuted}
            value={newName}
            onChangeText={setNewName}
            maxLength={60}
          />

          <View style={styles.targetRow}>
            <View style={styles.targetField}>
              <Text style={styles.fieldLabel}>Target</Text>
              <TextInput
                style={styles.fieldInput}
                accessibilityLabel="Habit target"
                placeholder="1"
                placeholderTextColor={sc.textMuted}
                value={newTarget}
                onChangeText={setNewTarget}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.targetField}>
              <Text style={styles.fieldLabel}>Unit</Text>
              <TextInput
                style={styles.fieldInput}
                accessibilityLabel="Habit unit"
                placeholder="times"
                placeholderTextColor={sc.textMuted}
                value={newUnit}
                onChangeText={setNewUnit}
              />
            </View>
          </View>

          <PrimaryButton
            label={isSaving ? 'Creating habit' : 'Create habit'}
            onPress={onAdd}
            loading={isSaving}
            disabled={!isSaving && !newName.trim()}
            style={styles.sheetSave}
            testID="add-habit-create"
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
