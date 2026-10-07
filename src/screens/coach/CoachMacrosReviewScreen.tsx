/**
 * CoachMacrosReviewScreen — coach view of a single client's macro
 * history plus the form that sets a new daily target.
 *
 * Reads /coach/clients/:clientId/macros and surfaces:
 *   - the current target (most recent row with effective_from <= today)
 *   - a "Set daily targets" form (POST /coach/clients/:clientId/macros),
 *     prefilled from the current target, validated with the server's limits
 *   - the rolling history below it, newest first
 *
 * Param: `route.params.clientId`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { RouteProp } from '@react-navigation/native';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MacroTarget } from '../../api/macrosApi';
import {
  useClientMacroHistory,
  useCreateMacroTarget,
  useCurrentMacrosForClient,
} from '../../hooks/useMacros';
import {
  MACRO_TARGET_LIMITS,
  MACRO_TARGET_NOTE_MAX,
  draftFromTarget,
  kcalFromMacros,
  macroTargetSaveError,
  validateMacroTargetDraft,
  type MacroTargetDraft,
} from '../../utils/coach/macroTargetForm';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';

// Registered in the coach Clients stack (CoachNavigator `CoachMacrosReview`).
export type CoachMacrosReviewParams = {
  clientId: string;
  clientName?: string;
};

interface CoachMacrosReviewScreenProps {
  route: RouteProp<{ CoachMacrosReview: CoachMacrosReviewParams }, 'CoachMacrosReview'>;
}

export default function CoachMacrosReviewScreen({
  route,
}: CoachMacrosReviewScreenProps) {
  const { clientId, clientName } = route.params;
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);

  const currentQ = useCurrentMacrosForClient(clientId);
  const historyQ = useClientMacroHistory(clientId);

  const previous = useMemo<MacroTarget[]>(() => {
    const rows = historyQ.data ?? [];
    if (!currentQ.data) return rows;
    return rows.filter((r) => r.id !== currentQ.data?.id);
  }, [historyQ.data, currentQ.data]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[typography.eyebrow, { color: sc.textMuted }]}>
        Macros
      </Text>
      <Text style={[typography.h2, { color: sc.textPrimary }]}>
        {clientName ?? 'Client'}
      </Text>

      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        Current target
      </Text>
      {currentQ.isLoading ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Loading...
        </Text>
      ) : currentQ.isError ? (
        <View style={styles.card} testID="macros-current-error">
          <Text style={[typography.body, { color: sc.textMuted }]}>
            The current target could not load. Check the connection, then tap Retry.
          </Text>
          <Pressable
            onPress={() => { void currentQ.refetch(); void historyQ.refetch(); }}
            accessibilityRole="button"
            style={styles.linkButton}
            testID="macros-current-retry"
          >
            <Text style={[typography.body, { color: sc.accentText }]}>Retry</Text>
          </Pressable>
        </View>
      ) : currentQ.data ? (
        <TargetCard target={currentQ.data} styles={styles} sc={sc} highlight />
      ) : (
        <View style={styles.card} testID="macros-no-target">
          <Text style={[typography.body, { color: sc.textMuted }]}>
            No coach target yet. Until one is saved below, the client sees targets
            calculated from their profile answers, when those are complete.
          </Text>
        </View>
      )}

      {currentQ.isLoading || currentQ.isError ? null : (
        <SetTargetsForm
          clientId={clientId}
          clientName={clientName}
          current={currentQ.data ?? null}
          styles={styles}
          sc={sc}
        />
      )}

      <Text style={[typography.bodySmall, { color: sc.textMuted, marginTop: spacing.lg }]}>
        Previous targets
      </Text>
      {historyQ.isLoading ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Loading history...
        </Text>
      ) : previous.length === 0 ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          No prior targets recorded.
        </Text>
      ) : (
        previous.map((t) => (
          <TargetCard key={t.id} target={t} styles={styles} sc={sc} />
        ))
      )}
    </ScrollView>
  );
}

const FIELD_ORDER: Array<Exclude<keyof MacroTargetDraft, 'notes'>> = ['calories', 'protein', 'carbs', 'fat'];

function SetTargetsForm({
  clientId,
  clientName,
  current,
  styles,
  sc,
}: {
  clientId: string;
  clientName?: string;
  current: MacroTarget | null;
  styles: Styles;
  sc: SemanticTokens;
}) {
  const create = useCreateMacroTarget();
  const [draft, setDraft] = useState<MacroTargetDraft>(() => draftFromTarget(current));
  const [message, setMessage] = useState<{ kind: 'error' | 'saved'; text: string } | null>(null);

  // A newer current target (after a save) is the next edit's starting point.
  useEffect(() => {
    setDraft(draftFromTarget(current));
  }, [current?.id]);

  const implied = kcalFromMacros(draft);
  const update = (field: keyof MacroTargetDraft) => (text: string) => {
    setDraft((d) => ({ ...d, [field]: text }));
    setMessage(null);
  };

  const onSave = () => {
    const result = validateMacroTargetDraft(draft);
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.message });
      return;
    }
    setMessage(null);
    create.mutate(
      { clientId, input: result.input },
      {
        onSuccess: () =>
          setMessage({ kind: 'saved', text: `Saved. These are now ${clientName ?? 'the client'}'s daily targets.` }),
        onError: (err) => setMessage({ kind: 'error', text: macroTargetSaveError(err) }),
      },
    );
  };

  return (
    <View style={[styles.card, { marginTop: spacing.lg }]} testID="macros-set-form">
      <Text style={[typography.h3, { color: sc.textPrimary }]} accessibilityRole="header">
        Set daily targets
      </Text>
      <View style={styles.fieldGrid}>
        {FIELD_ORDER.map((field) => {
          const { label, unit } = MACRO_TARGET_LIMITS[field];
          return (
            <View key={field} style={styles.field}>
              <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
                {`${label} (${unit})`}
              </Text>
              <TextInput
                value={draft[field]}
                onChangeText={update(field)}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={5}
                editable={!create.isPending}
                accessibilityLabel={`${label} in ${unit === 'g' ? 'grams' : 'kilocalories'}`}
                style={[styles.input, { color: sc.textPrimary, borderColor: sc.border }]}
                testID={`macros-input-${field}`}
              />
            </View>
          );
        })}
      </View>
      {implied !== null ? (
        <Text style={[typography.bodySmall, { color: sc.textMuted }]} testID="macros-implied-kcal">
          {`Protein, carbs and fat come to ${implied} kcal.`}
        </Text>
      ) : null}
      <Text style={[typography.bodySmall, { color: sc.textMuted, marginTop: spacing.xs }]}>
        Note to the client (optional)
      </Text>
      <TextInput
        value={draft.notes}
        onChangeText={update('notes')}
        multiline
        maxLength={MACRO_TARGET_NOTE_MAX}
        editable={!create.isPending}
        accessibilityLabel="Note to the client"
        style={[styles.input, styles.notesInput, { color: sc.textPrimary, borderColor: sc.border }]}
        testID="macros-input-notes"
      />
      {message ? (
        <Text
          style={[typography.bodySmall, { color: message.kind === 'error' ? sc.accentText : sc.textPrimary }]}
          accessibilityLiveRegion="polite"
          accessibilityRole={message.kind === 'error' ? 'alert' : 'text'}
          testID={message.kind === 'error' ? 'macros-save-error' : 'macros-save-ok'}
        >
          {message.text}
        </Text>
      ) : null}
      <Pressable
        onPress={onSave}
        disabled={create.isPending}
        accessibilityRole="button"
        accessibilityState={{ disabled: create.isPending, busy: create.isPending }}
        style={({ pressed }) => [
          styles.saveButton,
          { backgroundColor: create.isPending ? sc.disabledBg : sc.accent, opacity: pressed ? 0.85 : 1 },
        ]}
        testID="macros-save"
      >
        {create.isPending ? (
          <ActivityIndicator color={sc.textOnDisabled} />
        ) : (
          <Text style={[typography.body, { color: sc.textOnAccent }]}>Save targets</Text>
        )}
      </Pressable>
    </View>
  );
}

function TargetCard({
  target,
  styles,
  sc,
  highlight,
}: {
  target: MacroTarget;
  styles: Styles;
  sc: SemanticTokens;
  highlight?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        highlight ? { borderColor: sc.accent, borderWidth: 1 } : null,
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[typography.h3, { color: sc.textPrimary }]}>
          {target.calories_kcal} kcal
        </Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          {formatDate(target.effective_from)}
        </Text>
      </View>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        P {target.protein_g}g • C {target.carbs_g}g • F {target.fats_g}g
        {target.fiber_g !== null ? ` • Fiber ${target.fiber_g}g` : ''}
      </Text>
      {target.notes ? (
        <Text style={[typography.bodySmall, { color: sc.textPrimary }]}>
          {target.notes}
        </Text>
      ) : null}
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: { padding: spacing.lg, gap: spacing.sm },
    card: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
    fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    field: { flexBasis: '47%', flexGrow: 1, gap: spacing.xs },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      paddingHorizontal: spacing.sm,
      minHeight: 44,
      fontSize: 16,
    },
    notesInput: { minHeight: 72, paddingTop: spacing.sm, textAlignVertical: 'top' },
    saveButton: {
      marginTop: spacing.sm,
      minHeight: 48,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  });
}
