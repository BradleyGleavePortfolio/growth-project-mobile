/**
 * QuietRow: the one list row (QA-PRIM-128, DESIGN-QA-128 drift 16). A
 * hairline-separated row with an Inter label, an optional muted tabular
 * value and an outline chevron when it navigates. No fill, no box.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, typography } from '../../theme/tokens';
import { HapticService } from '../haptics/haptics.service';

export interface QuietRowProps {
  label: string;
  /** Right-aligned value (tabular numerals). */
  value?: string;
  /** Second line under the label. */
  detail?: string;
  onPress?: () => void;
  /** Defaults to true when the row is pressable. */
  chevron?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function QuietRow({
  label,
  value,
  detail,
  onPress,
  chevron,
  accessibilityHint,
  testID,
  style,
}: QuietRowProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const showChevron = chevron ?? !!onPress;
  const a11yLabel = [label, detail, value].filter(Boolean).join(', ');
  const body = (
    <>
      <View style={styles.text}>
        <Text style={[styles.label, { color: sc.textPrimary }]}>{label}</Text>
        {detail ? <Text style={[styles.detail, { color: sc.textMuted }]}>{detail}</Text> : null}
      </View>
      {value ? <Text style={[styles.value, { color: sc.textMuted }]}>{value}</Text> : null}
      {showChevron ? <Ionicons name="chevron-forward" size={18} color={sc.textMuted} style={styles.chevron} /> : null}
    </>
  );
  const rowStyle = [styles.row, { borderBottomColor: sc.border }, style];
  if (!onPress) {
    return (
      <View testID={testID} style={rowStyle} accessible accessibilityLabel={a11yLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        void HapticService.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.rowMinHeight,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, paddingRight: 12 },
  label: { ...typography.body, lineHeight: 22 },
  detail: { ...typography.bodySmall, marginTop: 2 },
  value: { ...typography.body, lineHeight: 22, fontVariant: ['tabular-nums'] },
  chevron: { marginLeft: 8 },
  pressed: { opacity: 0.6 },
});
