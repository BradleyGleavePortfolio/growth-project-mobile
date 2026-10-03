/**
 * S-MWB — create a program, or edit its name / goal / length. Edits send the
 * program version the coach saw (`expected_version`) so a change made on
 * another device is never silently overwritten.
 *
 * Request keys (B-328-2): a key belongs to one exact request body. When the
 * outcome is unknown (no response, a timeout, a server error) the key and the
 * body are kept and the fields lock, so the next press resends the same
 * request and can never create a second program. Only a definite refusal (a
 * 4xx the server answered) releases the key for a new attempt.
 *
 * Reload after a conflict (B-328-4): when the server copy changes, untouched
 * fields take the new server values; a field the coach changed that the
 * server also changed is flagged and must be resolved (keep mine / use latest)
 * before saving, so a stale full body is never paired with a fresh version.
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
  isOutcomeUnknown,
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
  const keyRef = useRef(generateIdempotencyKey());
  // The exact body sent under keyRef while its outcome is unknown.
  const [pending, setPending] = useState<FormValues | null>(null);
  const pendingVersionRef = useRef<number | null>(null);
  const [conflicts, setConflicts] = useState<FieldConflict[]>([]);
  const baseRef = useRef<FormValues | null>(
    existing ? valuesOf(existing) : null,
  );

  useEffect(() => {
    navigation.setOptions({ title: existing ? "Edit program" : "New program" });
  }, [navigation, existing]);

  const current: FormValues = { name, description, goal, weeks, daysPerWeek };
  const setters: Record<FieldKey, (v: string) => void> = {
    name: setName,
    description: setDescription,
    goal: setGoal,
    weeks: setWeeks,
    daysPerWeek: setDaysPerWeek,
  };
  const currentRef = useRef(current);
  currentRef.current = current;

  // Rebase on a new server snapshot (version bump after a conflict reload).
  const serverVersion = existing?.version;
  const lockedForRebase = pending !== null;
  useEffect(() => {
    // While an attempt is unresolved the sent body stays frozen; rebase after.
    if (lockedForRebase || !existing || !baseRef.current) return;
    const next = valuesOf(existing);
    const base = baseRef.current;
    if (FIELD_KEYS.every((k) => base[k] === next[k])) return;
    const mine = currentRef.current;
    const found: FieldConflict[] = [];
    FIELD_KEYS.forEach((k) => {
      if (base[k] === next[k]) return; // the server did not change it
      if (mine[k] === base[k])
        setters[k](next[k]); // untouched: take theirs
      else if (mine[k] !== next[k]) found.push({ field: k, theirs: next[k] });
    });
    baseRef.current = next;
    setConflicts(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverVersion, lockedForRebase]);

  const resolveConflict = (field: FieldKey, choice: "mine" | "theirs") => {
    const c = conflicts.find((x) => x.field === field);
    if (!c) return;
    if (choice === "theirs") setters[field](c.theirs);
    setConflicts((prev) => prev.filter((x) => x.field !== field));
  };

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
  const locked = pending !== null;

  const submit = async () => {
    if (saving || conflicts.length > 0) return;
    if (!locked && invalid) return;
    setSaving(true);
    setFailure(null);
    // An unresolved attempt resends exactly what it sent before.
    const sent = pending ?? current;
    const sentVersion = pending
      ? (pendingVersionRef.current ?? existing?.version ?? 0)
      : (existing?.version ?? 0);
    try {
      const body = toBody(sent);
      if (existing) {
        const updated = await programsApi.update(
          existing.id,
          { ...body, expected_version: sentVersion },
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
      if (isOutcomeUnknown(err)) {
        // It may have saved. Keep the key and the body until a retry tells us.
        pendingVersionRef.current = sentVersion;
        setPending(sent);
      } else {
        setPending(null);
        keyRef.current = generateIdempotencyKey();
      }
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
            editable={!locked}
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
            editable={!locked}
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
                onPress={() => {
                  if (!locked) setGoal(g);
                }}
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
              editable={!locked}
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
              editable={!locked}
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
            editable={!locked}
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
        {conflicts.map((c) => (
          <View
            key={c.field}
            accessibilityRole="alert"
            style={[
              styles.conflict,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <Text style={[styles.help, { color: colors.textPrimary }]}>
              {`${FIELD_LABELS[c.field]} also changed on another device to "${c.theirs || "(empty)"}". Choose which to keep before saving.`}
            </Text>
            <View style={styles.suggestions}>
              <SmallButton
                label="Keep mine"
                onPress={() => resolveConflict(c.field, "mine")}
                accessibilityHint={`Keeps your ${FIELD_LABELS[c.field].toLowerCase()}`}
              />
              <SmallButton
                label="Use latest"
                onPress={() => resolveConflict(c.field, "theirs")}
                accessibilityHint={`Uses the ${FIELD_LABELS[c.field].toLowerCase()} from the other device`}
              />
            </View>
          </View>
        ))}
        {failure ? <FailureBox failure={failure} onRetry={submit} /> : null}
        {locked ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.help, { color: colors.textSecondary }]}
          >
            The app could not confirm whether this saved, so your entries are
            kept exactly as sent. Retry to check; it cannot make a second copy.
          </Text>
        ) : null}
        <SmallButton
          tone="primary"
          label={
            saving ? "Saving" : existing ? "Save details" : "Create program"
          }
          onPress={submit}
          disabled={(!locked && invalid) || saving || conflicts.length > 0}
          accessibilityHint={
            conflicts.length > 0
              ? "Choose which change to keep first"
              : !locked && invalid
                ? "Fix the highlighted fields first"
                : undefined
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type FieldKey = "name" | "description" | "goal" | "weeks" | "daysPerWeek";
type FormValues = Record<FieldKey, string>;
interface FieldConflict {
  field: FieldKey;
  theirs: string;
}
const FIELD_KEYS: FieldKey[] = [
  "name",
  "description",
  "goal",
  "weeks",
  "daysPerWeek",
];
const FIELD_LABELS: Record<FieldKey, string> = {
  name: "Name",
  description: "Description",
  goal: "Goal tag",
  weeks: "Weeks",
  daysPerWeek: "Training days per week",
};

function valuesOf(e: Existing): FormValues {
  return {
    name: e.name,
    description: e.description,
    goal: e.goal,
    weeks: String(e.weeks),
    daysPerWeek: String(e.daysPerWeek),
  };
}

function toBody(v: FormValues) {
  return {
    name: v.name.trim(),
    description: v.description.trim() === "" ? null : v.description.trim(),
    goal_tag: v.goal.trim() === "" ? null : v.goal.trim(),
    weeks: Number(v.weeks),
    days_per_week: Number(v.daysPerWeek),
  };
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
  conflict: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
});
