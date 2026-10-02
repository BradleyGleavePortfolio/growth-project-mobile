/**
 * S-MWB — fill an empty program day from the saved-workouts library or by
 * copying another day of the same program. The copy is independent: editing
 * it later never changes the saved workout or the source day.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  DAY_LABELS,
  programsApi,
  ProgramDay,
  SavedWorkout,
} from "../../../api/programsApi";
import {
  programKeys,
  useInvalidatePrograms,
  useProgram,
  useSavedWorkouts,
} from "../../../hooks/usePrograms";
import {
  describeProgramFailure,
  ProgramFailure,
} from "../../../utils/programErrors";
import { generateIdempotencyKey } from "../../../utils/idempotency";
import { FailureBox, LoadingRow, plural } from "./ProgramUi";
import type { ProgramsScreenProps } from "./types";

export default function ProgramDayPickerScreen({
  route,
  navigation,
}: ProgramsScreenProps<"ProgramDayPicker">) {
  const { programId, week, day, mode } = route.params;
  const { colors } = useTheme();
  const qc = useQueryClient();
  const invalidate = useInvalidatePrograms();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    f: ProgramFailure;
    retry?: () => void;
  } | null>(null);
  const keyRef = useRef<string | null>(null);
  const saved = useSavedWorkouts(mode === "saved" ? query : "");
  const program = useProgram(programId);

  useEffect(() => {
    navigation.setOptions({
      title: mode === "saved" ? "Use a saved workout" : "Copy another day",
    });
  }, [navigation, mode]);

  const savedItems = useMemo(
    () => saved.data?.pages.flatMap((p) => p.items) ?? [],
    [saved.data],
  );
  const sourceDays = useMemo(
    () =>
      (program.data?.days ?? [])
        .filter((d) => !(d.week_index === week && d.day_index === day))
        .filter((d) =>
          query.trim() === ""
            ? true
            : d.name.toLowerCase().includes(query.trim().toLowerCase()),
        ),
    [program.data?.days, week, day, query],
  );

  const target = `Week ${week + 1}, ${DAY_LABELS[day]}`;

  const fill = async (
    id: string,
    body: Parameters<typeof programsApi.setDay>[3],
  ) => {
    if (busyId) return;
    setBusyId(id);
    setFailure(null);
    keyRef.current = keyRef.current ?? generateIdempotencyKey();
    try {
      const next = await programsApi.setDay(
        programId,
        week,
        day,
        body,
        keyRef.current,
      );
      qc.setQueryData(programKeys.detail(programId), next);
      keyRef.current = null;
      await invalidate();
      navigation.goBack();
    } catch (err) {
      const f = describeProgramFailure(err, `fill ${target}`);
      if (!f.reference) keyRef.current = null;
      setFailure({
        f,
        retry: f.reference ? () => void fill(id, body) : undefined,
      });
      if (f.reload) await invalidate();
    } finally {
      setBusyId(null);
    }
  };

  const header = (
    <View style={styles.header}>
      <Text style={[styles.lead, { color: colors.textSecondary }]}>
        {mode === "saved"
          ? `Pick a saved workout for ${target}.`
          : `Pick a day to copy into ${target}.`}
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={mode === "saved" ? "Search saved workouts" : "Search days"}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={
          mode === "saved" ? "Search saved workouts" : "Search program days"
        }
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      />
      {failure ? (
        <FailureBox failure={failure.f} onRetry={failure.retry} />
      ) : null}
    </View>
  );

  if (mode === "saved") {
    return (
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.list}
        data={savedItems}
        keyExtractor={(w) => w.id}
        ListHeaderComponent={header}
        onEndReached={() => {
          if (saved.hasNextPage && !saved.isFetchingNextPage)
            void saved.fetchNextPage();
        }}
        renderItem={({ item }) => (
          <Row
            title={item.name}
            subtitle={savedSubtitle(item)}
            busy={busyId === item.id}
            disabled={!!busyId}
            onPress={() =>
              void fill(item.id, { source: "saved_workout", plan_id: item.id })
            }
          />
        )}
        ListEmptyComponent={
          saved.isLoading ? (
            <LoadingRow label="Loading saved workouts" />
          ) : saved.error ? (
            <FailureBox
              failure={describeProgramFailure(
                saved.error,
                "load your saved workouts",
              )}
              onRetry={() => saved.refetch()}
            />
          ) : (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              No saved workouts yet. Build one from Programs, Saved workouts,
              New workout.
            </Text>
          )
        }
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={sourceDays}
      keyExtractor={(d) => d.plan_id}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <Row
          title={`Week ${item.week_index + 1}, ${DAY_LABELS[item.day_index]}: ${item.name}`}
          subtitle={daySubtitle(item)}
          busy={busyId === item.plan_id}
          disabled={!!busyId}
          onPress={() =>
            void fill(item.plan_id, {
              source: "copy_day",
              from_week_index: item.week_index,
              from_day_index: item.day_index,
            })
          }
        />
      )}
      ListEmptyComponent={
        program.isLoading ? (
          <LoadingRow label="Loading days" />
        ) : program.error ? (
          <FailureBox
            failure={describeProgramFailure(program.error, "load this program")}
            onRetry={() => program.refetch()}
          />
        ) : (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            No other filled days to copy yet.
          </Text>
        )
      }
    />
  );
}

function savedSubtitle(w: SavedWorkout): string {
  return `${w.type} · ${plural(w.exercise_count, "exercise", "exercises")}${
    w.duration_estimate_minutes
      ? ` · about ${w.duration_estimate_minutes} min`
      : ""
  }`;
}

function daySubtitle(d: ProgramDay): string {
  return `${d.type} · ${plural(d.exercise_count, "exercise", "exercises")}`;
}

function Row({
  title,
  subtitle,
  busy,
  disabled,
  onPress,
}: {
  title: string;
  subtitle: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      accessibilityHint="Copies this workout into the day"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
        (pressed || disabled) && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>
        {title}
      </Text>
      <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
        {busy ? "Copying" : subtitle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, paddingBottom: 48 },
  header: { gap: 10, marginBottom: 4 },
  lead: { fontSize: 15, lineHeight: 21 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 16,
  },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4, minHeight: 56 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 13 },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 24,
    textAlign: "center",
  },
});
