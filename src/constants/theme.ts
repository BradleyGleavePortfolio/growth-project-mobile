import { StyleSheet } from 'react-native';
import Colors from './colors';

export const Typography = {
  hero: { fontSize: 32, fontWeight: '800' as const, color: Colors.textPrimary, letterSpacing: -0.5 },
  h1: { fontSize: 26, fontWeight: '700' as const, color: Colors.textPrimary },
  h2: { fontSize: 22, fontWeight: '700' as const, color: Colors.textPrimary },
  h3: { fontSize: 18, fontWeight: '600' as const, color: Colors.textPrimary },
  h4: { fontSize: 16, fontWeight: '600' as const, color: Colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.textPrimary, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, color: Colors.textSecondary, lineHeight: 19 },
  caption: { fontSize: 11, fontWeight: '500' as const, color: Colors.textMuted, letterSpacing: 0.3 },
  label: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  button: { fontSize: 15, fontWeight: '700' as const, letterSpacing: 0.3 },
  number: { fontSize: 28, fontWeight: '800' as const, color: Colors.textPrimary },
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const Radius = {
  sm: 8, md: 12, lg: 16, xl: 24, full: 999,
};

export const Shadow = {
  small: {
    shadowColor: Colors.cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  medium: {
    shadowColor: Colors.cardShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 6,
  },
};

export const GlobalStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.small,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  primaryButtonText: { ...Typography.button, color: Colors.textOnPrimary },
  secondaryButton: {
    backgroundColor: Colors.primaryPale,
    borderRadius: Radius.full,
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  secondaryButtonText: { ...Typography.button, color: Colors.primary },
  sectionTitle: { ...Typography.h3, marginBottom: Spacing.sm },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: 15,
    color: Colors.textPrimary,
  },
});

export default { Colors, Typography, Spacing, Radius, Shadow, GlobalStyles };
