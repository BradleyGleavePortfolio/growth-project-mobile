import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../../theme/ThemeProvider';

export const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 24,
    borderRadius: 4, // radius.lg
    padding: 20,
    gap: 16,
    marginBottom: 28,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.textOnPrimary,
    fontSize: 20,
    fontWeight: '500',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  profileEmail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  profileRole: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '500',
    marginTop: 4,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 24,
    marginBottom: 8,
    marginTop: 4,
  },
  section: {
    marginHorizontal: 24,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    marginBottom: 24,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowSubLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowValue: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  rowValueMuted: {
    fontSize: 14,
    color: colors.textMuted,
    maxWidth: 140,
  },
  rowValueHighlight: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 48,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 2, // radius.md
    borderWidth: 1,
    borderColor: colors.error,
    marginBottom: 24,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
  aboutSection: {
    alignItems: 'center',
    paddingBottom: 20,
    gap: 2,
  },
  aboutText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  aboutSubText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  bioInput: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    height: 100,
  },
  charCount: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textOnPrimary,
  },

  });

export type SettingsStyles = ReturnType<typeof makeStyles>;
