/**
 * AIMealPlanDraftScreen — review/edit/approve an AI-generated meal
 * plan draft. Mirror of AIWorkoutDraftScreen but over days → meals →
 * items (with per-item macros).
 *
 * Flow:
 *   1. GET /coach/ai/drafts/:draftId on mount
 *   2. Render the MealPlanPayload as an editable structure.
 *   3. "Save edits" → POST /coach/ai/drafts/:draftId/edit { patch }
 *   4. "Approve & assign" → POST /coach/ai/drafts/:draftId/approve →
 *      navigate back to ClientDetail (meal-plan tab).
 *   5. "Reject" → reason modal → POST /coach/ai/drafts/:draftId/reject.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import coachAiApi from '../../api/coachAi';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type {
  AiMeal,
  AiMealDay,
  AiMealItem,
  Draft,
  MealPlanPayload,
} from '../../types/coachAi';
import { errorMessage } from '../../types/common';

type Nav = NativeStackNavigationProp<ClientsStackParamList, 'AIMealPlanDraft'>;
type R = RouteProp<ClientsStackParamList, 'AIMealPlanDraft'>;

function emptyPayload(): MealPlanPayload {
  return { title: null, summary: null, days: [] };
}

export default function AIMealPlanDraftScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { draftId, clientId, clientName } = route.params;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft<MealPlanPayload> | null>(null);
  const [payload, setPayload] = useState<MealPlanPayload>(emptyPayload());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await coachAiApi.getDraft<MealPlanPayload>(draftId);
      setDraft(res.data);
      setPayload(res.data.generatedPayload || emptyPayload());
      setDirty(false);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load draft.'));
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateDay = (dIdx: number, patch: Partial<AiMealDay>) => {
    setPayload((prev) => ({
      ...prev,
      days: prev.days.map((d, i) => (i === dIdx ? { ...d, ...patch } : d)),
    }));
    setDirty(true);
  };
  const updateMeal = (dIdx: number, mIdx: number, patch: Partial<AiMeal>) => {
    setPayload((prev) => ({
      ...prev,
      days: prev.days.map((d, i) =>
        i === dIdx
          ? {
              ...d,
              meals: d.meals.map((m, j) => (j === mIdx ? { ...m, ...patch } : m)),
            }
          : d,
      ),
    }));
    setDirty(true);
  };
  const updateItem = (
    dIdx: number,
    mIdx: number,
    iIdx: number,
    patch: Partial<AiMealItem>,
  ) => {
    setPayload((prev) => ({
      ...prev,
      days: prev.days.map((d, i) =>
        i === dIdx
          ? {
              ...d,
              meals: d.meals.map((m, j) =>
                j === mIdx
                  ? {
                      ...m,
                      items: m.items.map((it, k) =>
                        k === iIdx ? { ...it, ...patch } : it,
                      ),
                    }
                  : m,
              ),
            }
          : d,
      ),
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await coachAiApi.editDraft<MealPlanPayload>(draft.draftId, payload);
      setDirty(false);
      Alert.alert('Saved', 'Edits saved to the draft.');
    } catch (err) {
      Alert.alert('Save failed', errorMessage(err, 'Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!draft) return;
    if (dirty) {
      Alert.alert(
        'Save edits first?',
        'You have unsaved changes. Save before approving?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard and approve',
            style: 'destructive',
            onPress: () => performApprove(),
          },
          { text: 'Save and approve', onPress: async () => {
            await handleSave();
            performApprove();
          } },
        ],
      );
      return;
    }
    performApprove();
  };
  const performApprove = async () => {
    if (!draft) return;
    setApproving(true);
    try {
      await coachAiApi.approveDraft(draft.draftId);
      Alert.alert(
        'Approved',
        `Meal plan assigned to ${clientName}.`,
        [
          {
            text: 'OK',
            onPress: () =>
              navigation.navigate('ClientDetail', { clientId, clientName }),
          },
        ],
      );
    } catch (err) {
      Alert.alert('Approve failed', errorMessage(err, 'Try again.'));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!draft) return;
    const reason = rejectReason.trim();
    if (!reason) {
      Alert.alert('Reason required', 'Tell the system why this draft was rejected.');
      return;
    }
    setRejecting(true);
    try {
      await coachAiApi.rejectDraft(draft.draftId, reason);
      setShowRejectModal(false);
      Alert.alert('Rejected', 'Draft rejected.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Reject failed', errorMessage(err, 'Try again.'));
    } finally {
      setRejecting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (loadError || !draft) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
        <Text style={styles.errorText}>{loadError || 'Draft not available.'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load} accessibilityRole="button">
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const days = payload.days || [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {payload.title || 'Meal plan draft'}
          </Text>
          <Text style={styles.headerSubtitle}>For {clientName}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {payload.summary ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryText}>{payload.summary}</Text>
          </View>
        ) : null}

        {days.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="restaurant-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              No structured days returned by the model.
            </Text>
          </View>
        ) : (
          days.map((day, dIdx) => (
            <View key={`day-${dIdx}`} style={styles.dayCard}>
              <Text style={styles.dayTitle}>Day {day.day ?? dIdx + 1}</Text>
              {day.total_calories != null || day.total_protein_g != null ? (
                <Text style={styles.dayTotals}>
                  {day.total_calories != null
                    ? `${Math.round(day.total_calories)} kcal`
                    : ''}
                  {day.total_calories != null && day.total_protein_g != null
                    ? ' · '
                    : ''}
                  {day.total_protein_g != null
                    ? `P ${Math.round(day.total_protein_g)}g`
                    : ''}
                </Text>
              ) : null}
              <TextInput
                style={styles.dayNotesInput}
                placeholder="Day notes (optional)"
                placeholderTextColor={colors.textMuted}
                value={day.notes || ''}
                onChangeText={(t) => updateDay(dIdx, { notes: t })}
                multiline
                accessibilityLabel={`Day ${dIdx + 1} notes`}
              />
              {(day.meals || []).map((meal, mIdx) => (
                <View key={`meal-${mIdx}`} style={styles.mealCard}>
                  <View style={styles.mealHeader}>
                    <TextInput
                      style={styles.mealTodInput}
                      value={meal.time_of_day || ''}
                      onChangeText={(t) =>
                        updateMeal(dIdx, mIdx, { time_of_day: t })
                      }
                      placeholder="Time (breakfast/lunch/…)"
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel={`Meal ${mIdx + 1} time of day`}
                    />
                    <TextInput
                      style={styles.mealNameInput}
                      value={meal.name || ''}
                      onChangeText={(t) => updateMeal(dIdx, mIdx, { name: t })}
                      placeholder="Meal name"
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel={`Meal ${mIdx + 1} name`}
                    />
                  </View>
                  {(meal.items || []).map((item, iIdx) => (
                    <View key={`item-${iIdx}`} style={styles.itemRow}>
                      <TextInput
                        style={styles.itemNameInput}
                        value={item.name || ''}
                        onChangeText={(t) =>
                          updateItem(dIdx, mIdx, iIdx, { name: t })
                        }
                        placeholder="Item"
                        placeholderTextColor={colors.textMuted}
                        accessibilityLabel={`Item ${iIdx + 1} name`}
                      />
                      <View style={styles.itemRowGroup}>
                        <TextInput
                          style={styles.itemPortionInput}
                          value={item.portion || ''}
                          onChangeText={(t) =>
                            updateItem(dIdx, mIdx, iIdx, { portion: t })
                          }
                          placeholder="Portion"
                          placeholderTextColor={colors.textMuted}
                          accessibilityLabel="Portion"
                        />
                        <MacroField
                          label="kcal"
                          value={item.calories}
                          onChange={(n) =>
                            updateItem(dIdx, mIdx, iIdx, { calories: n })
                          }
                          testID={`mealplan-kcal-${dIdx}-${mIdx}-${iIdx}`}
                        />
                        <MacroField
                          label="P g"
                          value={item.protein_g}
                          onChange={(n) =>
                            updateItem(dIdx, mIdx, iIdx, { protein_g: n })
                          }
                        />
                        <MacroField
                          label="C g"
                          value={item.carbs_g}
                          onChange={(n) =>
                            updateItem(dIdx, mIdx, iIdx, { carbs_g: n })
                          }
                        />
                        <MacroField
                          label="F g"
                          value={item.fat_g}
                          onChange={(n) =>
                            updateItem(dIdx, mIdx, iIdx, { fat_g: n })
                          }
                        />
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.provenance}>
          {`Model used: ${draft.modelUsed} · ${draft.tokensIn}+${draft.tokensOut} tokens · $${(
            draft.costCents / 100
          ).toFixed(2)}`}
        </Text>
        <View style={styles.footerBtns}>
          <TouchableOpacity
            style={[styles.btnSecondary, !dirty && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={!dirty || saving}
            accessibilityRole="button"
            accessibilityLabel="Save edits"
          >
            <Text style={styles.btnSecondaryText}>
              {saving ? 'Saving…' : 'Save edits'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnReject}
            onPress={() => {
              setRejectReason('');
              setShowRejectModal(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Reject draft"
          >
            <Text style={styles.btnRejectText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnApprove, approving && { opacity: 0.6 }]}
            onPress={handleApprove}
            disabled={approving}
            accessibilityRole="button"
            accessibilityLabel="Approve and assign"
          >
            <Text style={styles.btnApproveText}>
              {approving ? 'Approving…' : 'Approve & assign'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.rejectOverlay}>
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Reject draft</Text>
            <Text style={styles.rejectDesc}>
              Tell the system what was wrong so we can improve.
            </Text>
            <TextInput
              style={styles.rejectInput}
              placeholder="e.g. Macros are off for client's targets."
              placeholderTextColor={colors.textMuted}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              maxLength={500}
              accessibilityLabel="Rejection reason"
            />
            <View style={styles.rejectBtns}>
              <TouchableOpacity
                style={styles.rejectCancelBtn}
                onPress={() => setShowRejectModal(false)}
              >
                <Text style={styles.rejectCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rejectConfirmBtn, rejecting && { opacity: 0.6 }]}
                onPress={handleReject}
                disabled={rejecting}
              >
                <Text style={styles.rejectConfirmText}>
                  {rejecting ? 'Sending…' : 'Reject'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MacroField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.macroField}>
      <Text style={styles.macroFieldLabel}>{label}</Text>
      <TextInput
        style={styles.macroFieldInput}
        keyboardType="numeric"
        value={value == null ? '' : String(value)}
        onChangeText={(t) => {
          if (t === '') return onChange(null);
          const n = Number(t);
          onChange(Number.isFinite(n) ? n : null);
        }}
        placeholderTextColor={colors.textMuted}
        testID={testID}
        accessibilityLabel={label}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingTop: 56 },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      padding: 24,
      gap: 12,
    },
    errorText: { color: colors.textSecondary, textAlign: 'center' },
    retryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 4,
    },
    retryBtnText: {
      fontFamily: 'Inter_500Medium',
      color: colors.textOnPrimary,
      fontWeight: '600',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 20,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    headerSubtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    scrollContent: { padding: 20, paddingBottom: 40 },
    summaryCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      marginBottom: 16,
    },
    summaryText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 32,
      alignItems: 'center',
      gap: 8,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: 'center',
    },
    dayCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dayTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 18,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    dayTotals: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    dayNotesInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      padding: 8,
      fontSize: 13,
      color: colors.textPrimary,
      marginBottom: 10,
      minHeight: 36,
    },
    mealCard: {
      backgroundColor: colors.background,
      borderRadius: 4,
      padding: 10,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    mealHeader: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    mealTodInput: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingVertical: 6,
      paddingHorizontal: 8,
      fontSize: 12,
      color: colors.textSecondary,
    },
    mealNameInput: {
      flex: 2,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingVertical: 6,
      paddingHorizontal: 8,
      fontSize: 13,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    itemRow: {
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    itemNameInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      padding: 8,
      fontSize: 13,
      color: colors.textPrimary,
      marginBottom: 6,
    },
    itemRowGroup: {
      flexDirection: 'row',
      gap: 4,
    },
    itemPortionInput: {
      flex: 1.4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingVertical: 6,
      paddingHorizontal: 8,
      fontSize: 12,
      color: colors.textSecondary,
    },
    macroField: { flex: 1 },
    macroFieldLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 9,
      fontWeight: '500',
      color: colors.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      textAlign: 'center',
    },
    macroFieldInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingVertical: 4,
      paddingHorizontal: 4,
      fontSize: 12,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    footer: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 20,
      gap: 10,
    },
    provenance: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: colors.textMuted,
      textAlign: 'center',
    },
    footerBtns: {
      flexDirection: 'row',
      gap: 8,
    },
    btnSecondary: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
    },
    btnSecondaryText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textPrimary,
    },
    btnReject: {
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.error,
      alignItems: 'center',
    },
    btnRejectText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.error,
    },
    btnApprove: {
      flex: 1.5,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.primary,
      alignItems: 'center',
    },
    btnApproveText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textOnPrimary,
    },
    rejectOverlay: {
      flex: 1,
      backgroundColor: 'rgba(26,26,24,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    rejectCard: {
      width: '85%',
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 20,
    },
    rejectTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 20,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    rejectDesc: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    rejectInput: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: 4,
      padding: 10,
      fontSize: 14,
      color: colors.textPrimary,
      minHeight: 80,
      textAlignVertical: 'top',
      marginBottom: 12,
    },
    rejectBtns: {
      flexDirection: 'row',
      gap: 10,
    },
    rejectCancelBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
    },
    rejectCancelText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    rejectConfirmBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.error,
      alignItems: 'center',
    },
    rejectConfirmText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textOnPrimary,
    },
  });
