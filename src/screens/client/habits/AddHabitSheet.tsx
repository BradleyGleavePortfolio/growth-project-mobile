import React from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { IoniconName } from '../../../types/common';
import { HABIT_ICONS } from './constants';
import type { HabitsStyles } from './styles';

export function AddHabitSheet({
  visible,
  onClose,
  newName,
  setNewName,
  newIcon,
  setNewIcon,
  newColor,
  setNewColor,
  newTarget,
  setNewTarget,
  newUnit,
  setNewUnit,
  HABIT_COLORS,
  onAdd,
  colors,
  styles,
}: {
  visible: boolean;
  onClose: () => void;
  newName: string;
  setNewName: (s: string) => void;
  newIcon: string;
  setNewIcon: (s: string) => void;
  newColor: string;
  setNewColor: (s: string) => void;
  newTarget: string;
  setNewTarget: (s: string) => void;
  newUnit: string;
  setNewUnit: (s: string) => void;
  HABIT_COLORS: string[];
  onAdd: () => void;
  colors: ThemeColors;
  styles: HabitsStyles;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Habit</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>Habit Name</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="e.g. Drink 8 glasses of water"
            placeholderTextColor={colors.textMuted}
            value={newName}
            onChangeText={setNewName}
            maxLength={60}
          />

          <Text style={styles.fieldLabel}>Icon</Text>
          <View style={styles.iconGrid}>
            {HABIT_ICONS.map((item) => (
              <TouchableOpacity
                key={item.icon}
                style={[styles.iconOption, newIcon === item.icon && styles.iconOptionActive]}
                onPress={() => setNewIcon(item.icon)}
              >
                <Ionicons
                  name={item.icon as IoniconName}
                  size={20}
                  color={newIcon === item.icon ? colors.primary : colors.textMuted}
                />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Color</Text>
          <View style={styles.colorGrid}>
            {HABIT_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.colorOption, { backgroundColor: c }, newColor === c && styles.colorOptionActive]}
                onPress={() => setNewColor(c)}
              />
            ))}
          </View>

          <View style={styles.targetRow}>
            <View style={styles.targetField}>
              <Text style={styles.fieldLabel}>Target</Text>
              <TextInput
                style={styles.fieldInput}
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
                placeholder="times"
                placeholderTextColor={colors.textMuted}
                value={newUnit}
                onChangeText={setNewUnit}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.modalSaveBtn, !newName.trim() && styles.modalSaveBtnDisabled]}
            onPress={onAdd}
            disabled={!newName.trim()}
          >
            <Text style={styles.modalSaveBtnText}>Add Habit</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
