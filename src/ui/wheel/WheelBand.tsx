/**
 * WheelBand: the selection band shared by every wheel (B19, prototype 07-09).
 * Two hairlines frame the middle row; there is no fill, so the band can never
 * hide the selected value. Render it as the FIRST child of the wheel frame,
 * before the ScrollView, so it also sits behind the values in z-order.
 */
import React from 'react';
import { View, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { wheel, type SemanticTokens } from '../../theme/tokens';

export interface WheelBandProps {
  rowHeight?: number;
  visibleRows?: number;
  testID?: string;
}

/** Frame for a wheel column: exactly visibleRows rows tall, clipped. */
export function wheelFrameStyle(rowHeight: number = wheel.rowHeight, visibleRows: number = wheel.visibleRows): ViewStyle {
  return { height: rowHeight * visibleRows, overflow: 'hidden' };
}

export function wheelBandStyle(
  borderColor: string,
  rowHeight: number = wheel.rowHeight,
  visibleRows: number = wheel.visibleRows,
): ViewStyle {
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    top: rowHeight * Math.floor(visibleRows / 2),
    height: rowHeight,
    borderTopWidth: wheel.bandHairline,
    borderBottomWidth: wheel.bandHairline,
    borderColor,
    backgroundColor: 'transparent',
  };
}

export function WheelBand({ rowHeight, visibleRows, testID }: WheelBandProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  return <View pointerEvents="none" testID={testID} style={wheelBandStyle(sc.border, rowHeight, visibleRows)} />;
}

/** Text style for a wheel value by its distance (in rows) from the selected row. */
export function wheelValueStyle(distance: number, sc: Pick<SemanticTokens, 'textPrimary' | 'textMuted'>): TextStyle {
  const d = Math.abs(distance);
  if (d === 0) {
    const { fontFamily, fontSize, lineHeight, fontWeight } = wheel.selected;
    return { fontFamily, fontSize, lineHeight, fontWeight, color: sc.textPrimary, fontVariant: ['tabular-nums'] };
  }
  const role = d === 1 ? wheel.near : wheel.far;
  const { fontFamily, fontSize, lineHeight, fontWeight, opacity } = role;
  return { fontFamily, fontSize, lineHeight, fontWeight, opacity, color: sc.textMuted, fontVariant: ['tabular-nums'] };
}
