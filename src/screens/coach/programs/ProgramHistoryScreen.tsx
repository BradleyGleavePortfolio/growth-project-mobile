/**
 * S-MWB — revision history of a program (every structural change is a
 * revision) and the clients currently on it, with "Remove from program"
 * (deletes the client's not-started workouts; finished ones stay in history).
 */
import React, { useEffect, useState } from "react";
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
  const assigneeItems = (assignees.data?.pages ?? []).flatMap((p) => p.items);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<ProgramFailure | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: "History and clients" });
  }, [navigation]);

  const unassign = (a: ProgramAssignee) => {
    const remaining = a.workouts - a.completed;
    Alert.alert(
      `Remove ${a.client_name} from this program?`,
      `${plural(remaining, "upcoming workout is", "upcoming workouts are")} removed from their plan. ${plural(
        a.completed,
        "finished workout stays",
        "finished workouts stay",
      )} in their history.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusy(a.client_id);
            setFailure(null);
            try {
              await programsApi.unassign(
                programId,
                a.client_id,
                generateIdempotencyKey(),
              );
              await invalidate();
            } catch (err) {
              setFailure(
                describeProgramFailure(
                  err,
                  `remove ${a.client_name} from the program`,
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
        assigneeItems.map((a) => (
          <View
            key={`${a.client_id}:${a.copy_program_id}`}
            style={[
              styles.row,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {a.client_name}
              </Text>
              <Text style={[styles.muted, { color: colors.textSecondary }]}>
                {a.start_date.slice(0, 10)} to {a.end_date.slice(0, 10)} ·{" "}
                {a.completed} of {plural(a.workouts, "workout", "workouts")}{" "}
                done
              </Text>
            </View>
            <SmallButton
              tone="danger"
              label={busy === a.client_id ? "Removing" : "Remove"}
              disabled={!!busy}
              onPress={() => unassign(a)}
              accessibilityHint={`Removes ${a.client_name}'s upcoming workouts from this program`}
            />
          </View>
        ))
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
