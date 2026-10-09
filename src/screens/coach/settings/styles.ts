import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';

// REDO-COACH-133 (QA-COACH-SET-129 visual pass, coach-home-solo reference):
// bone page, serif title and name, 11 pt overlines, rounded hairline groups
// with no cream fills (owner 17:07: rounded, not rectangles), 56 pt rows,
// sentence case, radius from the tokens only. Insets come from the screen.

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
    paddingHorizontal: layout.gutter,
    marginBottom: 12,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: layout.gutter,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 16,
    marginBottom: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    ...typography.h3,
    color: colors.textSecondary,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  profileEmail: {
    ...typography.bodySmall,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  profileRole: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: 4,
  },
  sectionHeader: {
    marginHorizontal: layout.gutter,
    marginBottom: 10,
    marginTop: 4,
  },
  // A rounded hairline group, no fill and no shadow.
  section: {
    marginHorizontal: layout.gutter,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.card,
    marginBottom: layout.sectionGap + 4,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.rowMinHeight,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 14,
  },
  rowLabel: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },
  rowSubLabel: {
    ...typography.bodySmall,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowValue: {
    ...typography.bodySmall,
    fontSize: 14,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  rowValueMuted: {
    ...typography.bodySmall,
    fontSize: 14,
    color: colors.textMuted,
    maxWidth: 140,
  },
  rowValueHighlight: {
    ...typography.h3,
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 50,
  },
  // Quiet outlined action: signing out is not an alarm, so no red.
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: layout.gutter,
    minHeight: layout.buttonHeight,
    borderRadius: radius.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textSecondary,
    marginBottom: 28,
  },
  signOutText: {
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
  aboutSection: {
    alignItems: 'center',
    paddingBottom: 20,
    gap: 4,
  },
  aboutText: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textMuted,
  },
  aboutSubText: {
    ...typography.eyebrow,
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
    backgroundColor: colors.background,
    borderRadius: radius.card,
    padding: 24,
  },
  modalTitle: {
    ...typography.h2,
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.input,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  bioInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    height: 100,
  },
  charCount: {
    ...typography.bodySmall,
    fontSize: 13,
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
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalCancelText: {
    ...typography.bodyMd,
    fontSize: 15,
    color: colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalSaveText: {
    ...typography.bodyMd,
    fontSize: 15,
    color: colors.textOnPrimary,
  },

  });

export type SettingsStyles = ReturnType<typeof makeStyles>;
