/**
 * S-MWB — assign one program to many clients from a start date. Each client
 * gets their own copy (later edits to the master never rewrite a client's
 * plan). The request runs in chunks of 50; every client gets a visible result
 * (assigned, already on it, or failed with the reason) and failed clients can
 * be retried with the same request key, so nobody is ever assigned twice.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  BulkAssignResult,
  chunkClientIds,
  isValidIsoDate,
  nextMonday,
  programsApi,
  toIsoDate,
} from "../../../api/programsApi";
import {
  useAssignableClients,
  useInvalidatePrograms,
  useProgram,
} from "../../../hooks/usePrograms";
import {
  bulkResultCopy,
  describeProgramFailure,
  ProgramFailure,
} from "../../../utils/programErrors";
import { generateIdempotencyKey } from "../../../utils/idempotency";
import {
  Chip,
  FailureBox,
  LoadingRow,
  SectionTitle,
  SmallButton,
  plural,
} from "./ProgramUi";
import type { ProgramsScreenProps } from "./types";

export default function ProgramAssignScreen({
  route,
  navigation,
}: ProgramsScreenProps<"ProgramAssign">) {
  const { programId } = route.params;
  const { colors } = useTheme();
  const invalidate = useInvalidatePrograms();
  const program = useProgram(programId);
  const clients = useAssignableClients();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState(() =>
    toIsoDate(nextMonday(new Date())),
  );
  const [allowRepeat, setAllowRepeat] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [results, setResults] = useState<Map<string, BulkAssignResult>>(
    new Map(),
  );
  const [failure, setFailure] = useState<ProgramFailure | null>(null);
  const keyRef = useRef(generateIdempotencyKey());

  useEffect(() => {
    navigation.setOptions({
      title: program.data ? `Assign ${program.data.name}` : "Assign program",
    });
  }, [navigation, program.data]);

  const all = useMemo(() => clients.data ?? [], [clients.data]);
  const nameById = useMemo(
    () => new Map(all.map((c) => [c.id, c.name])),
    [all],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === ""
      ? all
      : all.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q),
        );
  }, [all, query]);

  const dateOk = isValidIsoDate(startDate);
  const today = new Date();
  const quickDates = [
    { label: "Today", value: toIsoDate(today) },
    {
      label: "Tomorrow",
      value: toIsoDate(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
      ),
    },
    { label: "Next Monday", value: toIsoDate(nextMonday(today)) },
  ];

  const failedIds = useMemo(
    () =>
      Array.from(results.values())
        .filter((r) => r.status === "failed")
        .map((r) => r.client_id),
    [results],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((c) => selected.has(c.id));
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((c) => next.delete(c.id));
      else visible.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const assign = async (ids: string[]) => {
    if (running || ids.length === 0 || !dateOk) return;
    setRunning(true);
    setFailure(null);
    const chunks = chunkClientIds(ids);
    setProgress({ done: 0, total: ids.length });
    let done = 0;
    try {
      for (const chunk of chunks) {
        try {
          const res = await programsApi.assign(
            programId,
            {
              client_ids: chunk,
              start_date: startDate,
              allow_repeat: allowRepeat || undefined,
            },
            keyRef.current,
          );
          setResults((prev) => {
            const next = new Map(prev);
            res.results.forEach((r) => next.set(r.client_id, r));
            return next;
          });
        } catch (err) {
          const f = describeProgramFailure(err, "assign the program");
          // The whole chunk was refused (or never reached the server): mark
          // each client failed with the same reason so Retry failed covers it.
          setResults((prev) => {
            const next = new Map(prev);
            chunk.forEach((id) =>
              next.set(id, {
                client_id: id,
                status: "failed",
                code: f.code ?? undefined,
                message: f.message,
              }),
            );
            return next;
          });
          if (!f.reference) {
            setFailure(f);
            break; // a known whole-request refusal (archived, empty program) applies to every chunk
          }
        }
        done += chunk.length;
        setProgress({ done, total: ids.length });
      }
    } finally {
      setRunning(false);
      await invalidate();
    }
  };

  if (clients.isLoading || program.isLoading)
    return <LoadingRow label="Loading clients" />;

  const summary = summarise(results);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={visible}
      keyExtractor={(c) => c.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.header}>
          {clients.error ? (
            <FailureBox
              failure={describeProgramFailure(
                clients.error,
                "load your clients",
              )}
              onRetry={() => clients.refetch()}
            />
          ) : null}
          <SectionTitle>Start date</SectionTitle>
          <View style={styles.row}>
            {quickDates.map((d) => (
              <Chip
                key={d.label}
                label={d.label}
                selected={startDate === d.value}
                onPress={() => setStartDate(d.value)}
              />
            ))}
          </View>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Start date, year month day"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: dateOk ? colors.border : colors.error,
                backgroundColor: colors.surface,
              },
            ]}
          />
          {!dateOk ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.error }}
            >
              Enter a real date as YYYY-MM-DD, for example {quickDates[2].value}
              .
            </Text>
          ) : (
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              Week 1, Day 1 lands on {startDate}. Each client gets their own
              copy.
            </Text>
          )}
          <View style={styles.switchRow}>
            <Switch
              value={allowRepeat}
              onValueChange={setAllowRepeat}
              accessibilityLabel="Assign again to clients already on this program"
            />
            <Text style={[styles.help, { color: colors.textPrimary, flex: 1 }]}>
              Assign again to clients already on this program (a second run)
            </Text>
          </View>

          <SectionTitle>{`Clients (${selected.size} selected)`}</SectionTitle>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search clients"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search clients by name or email"
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          />
          <View style={styles.row}>
            <SmallButton
              label={
                allVisibleSelected
                  ? "Clear shown"
                  : `Select all shown (${visible.length})`
              }
              onPress={toggleAllVisible}
              disabled={visible.length === 0}
            />
          </View>

          {failure ? <FailureBox failure={failure} /> : null}
          {progress ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.help, { color: colors.textPrimary }]}
            >
              {running
                ? `Assigning ${progress.done} of ${progress.total}`
                : `${summary.assigned} assigned · ${summary.already} already on it · ${summary.failed} failed`}
            </Text>
          ) : null}
          <View style={styles.row}>
            <SmallButton
              tone="primary"
              icon="send"
              label={
                running
                  ? "Assigning"
                  : `Assign to ${plural(selected.size, "client", "clients")}`
              }
              disabled={running || selected.size === 0 || !dateOk}
              onPress={() => void assign(Array.from(selected))}
            />
            {failedIds.length > 0 && !running ? (
              <SmallButton
                label={`Retry ${failedIds.length} failed`}
                onPress={() => void assign(failedIds)}
                accessibilityHint="Retries only the clients that failed, with the same request key"
              />
            ) : null}
            {summary.total > 0 && failedIds.length === 0 && !running ? (
              <SmallButton label="Done" onPress={() => navigation.goBack()} />
            ) : null}
          </View>
        </View>
      }
      renderItem={({ item }) => {
        const r = results.get(item.id);
        const isSel = selected.has(item.id);
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSel }}
            accessibilityLabel={`${item.name}${r ? `, ${resultLabel(r)}` : ""}`}
            onPress={() => toggle(item.id)}
            style={[
              styles.client,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name={isSel ? "checkbox" : "square-outline"}
              size={24}
              color={isSel ? colors.primary : colors.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.clientName, { color: colors.textPrimary }]}>
                {nameById.get(item.id) ?? item.name}
              </Text>
              {item.email ? (
                <Text style={[styles.help, { color: colors.textSecondary }]}>
                  {item.email}
                </Text>
              ) : null}
              {r ? (
                <Text
                  style={[
                    styles.result,
                    {
                      color:
                        r.status === "failed"
                          ? colors.error
                          : r.status === "assigned"
                            ? colors.success
                            : colors.textSecondary,
                    },
                  ]}
                >
                  {resultLabel(r)}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        clients.error ? null : (
          <Text
            style={[
              styles.help,
              {
                color: colors.textSecondary,
                textAlign: "center",
                paddingVertical: 24,
              },
            ]}
          >
            {query
              ? `No clients match "${query}".`
              : "No active clients yet. Invite clients from the Clients tab."}
          </Text>
        )
      }
    />
  );
}

function resultLabel(r: BulkAssignResult): string {
  if (r.status === "assigned") {
    const span =
      r.first_scheduled_for && r.last_scheduled_for
        ? `, ${r.first_scheduled_for.slice(0, 10)} to ${r.last_scheduled_for.slice(0, 10)}`
        : "";
    return `${r.replayed ? "Assigned (earlier attempt)" : "Assigned"}${r.workouts ? `: ${plural(r.workouts, "workout", "workouts")}` : ""}${span}`;
  }
  if (r.status === "already_assigned")
    return bulkResultCopy("program_already_assigned", r.message);
  return bulkResultCopy(r.code, r.message);
}

function summarise(results: Map<string, BulkAssignResult>) {
  let assigned = 0;
  let already = 0;
  let failed = 0;
  results.forEach((r) => {
    if (r.status === "assigned") assigned += 1;
    else if (r.status === "already_assigned") already += 1;
    else failed += 1;
  });
  return { total: results.size, assigned, already, failed };
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8, paddingBottom: 64 },
  header: { gap: 8, marginBottom: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 16,
  },
  help: { fontSize: 13, lineHeight: 19 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
  },
  client: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 56,
  },
  clientName: { fontSize: 15, fontWeight: "600" },
  result: { fontSize: 13, marginTop: 2 },
});
