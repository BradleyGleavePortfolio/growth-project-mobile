/**
 * S-MWB — revision history of a program (every structural change is a
 * revision) and the clients currently on it, with "Remove from program"
 * (deletes the client's not-started workouts across every run of the program,
 * package copies included; started and finished ones stay in history).
 */
import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../../theme/ThemeProvider";
import { programsApi, ProgramAssignee } from "../../../api/programsApi";
import {
  useInvalidatePrograms,
  useProgramAssignees,
  useProgramRevisions,
} from "../../../hooks/usePrograms";
import {
  describeProgramFailure,
  ProgramFailure,
} from "../../../utils/programErrors";
import { generateIdempotencyKey } from "../../../utils/idempotency";
import {
  FailureBox,
  LoadingRow,
  SectionTitle,
  SmallButton,
  plural,
} from "./ProgramUi";
import type { ProgramsScreenProps } from "./types";

const CAUSE_COPY: Record<string, string> = {
  initial: "Created",
  manual_edit: "Edited",
  clone: "Copied from another program",
  undo: "Undone",
};

export default function ProgramHistoryScreen({
  route,
  navigation,
}: ProgramsScreenProps<"ProgramHistory">) {
  const { programId } = route.params;
  const { colors } = useTheme();
  const invalidate = useInvalidatePrograms();
  const revisions = useProgramRevisions(programId);
  const assignees = useProgramAssignees(programId);
  const assigneeItems = useMemo(
    () => (assignees.data?.pages ?? []).flatMap((p) => p.items),
    [assignees.data],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<ProgramFailure | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: "History and clients" });
  }, [navigation]);

  // One row per client: the server's remove applies to every run (copy) of
  // this program the client is on, including copies a package delivered, so
  // the confirmation and the button are per client, never per run (B-358-2).
  const clients = useMemo(() => {
    const byClient = new Map<string, ProgramAssignee[]>();
    for (const a of assigneeItems) {
      const runs = byClient.get(a.client_id) ?? [];
      runs.push(a);
      byClient.set(a.client_id, runs);
    }
    return Array.from(byClient.values());
  }, [assigneeItems]);
  // Another page can hold more runs of the same client, so sums are only a
  // ceiling once every page is loaded; otherwise no count is promised.
  const allLoaded = !assignees.hasNextPage;

  const unassign = (runs: ProgramAssignee[]) => {
    const a = runs[0];
    const notFinished = runs.reduce((n, r) => n + r.workouts - r.completed, 0);
    const finished = runs.reduce((n, r) => n + r.completed, 0);
    const scope =
      runs.length > 1
        ? `${a.client_name} is on ${plural(runs.length, "run", "runs")} of this program. `
        : "";
    const counts = !allLoaded
      ? " Finished workouts, and any workout already started, stay in their history."
      : notFinished === 0
        ? " No upcoming workouts are left to remove; finished workouts stay in their history."
        : ` Up to ${plural(notFinished, "upcoming workout is", "upcoming workouts are")} removed. ${plural(
            finished,
            "finished workout stays",
            "finished workouts stay",
          )} in their history, and so does any workout already started.`;
    Alert.alert(
      `Remove ${a.client_name} from this program?`,
      `${scope}Every run of this program on their plan, including copies delivered by a package, loses the workouts not yet started.${counts} This cannot be undone.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusy(a.client_id);
            setFailure(null);
            setDone(null);
            try {
              const res = await programsApi.unassign(
                programId,
                a.client_id,
                generateIdempotencyKey(),
              );
              setDone(
                `${a.client_name} is off this program: ${plural(
                  res.removed_workouts,
                  "upcoming workout was",
                  "upcoming workouts were",
                )} removed and ${plural(
                  res.kept_workouts,
                  "workout stays",
                  "workouts stay",
                )} in their history.`,
              );
              await invalidate();
            } catch (err) {
              // Telemetry gets this action text: never a client name (B-358-3).
              setFailure(
                describeProgramFailure(
                  err,
                  "remove this client from the program",
                ),
              );
              await invalidate();
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.body}
    >
      <SectionTitle>Clients on this program</SectionTitle>
      {failure ? <FailureBox failure={failure} /> : null}
      {done ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.muted, { color: colors.textPrimary }]}
        >
          {done}
        </Text>
      ) : null}
      {assignees.isLoading ? (
        <LoadingRow label="Loading clients" />
      ) : assignees.error && assigneeItems.length === 0 ? (
        <FailureBox
          failure={describeProgramFailure(
            assignees.error,
            "load the clients on this program",
          )}
          onRetry={() => assignees.refetch()}
        />
      ) : assigneeItems.length === 0 ? (
        <Text style={[styles.muted, { color: colors.textSecondary }]}>
          No clients are on this program yet.
        </Text>
      ) : (
        clients.map((runs) => {
          const a = runs[0];
          return (
            <View
              key={a.client_id}
              style={[
                styles.row,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.title, { color: colors.textPrimary }]}>
                  {a.client_name}
                </Text>
                {runs.map((r) => (
                  <Text
                    key={r.copy_program_id}
                    style={[styles.muted, { color: colors.textSecondary }]}
                  >
                    {r.start_date.slice(0, 10)} to {r.end_date.slice(0, 10)} ·{" "}
                    {r.completed} of {plural(r.workouts, "workout", "workouts")}{" "}
                    done
                  </Text>
                ))}
              </View>
              <SmallButton
                tone="danger"
                label={busy === a.client_id ? "Removing" : "Remove"}
                disabled={!!busy}
                onPress={() => unassign(runs)}
                accessibilityHint={`Removes ${a.client_name}'s workouts not yet started from every run of this program`}
              />
            </View>
          );
        })
      )}

      {assignees.hasNextPage ? (
        <SmallButton
          label={
            assignees.isFetchingNextPage ? "Loading more" : "Show more clients"
          }
          disabled={assignees.isFetchingNextPage}
          onPress={() => void assignees.fetchNextPage()}
          accessibilityHint="Loads the next 50 clients on this program"
        />
      ) : null}
      {assignees.error && assigneeItems.length > 0 ? (
        <FailureBox
          failure={describeProgramFailure(
            assignees.error,
            "load more clients on this program",
          )}
          onRetry={() => void assignees.fetchNextPage()}
        />
      ) : null}

      <SectionTitle>Revision history</SectionTitle>
      {revisions.isLoading ? (
        <LoadingRow label="Loading history" />
      ) : revisions.error ? (
        <FailureBox
          failure={describeProgramFailure(
            revisions.error,
            "load the revision history",
          )}
          onRetry={() => revisions.refetch()}
        />
      ) : (revisions.data?.items ?? []).length === 0 ? (
        <Text style={[styles.muted, { color: colors.textSecondary }]}>
          No revisions recorded yet.
        </Text>
      ) : (
        (revisions.data?.items ?? []).map((r) => (
          <View
            key={r.revision_index}
            accessible
            accessibilityLabel={`Revision ${r.revision_index + 1}, ${CAUSE_COPY[r.cause] ?? r.cause}, ${new Date(
              r.created_at,
            ).toLocaleString()}`}
            style={[
              styles.row,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {`#${r.revision_index + 1} ${CAUSE_COPY[r.cause] ?? r.cause}`}
              </Text>
              <Text style={[styles.muted, { color: colors.textSecondary }]}>
                {new Date(r.created_at).toLocaleString()}
                {r.author_kind === "sub_coach" ? " · team coach" : ""}
                {r.weeks !== null
                  ? ` · ${plural(r.weeks, "week", "weeks")}`
                  : ""}
                {r.day_count !== null
                  ? ` · ${plural(r.day_count, "workout", "workouts")}`
                  : ""}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 8, paddingBottom: 48 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 56,
  },
  title: { fontSize: 15, fontWeight: "600" },
  muted: { fontSize: 13, lineHeight: 19 },
});
