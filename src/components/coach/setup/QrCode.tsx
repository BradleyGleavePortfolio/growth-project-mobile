/**
 * S-COACH — QR code for the coach's invite link, drawn with react-native-svg
 * from the vendored toqr encoder (MIT, src/vendor/toqr). No network call.
 */
import React, { useMemo } from "react";
import Svg, { Path, Rect } from "react-native-svg";
import { toQR } from "../../../vendor/toqr";

const EC_LEVEL_M = 0;
const QUIET_ZONE = 4;

/** Build one SVG path covering every dark module. Exported for tests. */
export function qrPath(value: string): { path: string; modules: number } {
  const bits = toQR(value, EC_LEVEL_M);
  const n = Math.round(Math.sqrt(bits.length));
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (bits[y * n + x]) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { path: d, modules: n + QUIET_ZONE * 2 };
}

interface Props {
  value: string;
  size?: number;
  /** Spoken description; the link itself is shown as text next to the code. */
  accessibilityLabel: string;
  testID?: string;
}

export default function QrCode({
  value,
  size = 200,
  accessibilityLabel,
  testID,
}: Props) {
  const { path, modules } = useMemo(() => qrPath(value), [value]);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {/* A QR code needs dark on light to scan, so these two colors are fixed. */}
      <Rect x={0} y={0} width={modules} height={modules} fill="#FFFFFF" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
