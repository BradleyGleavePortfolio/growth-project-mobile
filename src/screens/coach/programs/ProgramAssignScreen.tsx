/**
 * S-MWB — assign one program to many clients from a start date. Each client
 * gets their own copy (later edits to the master never rewrite a client's
 * plan). The request runs in chunks of 50; every client gets a visible result
 * (assigned, already on it, or failed with the reason) and failed clients can
 * be retried with the same request key, so nobody is ever assigned twice.
 *
 * One request key per logical intent (program, start date, repeat choice):
 * changing the date or the repeat switch starts a new intent with a fresh key
 * and clears the old results; a run that ends with no failures retires its
 * key, so the next press is a new assignment rather than a replay of the old
 * one. Only "Retry N failed" (and a re-press while failures are showing)
 * reuses the key, which is what makes a lost response safe to retry.
 *
 * STYLE-LOGGING-M: K3 Style C, its own frame C_assign (planning/MOCKUP3/K3/style-c/C_assign_*.png): the route's bar
 * and a deep forest masthead holding the start date (pills, the typed date, its lines and the repeat switch), the
 * clients on the page as hairline rows with a round check, and Assign pinned at the foot. Look only: every request,
 * key, word and control is main's; ProgramUi's parts stay as they are for the other Programs screens.
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
  layout,
  lightTokens,
  radius,
  spacing,
  typography,
  type SemanticTokens,
} from "../../../theme/tokens";
import { MastheadBand, mast } from "../../client/workouts/workoutStyleC";
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
import { FailureBox, LoadingRow, SmallButton, plural } from "./ProgramUi";
import type { ProgramsScreenProps } from "./types";
import { assignmentDay } from "../../../utils/workout/workoutDay";

export default function ProgramAssignScreen({
  route,
  navigation,
}: ProgramsScreenProps<"ProgramAssign">) {
  const { programId } = route.params;
  const { colors, semanticColors } = useTheme();
  // The default theme's light tokens when a theme carries none (ThemeProvider's default context is built from them).
  const sc = semanticColors ?? lightTokens;
  const styles = useMemo(() => makeStyles(sc), [sc]);
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
  const intent = `${programId}|${startDate}|${allowRepeat ? "repeat" : "once"}`;
  const intentRef = useRef(intent);

  useEffect(() => {
    if (intentRef.current === intent) return;
    intentRef.current = intent;
    keyRef.current = generateIdempotencyKey();
    setResults(new Map());
    setProgress(null);
    setFailure(null);
  }, [intent]);

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
    let anyFailed = false;
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
          if (res.results.some((r) => r.status === "failed")) anyFailed = true;
          setResults((prev) => {
            const next = new Map(prev);
            res.results.forEach((r) => next.set(r.client_id, r));
            return next;
          });
        } catch (err) {
          anyFailed = true;
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
      // A clean run retires its key: the next press is a new assignment.
      // Any failed or unknown outcome keeps it so a retry replays safely.
      if (!anyFailed) keyRef.current = generateIdempotencyKey();
      setRunning(false);
      await invalidate();
    }
  };

  if (clients.isLoading || program.isLoading)
    return <LoadingRow label="Loading clients" />;

  const summary = summarise(results);
  const assignDisabled = running || selected.size === 0 || !dateOk;
  const assignLabel = running
    ? "Assigning"
    : `Assign to ${plural(selected.size, "client", "clients")}`;
  const selectLabel = allVisibleSelected
    ? "Clear shown"
    : `Select all shown (${visible.length})`;

  return (
    <View style={styles.screen}>
      <MastheadBand color={mast.ground} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={visible}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            {/* C_assign rows 200-661: the start date on the masthead, under the route's forest bar. */}
            <View style={styles.masthead}>
              <Text accessibilityRole="header" style={styles.mastHead}>
                Start date
              </Text>
              <View style={styles.row}>
                {quickDates.map((d) => {
                  const chosen = startDate === d.value;
                  return (
                    <Pressable
                      key={d.label}
                      accessibilityRole="button"
                      accessibilityLabel={d.label}
                      accessibilityState={{ selected: chosen }}
                      onPress={() => {
                        if (!running) setStartDate(d.value);
                      }}
                      style={[styles.pill, chosen && styles.pillChosen]}
                    >
                      <Text style={[styles.pillText, chosen && styles.pillTextChosen]}>
                        {d.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={startDate}
                onChangeText={setStartDate}
                editable={!running}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={mast.muted}
                accessibilityLabel="Start date, year month day"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={10}
                style={[styles.dateInput, !dateOk && styles.dateInputInvalid]}
              />
              {!dateOk ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.help, { color: mast.ink }]}
                >
                  Enter a real date as YYYY-MM-DD, for example {quickDates[2].value}
                  .
                </Text>
              ) : (
                <Text style={[styles.help, { color: mast.muted }]}>
                  Week 1, Day 1 lands on {startDate}. Each client gets their own
                  copy.
                </Text>
              )}
              <View style={styles.switchRow}>
                <Switch
                  value={allowRepeat}
                  onValueChange={setAllowRepeat}
                  disabled={running}
                  trackColor={{ false: mast.line, true: mast.chosen }}
                  accessibilityLabel="Assign again to clients already on this program"
                />
                <Text style={[styles.help, { color: mast.ink, flex: 1 }]}>
                  Assign again to clients already on this program (a second run)
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              {clients.error ? (
                <FailureBox
                  failure={describeProgramFailure(
                    clients.error,
                    "load your clients",
                  )}
                  onRetry={() => clients.refetch()}
                />
              ) : null}
              {/* C_assign rows 726-745: the section head with Select all at its right. */}
              <View style={styles.headRow}>
                <Text accessibilityRole="header" style={styles.pageHead}>
                  {`Clients (${selected.size} selected)`}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={selectLabel}
                  accessibilityState={{ disabled: visible.length === 0 }}
                  disabled={visible.length === 0}
                  onPress={toggleAllVisible}
                  style={({ pressed }) => [styles.link, pressed && styles.pressed]}
                >
                  <Text style={[styles.linkText, visible.length === 0 && { color: sc.textMuted }]}>
                    {selectLabel}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.searchField}>
                <Ionicons
                  name="search"
                  size={18}
                  color={sc.textMuted}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search clients"
                  placeholderTextColor={sc.textMuted}
                  accessibilityLabel="Search clients by name or email"
                  style={styles.searchInput}
                />
              </View>
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
              style={styles.client}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.clientName}>
                  {nameById.get(item.id) ?? item.name}
                </Text>
                {item.email ? (
                  <Text style={styles.clientSub}>{item.email}</Text>
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
              {/* C_assign cols 680-731: the round check at the right, forest when chosen. */}
              <Ionicons
                name={isSel ? "checkmark-circle" : "ellipse-outline"}
                size={32}
                color={isSel ? sc.accent : sc.textMuted}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          clients.error ? null : (
            <Text style={[styles.help, styles.empty]}>
              {query
                ? `No clients match "${query}".`
                : "No active clients yet. Invite clients from the Clients tab."}
            </Text>
          )
        }
      />
      {/* C_assign rows 1449-1603: the run's line, then the one forest Assign pinned at the foot. */}
      <View style={styles.foot}>
        {failure ? <FailureBox failure={failure} /> : null}
        {progress ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.help, styles.progress]}
          >
            {running
              ? `Assigning ${progress.done} of ${progress.total}`
              : summaryLine(summary)}
          </Text>
        ) : null}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={assignLabel}
          accessibilityState={{ disabled: assignDisabled }}
          disabled={assignDisabled}
          onPress={() => void assign(Array.from(selected))}
          style={({ pressed }) => [
            styles.primary,
            assignDisabled && styles.primaryDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.primaryText, assignDisabled && styles.primaryTextDisabled]}>
            {assignLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function resultLabel(r: BulkAssignResult): string {
  if (r.status === "assigned") {
    const span =
      r.first_scheduled_for && r.last_scheduled_for
        ? `, ${assignmentDay(r.first_scheduled_for)} to ${assignmentDay(r.last_scheduled_for)}`
        : "";
    return `${r.replayed ? "Assigned (earlier attempt)" : "Assigned"}${r.workouts ? `: ${plural(r.workouts, "workout", "workouts")}` : ""}${span}`;
  }
  if (r.status === "already_assigned")
    return bulkResultCopy("program_already_assigned", r.message);
  return bulkResultCopy(r.code, r.message);
}

function summarise(results: Map<string, BulkAssignResult>) {
  let assigned = 0;
  let replayed = 0;
  let already = 0;
  let failed = 0;
  results.forEach((r) => {
    if (r.status === "assigned" && r.replayed) replayed += 1;
    else if (r.status === "assigned") assigned += 1;
    else if (r.status === "already_assigned") already += 1;
    else failed += 1;
  });
  return { total: results.size, assigned, replayed, already, failed };
}

/** Rows confirmed from an earlier attempt are counted on their own. */
function summaryLine(s: ReturnType<typeof summarise>): string {
  const parts = [`${s.assigned} assigned`];
  if (s.replayed > 0)
    parts.push(`${s.replayed} confirmed from an earlier attempt`);
  parts.push(`${s.already} already on it`, `${s.failed} failed`);
  return parts.join(" · ");
}

// K3 C_assign's look from the theme and the kit. The two heads keep main's case (an uppercase eyebrow would change
// the words), so they take the caption role, the nearest mixed-case role to the drawn eyebrow, in its place and colour.
function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    list: { flex: 1 },
    listContent: { paddingBottom: spacing.xl },
    // C_assign rows 200-661: deep forest, 24 pt bottom corners (col 10 ends at row 642), the 24 pt gutter.
    masthead: {
      backgroundColor: mast.ground,
      borderBottomLeftRadius: radius.sheet,
      borderBottomRightRadius: radius.sheet,
      paddingHorizontal: layout.gutter,
      paddingTop: spacing.md,
      // rows 634-661: 14 pt under the last control.
      paddingBottom: 14,
      gap: spacing.sm,
    },
    // "FIRST WEEK" (cap rows 210-226): in the eyebrow's place, muted ink on forest; main's case (caption role).
    mastHead: { ...typography.caption, color: mast.muted },
    row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    // C_assign rows 442-529: 44 pt pills, a 1 pt frame line (#627669), 16 pt in from each end (cols 48-79).
    pill: {
      minHeight: layout.touchMin,
      minWidth: layout.touchMin,
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
      borderRadius: radius.chip,
      borderWidth: 1,
      borderColor: mast.line,
    },
    // The chosen date is filled leaf with deep text (cols 418-655, #A3C46A).
    pillChosen: { backgroundColor: mast.chosen, borderColor: mast.chosen },
    // "Today" (T cap rows 473-493, 21 px): 14 pt.
    pillText: { ...typography.bodySmall, color: mast.ink },
    pillTextChosen: { color: mast.ground },
    // The typed date in C_picker's field on forest (rows 204-295): forest fill, frame line, 12 pt corners.
    dateInput: {
      ...typography.body,
      minHeight: layout.touchMin,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: mast.line,
      backgroundColor: mast.field,
      color: mast.ink,
    },
    // Red on forest fails contrast (2.2:1); an invalid date takes a 2 pt edge in the masthead ink.
    dateInputInvalid: { borderWidth: 2, borderColor: mast.ink },
    help: { ...typography.bodySmall },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: layout.touchMin,
    },
    // The page part: the 24 pt gutter, 18 pt under the masthead (rows 661-728).
    section: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.sm },
    headRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      minHeight: layout.touchMin,
    },
    // "10 SELECTED" (cap rows 728-743): in the eyebrow's place, muted ink; main's case (caption role).
    pageHead: { ...typography.caption, color: sc.textMuted, flexShrink: 1 },
    // "Select all 100" (rows 726-745): the forest link at the right, in a 44 pt target.
    link: { minHeight: layout.touchMin, justifyContent: "center" },
    linkText: { ...typography.bodySmall, fontFamily: typography.micro.fontFamily, fontWeight: "600", color: sc.accentText },
    pressed: { opacity: 0.8 },
    // C_assign rows 794-881: the light field, a 1 pt line, 12 pt corners, 44 pt, the search glyph at cols 79-104.
    searchField: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: layout.touchMin,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: sc.border,
      backgroundColor: sc.bgSurface,
    },
    searchInput: { ...typography.body, flex: 1, minHeight: layout.touchMin, color: sc.textPrimary },
    // C_assign rows 883-1331: 56 pt hairline rows on the gutter, no box, the check at the right.
    client: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minHeight: layout.rowMinHeight,
      marginHorizontal: layout.gutter,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    // "Jordan" (J cap rows 924-947): Inter 17.
    clientName: { ...typography.h4, color: sc.textPrimary },
    // "Already on this program" (rows 1174-1199): the muted line under the name.
    clientSub: { ...typography.bodySmall, color: sc.textMuted },
    result: { ...typography.bodySmall, marginTop: 2 },
    empty: { color: sc.textMuted, textAlign: "center", paddingVertical: spacing.xl, paddingHorizontal: layout.gutter },
    // The pinned foot: 12 pt above, the gutter at the sides and under it (Screen's foot when the tab bar owns the edge).
    foot: {
      paddingHorizontal: layout.gutter,
      paddingTop: layout.footerTopGap,
      paddingBottom: layout.gutter,
      gap: layout.footerItemGap,
      backgroundColor: sc.bgPrimary,
    },
    // The drawn line over the button (rows 1449-1475): centred.
    progress: { color: sc.textPrimary, textAlign: "center" },
    // C_assign rows 1496-1603: one forest button, 54 pt, 12 pt corners; the app's primary label.
    primary: {
      minHeight: layout.buttonHeight,
      borderRadius: radius.button,
      backgroundColor: sc.accent,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    primaryDisabled: { backgroundColor: sc.disabledBg },
    primaryText: { ...typography.bodyMd, color: sc.textOnAccent, textAlign: "center" },
    primaryTextDisabled: { color: sc.textOnDisabled },
  });
}
