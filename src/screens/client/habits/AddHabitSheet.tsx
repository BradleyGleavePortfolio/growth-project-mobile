import React from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { HabitsStyles } from './styles';

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
  colors,
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
  colors: ThemeColors;
  styles: HabitsStyles;
}) {
  const isDisabled = isSaving || !newName.trim();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New habit</Text>
            <TouchableOpacity style={styles.stepperBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close new habit">
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>Habit name</Text>
          <TextInput
            style={styles.fieldInput}
            accessibilityLabel="Habit name"
            placeholder="e.g. Drink 8 glasses of water"
            placeholderTextColor={colors.textMuted}
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
                placeholderTextColor={colors.textMuted}
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
                placeholderTextColor={colors.textMuted}
                value={newUnit}
                onChangeText={setNewUnit}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.modalSaveBtn, isDisabled && styles.modalSaveBtnDisabled]}
            onPress={onAdd}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: isDisabled, busy: isSaving }}
          >
            <Text style={[styles.modalSaveBtnText, isDisabled && { color: colors.textMuted }]}>
              {isSaving ? 'Creating habit' : 'Create habit'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
