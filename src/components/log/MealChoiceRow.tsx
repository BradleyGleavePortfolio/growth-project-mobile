// The one meal choice (owner #UI-3d, "as your add-food design draws"): a cream track with four equal segments, Breakfast,
// Lunch, Dinner, Snacks, the chosen one on the surface with a hairline. The search sheet's Extras "Add" and the food edit
// sheet both use it. At 130% text, or when the longest name does not fit a quarter of the track, it is two rows of two,
// never three and one.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useTheme } from '../../theme/useTheme';
import { colors as palette, layout, radius, typography, type SemanticTokens } from '../../theme/tokens';
import { MEAL_SECTIONS } from '../../utils/log/types';
import type { MealType } from '../../types';

// Board .seg: 3 pt inset, 2 pt between segments; the segment corner sits concentric inside the track's.
const INSET = 3;
const GAP = 2;
const SIDE = 6;
const LONGEST = MEAL_SECTIONS.reduce((a, m) => (m.label.length > a.length ? m.label : a), '');

interface Props {
  value: MealType;
  onChange: (meal: MealType) => void;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export default function MealChoiceRow({ value, onChange, disabled, testID, style }: Props) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const { fontScale } = useWindowDimensions();
  const [track, setTrack] = useState(0);
  const [longest, setLongest] = useState(0);
  const quarter = (track - 2 * INSET - 3 * GAP) / 4;
  const stacked = fontScale >= 1.3 || (track > 0 && longest + 2 * SIDE > quarter);
  const rows = stacked ? [MEAL_SECTIONS.slice(0, 2), MEAL_SECTIONS.slice(2)] : [MEAL_SECTIONS];

  return (
    <View testID={testID} accessibilityRole="radiogroup" style={[s.track, style]} onLayout={(e) => setTrack(e.nativeEvent.layout.width)}>
      {/* The longest name at the client's text size, unconstrained, unseen and untouchable: it tells the row when it cannot fit. */}
      <View aria-hidden pointerEvents="none" style={s.measure}>
        <Text testID="meal-choice-measure" style={s.label} onLayout={(e) => setLongest(e.nativeEvent.layout.width)}>{LONGEST}</Text>
      </View>
      {rows.map((row) => (
        <View key={row[0].type} testID="meal-choice-line" style={s.row}>
          {row.map((meal) => {
            const on = meal.type === value;
            return (
              <Pressable key={meal.type} disabled={disabled} accessibilityRole="radio" accessibilityLabel={meal.label}
                accessibilityState={{ checked: on }} style={[s.seg, on && s.segOn]}
                onPress={() => { void HapticService.softImpact(); onChange(meal.type); }}>
                <Text style={[s.label, on && s.labelOn]}>{meal.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  track: { backgroundColor: palette.cream, borderRadius: radius.input, padding: INSET, gap: GAP },
  row: { flexDirection: 'row', gap: GAP },
  seg: { flex: 1, minWidth: 0, minHeight: layout.touchMin, paddingHorizontal: SIDE, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.input - INSET, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  segOn: { backgroundColor: sc.bgSurface, borderColor: sc.border },
  label: { fontFamily: typography.bodyMd.fontFamily, fontSize: 13, lineHeight: 16, color: sc.textMuted, textAlign: 'center' },
  labelOn: { color: sc.textPrimary },
  measure: { position: 'absolute', top: 0, left: 0, opacity: 0 },
});
