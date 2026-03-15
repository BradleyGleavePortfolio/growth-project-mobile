// The Growth Project — Central Theme
// All colors, typography, and design tokens live here.
// NEVER hardcode hex values in component files — always import from here.

export const Colors = {
  primary: '#1A9EA0',
  gold: '#C5A467',
  orange: '#E88D67',
  dark: '#1C1F26',
  background: '#F5F0EA',
  surface: '#FFFFFF',
  textMuted: '#7A7974',
  success: '#2ECC71',
  warning: '#F39C12',
  error: '#E74C3C',
  white: '#FFFFFF',
  // Additional tokens
  border: '#E8E4DF',
  cardShadow: 'rgba(28, 31, 38, 0.08)',
  primaryLight: 'rgba(26, 158, 160, 0.12)',
  goldLight: 'rgba(197, 164, 103, 0.12)',
};

export const Typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: Colors.dark },
  h2: { fontSize: 22, fontWeight: '700' as const, color: Colors.dark },
  h3: { fontSize: 18, fontWeight: '600' as const, color: Colors.dark },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.textMuted },
  bodyDark: { fontSize: 15, fontWeight: '400' as const, color: Colors.dark },
  label: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary, letterSpacing: 0.5 },
  caption: { fontSize: 13, fontWeight: '400' as const, color: Colors.textMuted },
  button: { fontSize: 16, fontWeight: '600' as const },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const Shadow = {
  card: {
    shadowColor: Colors.dark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  button: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
};
