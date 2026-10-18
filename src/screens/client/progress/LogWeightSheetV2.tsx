/**
 * C8 v2 Log weight (index-v2 section 1, `weighin`): a cream sheet with the
 * number in a forest band, 0.1 steppers and the last weigh-in for context,
 * prefilled so most mornings are one tap on Save. Pounds go to the server;
 * the client sees and types their own unit. Weigh-ins always reach the
 * current coach (#SHARE-SIMPLE), so the line says so and offers no switch.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { weightApi } from '../../../services/api';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { Headline, PrimaryButton } from '../../../ui';
import { errorMessage } from '../../../types/common';
import type { WeightLog } from '../../../types';
import { lastWas, monthDay, one, toLbs, toUnit, type WeightUnit } from './progressV2';

/** The server takes 40 to 1,500 lb; the kg bounds stay inside it once converted. */
const BOUNDS = { lb: [40, 1500], kg: [18.2, 680] } as const;

export interface LogWeightSheetV2Props {
  visible: boolean;
  unit: WeightUnit;
  today: string;
  lastLog: WeightLog | null;
  /** The coach's first name; null for a coachless client (no sharing line). Undefined while it loads. */
  coachName: string | null | undefined;
  onClose: () => void;
  onSaved: (lbs: number) => void;
}

export default function LogWeightSheetV2({ visible, unit, today, lastLog, coachName, onClose, onSaved }: LogWeightSheetV2Props) {
  const { semanticColors: sc } = useTheme();
  const { width } = useWindowDimensions();
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (visible) { setText(lastLog ? one(toUnit(lastLog.weight, unit)) : ''); setNotes(''); }
  }, [visible, lastLog, unit]);

  const [lo, hi] = BOUNDS[unit];
  const value = parseFloat(text.replace(',', '.'));
  const step = (d: number) => {
    void HapticService.selection();
    setText(one(Math.min(hi, Math.max(lo, (Number.isNaN(value) ? toUnit(lastLog?.weight ?? 0, unit) : value) + d))));
  };
  const save = async () => {
    if (busy.current) return;
    if (Number.isNaN(value) || value < lo || value > hi) {
      void HapticService.warning();
      Alert.alert('Weight not saved', Number.isNaN(value) ? 'Enter your weight as a number.'
        : `Enter a weight between ${lo} and ${hi.toLocaleString('en-US')} ${unit}.`);
      return;
    }
    Keyboard.dismiss();
    busy.current = true;
    setSaving(true);
    const lbs = Math.round(toLbs(value, unit) * 100) / 100;
    try {
      await weightApi.log({ weight_lbs: lbs, date: today, notes: notes.trim() || undefined });
    } catch (err) {
      void HapticService.error();
      Alert.alert("Couldn't log weight", errorMessage(err, 'Please try again.'));
      return;
    } finally {
      busy.current = false;
      setSaving(false);
    }
    void HapticService.success();
    onSaved(lbs);
  };

  const was = lastWas(lastLog, unit, today);
  // Sized to its digits (about half an em each) so the unit sits beside the number on every platform.
  const size = Math.min(56, width * 0.15);
  const muted = { color: sc.textOnMastheadMuted };
  const stepper = (d: number, icon: 'remove' | 'add', label: string) => (
    <Pressable onPress={() => step(d)} accessibilityRole="button" accessibilityLabel={label} testID={`log-weight-${icon}`}
      style={[s.step, { borderColor: sc.textOnMastheadMuted }]}>
      <Ionicons name={icon} size={22} color={sc.textOnAccent} />
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[s.fill, s.end, { backgroundColor: sc.overlay }]} onPress={Keyboard.dismiss} accessible={false}>
          <Pressable style={[s.sheet, { backgroundColor: sc.bgSurface }]} onPress={Keyboard.dismiss} accessible={false} testID="log-weight-sheet">
            <View style={s.row}>
              <Headline level="h2">Log weight</Headline>
              <Pressable onPress={onClose} style={s.close} accessibilityRole="button" accessibilityLabel="Close log weight modal" testID="log-weight-close">
                <Ionicons name="close" size={24} color={sc.textPrimary} />
              </Pressable>
            </View>
            <Text style={[s.date, { color: sc.textPrimary, borderBottomColor: sc.border }]}>Today, {monthDay(today)}</Text>
            <View style={[s.band, { backgroundColor: sc.surface.forestBand }]}>
              <View style={s.row}>
                {stepper(-0.1, 'remove', `0.1 ${unit} less`)}
                <View style={[s.number, { borderBottomColor: sc.data.trend }]}>
                  <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" maxFontSizeMultiplier={1}
                    accessibilityLabel={unit === 'kg' ? 'Weight in kilograms' : 'Weight in pounds'} testID="log-weight-input"
                    style={[s.value, { color: sc.textOnAccent, fontSize: size, lineHeight: size * 1.25, width: size * 0.5 * Math.max(4, text.length) }]} />
                  <Text style={[s.unit, muted]}>{unit}</Text>
                </View>
                {stepper(0.1, 'add', `0.1 ${unit} more`)}
              </View>
              {was ? <Text style={[s.small, s.center, muted]}>{was}</Text> : null}
            </View>
            <TextInput value={notes} onChangeText={setNotes} placeholder="Notes (optional)" placeholderTextColor={sc.textMuted}
              maxLength={500} accessibilityLabel="Enter optional notes" testID="log-weight-notes"
              style={[s.notes, { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgPrimary }]} />
            {coachName !== null ? (
              <View style={[s.row, s.share]} testID="log-weight-sharing">
                <View style={[s.avatar, { backgroundColor: sc.surface.forestBand }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Text style={[s.initial, { color: sc.textOnAccent }]}>{(coachName ?? 'C').charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={[s.small, s.flex, { color: sc.textPrimary }]}>{coachName ?? 'Your coach'} sees weigh-ins.</Text>
              </View>
            ) : null}
            <PrimaryButton label={saving ? 'Saving' : 'Save'} accessibilityLabel={saving ? 'Saving' : 'Save weight log entry'}
              onPress={() => { void save(); }} disabled={!text.trim()} loading={saving} haptic={false} testID="log-weight-save" />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  end: { justifyContent: 'flex-end' },
  center: { textAlign: 'center' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  date: { ...typography.body, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  band: { borderRadius: radius.card, padding: 16, gap: 8 },
  step: { width: 48, height: 48, borderRadius: radius.button, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  number: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1, minWidth: 0, gap: 6, borderBottomWidth: 2, paddingHorizontal: 8 },
  value: { fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400', fontVariant: ['lining-nums', 'tabular-nums'], flexShrink: 1, minWidth: 0, textAlign: 'center', padding: 0 },
  unit: { ...typography.bodyMd },
  small: { ...typography.bodySmall },
  notes: { ...typography.body, borderRadius: radius.input, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 14 },
  share: { justifyContent: 'flex-start', gap: 12 },
  avatar: { width: 28, height: 28, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', fontSize: 16, lineHeight: 20 },
});
