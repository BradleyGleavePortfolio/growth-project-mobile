/**
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3; frame S1_F12): a day plan meal's time. A cream sheet in its
 * own Modal over the dimmed builder (ink at 0.42, as StyleCSheet), with iOS's own time wheel in 5-minute steps. It
 * opens at the stored time, else at the label's hour; nothing is stored until Set. No time stores none; Close, the
 * scrim and Android back store nothing (R8). A stored time off the 5-minute grid goes back unchanged unless moved.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, layout, radius, typography, withAlpha } from '../../../theme/tokens';
import { useBottomInset } from '../../../ui/layout/StyleCPage';
import { PrimaryButton, TextLink } from '../../../ui/buttons/PrimaryButton';
import { clockOf, minutesOf } from '../../../utils/log/foodTimeline';
import type { DailyMealPlanSlot } from '../../../api/mealTemplatesApi';
import { SLOT_NAMES, mealStyles as ms } from './mealUi';
import { fromWheel, openingTime, toWheel } from './mealLinks';

export function MealTimeSheet({ slot, planName, onClose, onSet }: {
  slot: DailyMealPlanSlot | null; planName: string; onClose: () => void; onSet: (slot: DailyMealPlanSlot, time: string | null) => void;
}) {
  const { semanticColors: sc } = useTheme();
  const bottom = useBottomInset();
  const [moved, setMoved] = useState<string>();
  const [dialog, setDialog] = useState(false);
  useEffect(() => { setMoved(undefined); setDialog(false); }, [slot]);
  const at = moved ?? (slot ? openingTime(slot.time_of_day, slot.slot_label) : '12:00');
  const clock = clockOf(minutesOf(at) ?? 0);
  const onWheel = (e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS !== 'ios') setDialog(false); // Android's own dialog closes on any answer (MealPlanAssignScreen)
    if (e.type === 'set' && d) setMoved(fromWheel(d));
  };
  const wheel = <DateTimePicker testID="time-wheel" mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} minuteInterval={5}
    value={toWheel(at)} onChange={onWheel} textColor={sc.textPrimary} />;
  return (
    <Modal visible={!!slot} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable testID="time-scrim" style={[styles.scrim, { backgroundColor: withAlpha(sc.textPrimary, 0.42) }]} onPress={onClose}
        accessible={false} importantForAccessibility="no" />
      {slot ? (
        <View testID="time-sheet" accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.cream, paddingBottom: bottom + 12 }]}>
          <View style={[styles.grab, { backgroundColor: sc.border }]} />
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[ms.cardTitle, ms.fill, { color: sc.textPrimary }]}>{`${SLOT_NAMES[slot.slot_label]} time`}</Text>
            <Pressable testID="time-close" accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={26} color={sc.textPrimary} />
            </Pressable>
          </View>
          <Text style={[typography.body, { color: sc.textMuted }]}>{`${slot.meal_template.name} · ${planName}`}</Text>
          <View style={[styles.wheel, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
            {Platform.OS === 'ios' ? wheel : (
              <Pressable accessibilityRole="button" accessibilityLabel={clock} onPress={() => setDialog(true)} style={styles.close}>
                <Text style={[typography.h2, { color: sc.textPrimary }]}>{clock}</Text>
              </Pressable>
            )}
            {Platform.OS !== 'ios' && dialog ? wheel : null}
          </View>
          <View style={styles.line}>
            <Ionicons name="globe-outline" size={20} color={sc.textMuted} style={styles.glyph} />
            <Text style={[typography.body, ms.fill, { color: sc.textPrimary }]}>Clients see this time on their own clock.</Text>
          </View>
          <PrimaryButton label={`Set ${clock}`} wrap testID="time-set" onPress={() => onSet(slot, at)} />
          <TextLink label="No time" tone="accent" testID="time-none" onPress={() => onSet(slot, null)} />
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, marginBottom: -radius.sheet },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: layout.gutter, paddingTop: 10, gap: 14 },
  grab: { width: 40, height: 5, borderRadius: radius.chip, alignSelf: 'center', marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  wheel: { borderWidth: 1, borderRadius: radius.card, alignItems: 'center', overflow: 'hidden' },
  line: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  glyph: { marginTop: 3 },
});
