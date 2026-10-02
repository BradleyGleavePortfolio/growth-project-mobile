/**
 * S-MWB — create a program, or edit its name / goal / length. Edits send the
 * program version the coach saw (`expected_version`) so a change made on
 * another device is never silently overwritten.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "../../../theme/ThemeProvider";
import { programsApi, PROGRAM_MAX_WEEKS } from "../../../api/programsApi";
import {
  programKeys,
  useInvalidatePrograms,
  useProgram,
} from "../../../hooks/usePrograms";
import {
  describeProgramFailure,
  ProgramFailure,
} from "../../../utils/programErrors";
import { generateIdempotencyKey } from "../../../utils/idempotency";
import { FailureBox, LoadingRow, SmallButton } from "./ProgramUi";
import type { ProgramsScreenProps } from "./types";

const GOAL_SUGGESTIONS = [
  "Intro",
  "Fat loss",
  "Strength",
  "Hypertrophy",
  "Mobility",
  "Conditioning",
];

export default function ProgramFormScreen({
  route,
  navigation,
}: ProgramsScreenProps<"ProgramForm">) {
  const programId = route.params?.programId;
  return programId ? (
    <EditLoader programId={programId} navigation={navigation} />
  ) : (
    <ProgramForm navigation={navigation} />
  );
}

function EditLoader({
  programId,
  navigation,
}: {
  programId: string;
  navigation: ProgramsScreenProps<"ProgramForm">["navigation"];
}) {
  const program = useProgram(programId);
  if (program.isLoading) return <LoadingRow label="Loading program" />;
  if (program.error || !program.data) {
    return (
      <View style={{ padding: 16 }}>
        <FailureBox
          failure={describeProgramFailure(program.error, "load this program")}
          onRetry={() => program.refetch()}
        />
      </View>
    );
  }
  return (
    <ProgramForm
      navigation={navigation}
      existing={{
        id: program.data.id,
        version: program.data.version,
        name: program.data.name,
        description: program.data.description ?? "",
        goal: program.data.goal_tag ?? "",
        weeks: program.data.weeks,
        daysPerWeek: program.data.days_per_week,
      }}
    />
  );
}

interface Existing {
  id: string;
  version: number;
  name: string;
  description: string;
  goal: string;
  weeks: number;
  daysPerWeek: number;
}

function ProgramForm({
  navigation,
  existing,
}: {
  navigation: ProgramsScreenProps<"ProgramForm">["navigation"];
  existing?: Existing;
}) {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const invalidate = useInvalidatePrograms();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [goal, setGoal] = useState(existing?.goal ?? "");
  const [weeks, setWeeks] = useState(String(existing?.weeks ?? 4));
  const [daysPerWeek, setDaysPerWeek] = useState(
    String(existing?.daysPerWeek ?? 3),
  );
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ProgramFailure | null>(null);
  // One key per form session: a retry after a timeout cannot create twice.
  const keyRef = useRef(generateIdempotencyKey());

  useEffect(() => {
    navigation.setOptions({ title: existing ? "Edit program" : "New program" });
  }, [navigation, existing]);

  const weeksNum = Number(weeks);
  const daysNum = Number(daysPerWeek);
  const nameError =
    name.trim() === ""
      ? "Give the program a name."
      : name.trim().length > 120
        ? "Keep the name under 120 characters."
        : null;
  const weeksError =
    !Number.isInteger(weeksNum) || weeksNum < 1 || weeksNum > PROGRAM_MAX_WEEKS
      ? `Weeks must be a whole number from 1 to ${PROGRAM_MAX_WEEKS}.`
      : null;
  const daysError =
    !Number.isInteger(daysNum) || daysNum < 1 || daysNum > 7
      ? "Training days per week must be 1 to 7."
      : null;
  const invalid = !!(nameError || weeksError || daysError);

  const submit = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        goal_tag: goal.trim() === "" ? null : goal.trim(),
        weeks: weeksNum,
        days_per_week: daysNum,
      };
      if (existing) {
        const updated = await programsApi.update(
          existing.id,
          { ...body, expected_version: existing.version },
          keyRef.current,
        );
        qc.setQueryData(programKeys.detail(existing.id), updated);
        await invalidate();
        navigation.goBack();
      } else {
        const created = await programsApi.create(body, keyRef.current);
        qc.setQueryData(programKeys.detail(created.id), created);
        await invalidate();
        navigation.replace("ProgramEditor", { programId: created.id });
      }
    } catch (err) {
      const f = describeProgramFailure(
        err,
        existing ? "save the program details" : "create the program",
      );
      setFailure(f);
      keyRef.current = generateIdempotencyKey();
      if (f.reload && existing) await invalidate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <Field label="Name" error={nameError && name !== "" ? nameError : null}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="For example: Men's intro, 4 weeks"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Program name"
            maxLength={120}
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          />
        </Field>
        <Field label="Goal tag (optional)">
          <TextInput
            value={goal}
            onChangeText={setGoal}
            placeholder="Intro, Strength, Fat loss"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Goal tag"
            maxLength={40}
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          />
          <View style={styles.suggestions}>
            {GOAL_SUGGESTIONS.map((g) => (
              <SmallButton
                key={g}
                label={g}
                onPress={() => setGoal(g)}
                accessibilityHint={`Sets the goal tag to ${g}`}
              />
            ))}
          </View>
        </Field>
        <View style={styles.pair}>
          <Field label="Weeks" error={weeksError} style={{ flex: 1 }}>
            <TextInput
              value={weeks}
              onChangeText={(t) => setWeeks(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              accessibilityLabel={`Number of weeks, 1 to ${PROGRAM_MAX_WEEKS}`}
              maxLength={2}
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            />
          </Field>
          <Field
            label="Training days per week"
            error={daysError}
            style={{ flex: 1 }}
          >
            <TextInput
              value={daysPerWeek}
              onChangeText={(t) => setDaysPerWeek(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              accessibilityLabel="Training days per week, 1 to 7"
              maxLength={1}
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            />
          </Field>
        </View>
        <Text style={[styles.help, { color: colors.textSecondary }]}>
          Each week has seven day slots. Fill the days you want clients to
          train; day 1 lands on the start date you pick when assigning.
        </Text>
        <Field label="Description (optional)">
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={2000}
            accessibilityLabel="Program description"
            style={[
              styles.input,
              styles.multiline,
              {
                color: colors.textPrimary,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          />
        </Field>
        {failure ? <FailureBox failure={failure} onRetry={submit} /> : null}
        <SmallButton
          tone="primary"
          label={
            saving ? "Saving" : existing ? "Save details" : "Create program"
          }
          onPress={submit}
          disabled={invalid || saving}
          accessibilityHint={
            invalid ? "Fix the highlighted fields first" : undefined
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  error,
  children,
  style,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
  style?: object;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
      {children}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.error, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, paddingBottom: 48 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 16,
  },
  multiline: { minHeight: 96, paddingTop: 10, textAlignVertical: "top" },
  pair: { flexDirection: "row", gap: 12 },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  help: { fontSize: 13, lineHeight: 19 },
  error: { fontSize: 13 },
});
