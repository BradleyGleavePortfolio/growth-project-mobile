import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../../theme/ThemeProvider';

export const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topCenter: { alignItems: 'center' },
  topTitle: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  timerText: { fontSize: 20, fontWeight: '500', color: colors.primary, marginTop: 2 },
  finishBtn: {
    backgroundColor: colors.primary,
    borderRadius: 0, // radius.sm
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  finishBtnText: { color: colors.textOnPrimary, fontSize: 14, fontWeight: '500' },
  progressBar: {
    height: 3,
    backgroundColor: colors.primaryPale,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  content: { paddingVertical: 16, paddingBottom: 100 },
  exerciseCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
  },
  exerciseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  exerciseName: { fontSize: 16, fontWeight: '500', color: colors.primary },
  setHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  setHeaderText: { fontSize: 11, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    paddingVertical: 4,
    borderRadius: 0, // radius.sm
  },
  setRowCompleted: { backgroundColor: colors.primaryPale },
  setText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  setInput: {
    backgroundColor: colors.background,
    borderRadius: 0, // radius.sm
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  checkBtn: {
    width: 32,
    height: 32,
    borderRadius: 0, // radius.sm
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkBtnDone: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    marginTop: 4,
  },
  addSetText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  addExerciseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addExerciseText: { fontSize: 15, fontWeight: '500', color: colors.primary },

  // Modal
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '500', color: colors.textPrimary },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 2, // radius.md
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.textPrimary },
  muscleFilter: { maxHeight: 44, marginBottom: 8 },
  muscleFilterContent: { paddingHorizontal: 20, gap: 8 },
  muscleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  muscleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  muscleChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  muscleChipTextActive: { color: colors.textOnPrimary },
  exerciseList: { paddingHorizontal: 16, paddingBottom: 40 },

  // Exercise list item with image
  exerciseListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  exerciseListInfo: {
    flex: 1,
    gap: 4,
  },
  exerciseListName: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  muscleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
  },
  muscleBadgeText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  exerciseListEquipment: { fontSize: 12, color: colors.textMuted },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 24,
    gap: 8,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
    marginTop: 8,
  },
  emptyStateSubtext: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },

  // Rest Timer Overlay
  restOverlay: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  restLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  restLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  restCountdown: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  restSkip: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },

  });

export type ActiveWorkoutStyles = ReturnType<typeof makeStyles>;
