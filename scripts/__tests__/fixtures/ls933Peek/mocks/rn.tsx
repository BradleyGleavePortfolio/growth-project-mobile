// Harness-only shim for 'react-native' -> react-native-web, with a Text that
// honours a simulated system font scale (iOS Dynamic Type / Android font size):
// fontSize and lineHeight scale by the factor, capped by maxFontSizeMultiplier,
// and allowFontScaling={false} opts out, as React Native does on device.
import React from 'react';
import * as RNW from 'react-native-web';

export * from 'react-native-web';

const scale = (): number => (globalThis as any).__CFG?.fontScale ?? 1;

export const Text = React.forwardRef<any, any>(function ScaledText(props, ref) {
  const s = scale();
  if (s === 1 || props.allowFontScaling === false) return <RNW.Text ref={ref} {...props} />;
  const cap = props.maxFontSizeMultiplier;
  const m = cap == null || cap === 0 ? s : Math.min(s, Math.max(1, cap));
  const flat: any = RNW.StyleSheet.flatten(props.style) || {};
  const style = {
    ...flat,
    ...(typeof flat.fontSize === 'number' ? { fontSize: flat.fontSize * m } : {}),
    ...(typeof flat.lineHeight === 'number' ? { lineHeight: flat.lineHeight * m } : {}),
  };
  return <RNW.Text ref={ref} {...props} style={style} />;
});

export function useWindowDimensions() {
  const d = RNW.useWindowDimensions();
  return { ...d, fontScale: scale() };
}

export const findNodeHandle = (RNW as any).findNodeHandle ?? ((x: any) => x ?? null);

// react-native-web always reports a screen reader; the harness says no (motion renders need it).
// PEEK-K1-M2: reduce motion on, so the week ring's one-time draw shows its end state in a still picture.
export const AccessibilityInfo = { ...(RNW as any).AccessibilityInfo, isScreenReaderEnabled: () => Promise.resolve(false), isReduceMotionEnabled: () => Promise.resolve(true) };
