import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrMatrix, qrPath } from '../../lib/qrMatrix';

const QUIET = 4;

/**
 * Black-on-white QR for a join link (always high contrast, whatever the app
 * theme, so phone cameras read it from a screen or a printout).
 */
export default function CodeQr({ value, size, code }: { value: string; size: number; code: string }) {
  const { side, d } = useMemo(() => {
    const m = qrMatrix(value);
    return { side: m.size + QUIET * 2, d: qrPath(m, QUIET) };
  }, [value]);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`QR code for invite code ${code}`}
      testID="coach-code-qr"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${side} ${side}`}>
        <Rect x={0} y={0} width={side} height={side} fill="#FFFFFF" />
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  );
}
