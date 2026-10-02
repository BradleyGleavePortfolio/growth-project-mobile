/**
 * S-MWB — one program: header facts (all from the API), the week-by-day grid,
 * and every action a coach needs (assign, add to package, edit details,
 * duplicate, history, promote to regime, archive / restore). A filled day
 * opens the existing workout builder (autosave when EXPO_PUBLIC_FF_MWB_AUTOSAVE
 * is on); an empty day can start blank, reuse a saved workout or copy a day.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  DAY_LABELS,
  indexDays,
  programsApi,
  ProgramDay,
  ProgramDetail,
} from "../../../api/programsApi";
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
import { featureFlags } from "../../../config/featureFlags";
import {
  FailureBox,
  LoadingRow,
  SectionTitle,
  SmallButton,
  plural,
  weeksByDays,
} from "./ProgramUi";
import type { ProgramsScreenProps } from "./types";

interface Slot {
  week: number;
  day: number;
}

export default function ProgramEditorScreen({
  route,
  navigation,
}: ProgramsScreenProps<"ProgramEditor">) {
  const { programId } = route.params;
  const { colors } = useTheme();
  const qc = useQueryClient();
  const invalidate = useInvalidatePrograms();
  const program = useProgram(programId);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    f: ProgramFailure;
    retry?: () => void;
  } | null>(null);
  const keyRef = useRef<string | null>(null);

  // Coming back from the builder (or any sub-screen) shows fresh counts.
  useFocusEffect(
    useCallback(() => {
      void program.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [programId]),
  );

  const data = program.data;
  const dayMap = useMemo(() => indexDays(data?.days ?? []), [data?.days]);

  const run = useCallback(
    async (
      label: string,
      action: string,
      fn: (key: string) => Promise<ProgramDetail | void>,
    ) => {
      if (busy) return;
      setBusy(label);
      setFailure(null);
      keyRef.current = keyRef.current ?? generateIdempotencyKey();
      try {
        const next = await fn(keyRef.current);
        if (next) qc.setQueryData(programKeys.detail(programId), next);
        keyRef.current = null;
        await invalidate();
        return next;
      } catch (err) {
        const f = describeProgramFailure(err, action);
        // Known (non-retryable-as-is) failures get a fresh key next time; an
        // unknown failure keeps it so Retry cannot apply the action twice.
        if (!f.reference) keyRef.current = null;
        setFailure({
          f,
          retry: f.reference ? () => void run(label, action, fn) : undefined,
        });
        if (f.reload) await invalidate();
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [busy, invalidate, programId, qc],
  );

  if (program.isLoading) return <LoadingRow label="Loading program" />;
  if (program.error || !data) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, padding: 16 },
        ]}
      >
        <FailureBox
          failure={describeProgramFailure(program.error, "load this program")}
          onRetry={() => program.refetch()}
        />
      </View>
    );
  }

  const archived = data.archived_at !== null;
  const editable = data.can_edit && !archived;
  const selectedDay = selected
    ? (dayMap.get(`${selected.week}:${selected.day}`) ?? null)
    : null;

  const openDay = (d: ProgramDay) =>
    navigation.navigate("CoachWorkoutBuilder", { planId: d.plan_id });

  const startBlank = async (slot: Slot) => {
    const next = await run("blank", "add a workout to this day", (key) =>
      programsApi.setDay(
        programId,
        slot.week,
        slot.day,
        {
          source: "blank",
          name: `Week ${slot.week + 1} ${DAY_LABELS[slot.day]}`,
        },
        key,
      ),
    );
    const created = next
      ? indexDays(next.days).get(`${slot.week}:${slot.day}`)
      : undefined;
    if (created) openDay(created);
  };

  const clearDay = (slot: Slot, d: ProgramDay) => {
    Alert.alert(
      `Clear ${d.name}?`,
      "The workout is removed from this program. Clients already assigned keep their own copy.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Clear day",
          style: "destructive",
          onPress: () => {
            void run("clear", "clear this day", (key) =>
              programsApi.clearDay(programId, slot.week, slot.day, key),
            ).then(() => setSelected(null));
          },
        },
      ],
    );
  };

  const duplicate = async () => {
    const copy = await run("duplicate", "duplicate the program", (key) =>
      programsApi.duplicate(programId, undefined, key),
    );
    if (copy) navigation.push("ProgramEditor", { programId: copy.id });
  };

  const archiveOrRestore = () => {
    if (archived) {
      void run("restore", "restore the program", (key) =>
        programsApi.restore(programId, key),
      );
      return;
    }
    Alert.alert(
      `Archive ${data.name}?`,
      "It leaves the active library and cannot be assigned. Clients already on it keep their workouts. You can restore it from Archived.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () =>
            void run("archive", "archive the program", (key) =>
              programsApi.archive(programId, key),
            ),
        },
      ],
    );
  };

  const promote = () => {
    Alert.alert(
      "Promote to a named regime?",
      "Named regimes appear in the regime list for packages and the clinic. The program itself does not change.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Promote",
          onPress: () =>
            void run("promote", "promote the program", async () => {
              try {
                await programsApi.promoteToRegime(programId, data.name);
              } catch (err) {
                const status = (err as { response?: { status?: number } })
                  .response?.status;
                if (status === 404) {
                  setFailure({
                    f: {
                      code: "named_regimes_unavailable",
                      status,
                      message:
                        "Named regimes are not switched on for your account yet, so this program stays a regular program. Contact support to enable regimes.",
                      reference: null,
                      support: true,
                      reload: false,
                    },
                  });
                  return;
                }
                throw err;
              }
            }),
        },
      ],
    );
  };

  const panel = selected ? (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      accessibilityLabel={`Week ${selected.week + 1}, ${DAY_LABELS[selected.day]}`}
    >
      <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>
        Week {selected.week + 1}, {DAY_LABELS[selected.day]}
      </Text>
      {selectedDay ? (
        <>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {selectedDay.name} · {selectedDay.type} ·{" "}
            {plural(selectedDay.exercise_count, "exercise", "exercises")}
            {selectedDay.duration_estimate_minutes
              ? ` · about ${selectedDay.duration_estimate_minutes} min`
              : ""}
          </Text>
          <View style={styles.actions}>
            {data.can_edit ? (
              <SmallButton
                tone="primary"
                icon="barbell"
                label="Open in workout builder"
                onPress={() => openDay(selectedDay)}
              />
            ) : null}
            {editable ? (
              <SmallButton
                tone="danger"
                icon="trash"
                label={busy === "clear" ? "Clearing" : "Clear day"}
                disabled={!!busy}
                onPress={() => clearDay(selected, selectedDay)}
              />
            ) : null}
          </View>
        </>
      ) : editable ? (
        <View style={styles.actions}>
          <SmallButton
            tone="primary"
            icon="add"
            label={busy === "blank" ? "Adding" : "New workout"}
            disabled={!!busy}
            onPress={() => void startBlank(selected)}
          />
          <SmallButton
            icon="bookmark"
            label="Use a saved workout"
            onPress={() =>
              navigation.navigate("ProgramDayPicker", {
                programId,
                week: selected.week,
                day: selected.day,
                mode: "saved",
              })
            }
          />
          <SmallButton
            icon="duplicate"
            label="Copy another day"
            disabled={data.filled_days === 0}
            onPress={() =>
              navigation.navigate("ProgramDayPicker", {
                programId,
                week: selected.week,
                day: selected.day,
                mode: "copy",
              })
            }
          />
        </View>
      ) : (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          Rest day.
        </Text>
      )}
    </View>
  ) : null;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.body}
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.textPrimary }]}
      >
        {data.name}
      </Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {[
          data.goal_tag,
          weeksByDays(data.weeks, data.days_per_week),
          data.is_regime ? "Named regime" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {data.filled_days} of {data.weeks * 7} days filled ·{" "}
        {plural(data.assigned_count, "client", "clients")} assigned · in{" "}
        {plural(data.package_count, "package", "packages")}
      </Text>
      {data.description ? (
        <Text style={[styles.description, { color: colors.textPrimary }]}>
          {data.description}
        </Text>
      ) : null}

      {archived ? (
        <Notice text="Archived. Restore it to edit, assign or add it to a package." />
      ) : !data.can_edit ? (
        <Notice text="Shared by another coach on your team. Duplicate it to make your own editable copy; you can still assign it." />
      ) : null}
      {data.can_edit && !featureFlags.mwbAutosave ? (
        <Notice text="Workouts save when you tap Save in the builder." />
      ) : null}

      {failure ? (
        <FailureBox failure={failure.f} onRetry={failure.retry} />
      ) : null}

      <View style={styles.actions}>
        <SmallButton
          tone="primary"
          icon="people"
          label="Assign to clients"
          disabled={archived || data.filled_days === 0}
          onPress={() => navigation.navigate("ProgramAssign", { programId })}
          accessibilityHint={
            data.filled_days === 0
              ? "Add a workout day first"
              : "Pick clients and a start date"
          }
        />
        <SmallButton
          icon="pricetag"
          label="Add to package"
          disabled={archived || data.filled_days === 0}
          onPress={() => navigation.navigate("ProgramPackages", { programId })}
          accessibilityHint="Every client who gets the package receives this program"
        />
        {editable ? (
          <SmallButton
            icon="create"
            label="Edit details"
            onPress={() => navigation.navigate("ProgramForm", { programId })}
          />
        ) : null}
        <SmallButton
          icon="copy"
          label={busy === "duplicate" ? "Duplicating" : "Duplicate"}
          onPress={duplicate}
          disabled={!!busy}
        />
        <SmallButton
          icon="time"
          label="History and clients"
          onPress={() => navigation.navigate("ProgramHistory", { programId })}
        />
        {editable && !data.is_regime ? (
          <SmallButton
            icon="ribbon"
            label="Promote to regime"
            onPress={promote}
            disabled={!!busy}
          />
        ) : null}
        {data.can_edit ? (
          <SmallButton
            icon={archived ? "refresh" : "archive"}
            tone={archived ? "neutral" : "danger"}
            label={archived ? "Restore" : "Archive"}
            onPress={archiveOrRestore}
            disabled={!!busy}
          />
        ) : null}
      </View>

      {data.packages.length > 0 ? (
        <>
          <SectionTitle>In packages</SectionTitle>
          {data.packages.map((p) => (
            <Text
              key={p.content_id}
              style={[styles.meta, { color: colors.textSecondary }]}
            >
              {p.package_name}
            </Text>
          ))}
        </>
      ) : null}

      <SectionTitle>Schedule</SectionTitle>
      <Text style={[styles.help, { color: colors.textSecondary }]}>
        Day 1 of week 1 lands on the start date. Tap a day to open, fill or
        clear it.
      </Text>
      {Array.from({ length: data.weeks }, (_, week) => (
        <View key={week} style={styles.weekRow}>
          <Text style={[styles.weekLabel, { color: colors.textPrimary }]}>
            Week {week + 1}
          </Text>
          <View style={styles.cells}>
            {DAY_LABELS.map((dayLabel, day) => {
              const d = dayMap.get(`${week}:${day}`);
              const isSel = selected?.week === week && selected?.day === day;
              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={`Week ${week + 1}, ${dayLabel}: ${
                    d
                      ? `${d.name}, ${plural(d.exercise_count, "exercise", "exercises")}`
                      : "rest day, empty"
                  }`}
                  accessibilityState={{ selected: isSel }}
                  accessibilityActions={
                    d
                      ? [
                          { name: "activate", label: "Select" },
                          { name: "open", label: "Open in workout builder" },
                        ]
                      : [{ name: "activate", label: "Select" }]
                  }
                  onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === "open" && d) openDay(d);
                    else setSelected({ week, day });
                  }}
                  onPress={() => setSelected(isSel ? null : { week, day })}
                  style={[
                    styles.cell,
                    {
                      backgroundColor: d ? colors.primaryPale : colors.surface,
                      borderColor: isSel ? colors.primary : colors.border,
                      borderWidth: isSel ? 2 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.cellDay, { color: colors.textSecondary }]}
                  >
                    {day + 1}
                  </Text>
                  {d ? (
                    <Text
                      numberOfLines={2}
                      style={[styles.cellName, { color: colors.primaryDark }]}
                    >
                      {d.name}
                    </Text>
                  ) : (
                    <Text
                      style={[styles.cellEmpty, { color: colors.textMuted }]}
                    >
                      Rest
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
          {selected?.week === week ? panel : null}
        </View>
      ))}
    </ScrollView>
  );
}

function Notice({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: colors.noticeWarningBg }]}>
      <Text
        style={{
          color: colors.noticeWarningText,
          fontSize: 14,
          lineHeight: 20,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, paddingBottom: 64, gap: 8 },
  title: { fontSize: 24, fontWeight: "600" },
  meta: { fontSize: 14, lineHeight: 20 },
  description: { fontSize: 15, lineHeight: 22, marginTop: 4 },
  help: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  notice: { borderRadius: 10, padding: 10, marginTop: 8 },
  weekRow: { gap: 6, marginTop: 8 },
  weekLabel: { fontSize: 14, fontWeight: "600" },
  cells: { flexDirection: "row", gap: 4 },
  cell: {
    flex: 1,
    minHeight: 64,
    minWidth: 44,
    borderRadius: 8,
    padding: 4,
    gap: 2,
  },
  cellDay: { fontSize: 11, fontWeight: "600" },
  cellName: { fontSize: 11, fontWeight: "600" },
  cellEmpty: { fontSize: 11 },
  panel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
    marginTop: 16,
  },
  panelTitle: { fontSize: 16, fontWeight: "600" },
});
