// Wave 5b: deprecated. New code should use `theme/tokens.ts` directly.
//
// Kept only because a handful of legacy callers may still reach for these
// raw scales. The 700 / 800 weights from earlier waves are gone — the
// quiet-luxury system caps display weight at 500.

export const FontSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  '5xl': 36,
} as const;

export const FontWeights = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
};
