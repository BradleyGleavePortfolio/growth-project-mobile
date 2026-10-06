/**
 * S-MWB — coach Programs tab home: the master library (search, goal tag,
 * active / archived, weeks x days, filled days, assigned and package counts)
 * and the saved-workouts library (standalone workouts reused as program days).
 * Every number comes from `/v1/coach/programs`.
 */
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../../../theme/ThemeProvider";
import { useProgramList, useSavedWorkouts } from "../../../hooks/usePrograms";
import type {
  ProgramStatusFilter,
  ProgramSummary,
  SavedWorkout,
} from "../../../api/programsApi";
import { describeProgramFailure } from "../../../utils/programErrors";
import {
  Chip,
  FailureBox,
  LoadingRow,
  SmallButton,
  plural,
  weeksByDays,
} from "./ProgramUi";
import type { ProgramsNav } from "./types";

type Tab = "programs" | "saved";

export default function ProgramsLibraryScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<ProgramsNav>();
  const [tab, setTab] = useState<Tab>("programs");
  const [query, setQuery] = useState("");
  const [goalTag, setGoalTag] = useState<string | null>(null);
  const [status, setStatus] = useState<ProgramStatusFilter>("active");

  const programs = useProgramList(query, goalTag, status);
  const saved = useSavedWorkouts(tab === "saved" ? query : "");

  const programItems = useMemo(
    () => programs.data?.pages.flatMap((p) => p.items) ?? [],
    [programs.data],
  );
  const goalTags = programs.data?.pages[0]?.goal_tags ?? [];
  const savedItems = useMemo(
    () => saved.data?.pages.flatMap((p) => p.items) ?? [],
    [saved.data],
  );

  const programFailure = programs.error
    ? describeProgramFailure(programs.error, "load your programs")
    : null;
  const savedFailure = saved.error
    ? describeProgramFailure(saved.error, "load your saved workouts")
    : null;

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.titleRow}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.textPrimary }]}
        >
          Programs
        </Text>
        {tab === "programs" ? (
          <SmallButton
            tone="primary"
            icon="add"
            label="New program"
            onPress={() => navigation.navigate("ProgramForm")}
            accessibilityHint="Create a program you can reuse for every client"
          />
        ) : (
          <SmallButton
            tone="primary"
            icon="add"
            label="New workout"
            onPress={() => navigation.navigate("CoachWorkoutBuilder")}
            accessibilityHint="Build a standalone workout you can drop into any program day"
          />
        )}
      </View>
      <View style={styles.row} accessibilityRole="tablist">
        <Chip
          label="Programs"
          selected={tab === "programs"}
          onPress={() => setTab("programs")}
        />
        <Chip
          label="Saved workouts"
          selected={tab === "saved"}
          onPress={() => setTab("saved")}
        />
      </View>
      <View
        style={[
          styles.search,
          { borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      >
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={
            tab === "programs" ? "Search programs" : "Search saved workouts"
          }
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={
            tab === "programs"
              ? "Search programs by name"
              : "Search saved workouts by name"
          }
          style={[styles.searchInput, { color: colors.textPrimary }]}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      {tab === "programs" ? (
        <>
          <View style={styles.row}>
            <Chip
              label="Active"
              selected={status === "active"}
              onPress={() => setStatus("active")}
            />
            <Chip
              label="Archived"
              selected={status === "archived"}
              onPress={() => setStatus("archived")}
            />
          </View>
          {goalTags.length > 0 ? (
            <View style={styles.row} accessibilityLabel="Filter by goal">
              <Chip
                label="All goals"
                selected={goalTag === null}
                onPress={() => setGoalTag(null)}
              />
              {goalTags.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  selected={goalTag === t}
                  onPress={() => setGoalTag(goalTag === t ? null : t)}
                  accessibilityLabel={`Goal ${t}`}
                />
              ))}
            </View>
          ) : null}
          {programFailure ? (
            <FailureBox
              failure={programFailure}
              onRetry={() => programs.refetch()}
            />
          ) : null}
        </>
      ) : savedFailure ? (
        <FailureBox failure={savedFailure} onRetry={() => saved.refetch()} />
      ) : null}
    </View>
  );

  if (tab === "saved") {
    return (
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        <FlatList
          data={savedItems}
          keyExtractor={(w) => w.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          refreshing={saved.isRefetching}
          onRefresh={() => saved.refetch()}
          onEndReached={() => {
            if (saved.hasNextPage && !saved.isFetchingNextPage)
              void saved.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <SavedWorkoutRow
              item={item}
              onPress={() =>
                navigation.navigate("CoachWorkoutBuilder", { planId: item.id })
              }
            />
          )}
          ListEmptyComponent={
            saved.isLoading ? (
              <LoadingRow label="Loading saved workouts" />
            ) : savedFailure ? null : (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>
                {query
                  ? `No saved workouts match "${query}".`
                  : "No saved workouts yet. Build one with New workout, then drop it into any program day."}
              </Text>
            )
          }
          ListFooterComponent={
            saved.isFetchingNextPage ? (
              <LoadingRow label="Loading more" />
            ) : null
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <FlatList
        data={programItems}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        refreshing={programs.isRefetching}
        onRefresh={() => programs.refetch()}
        onEndReached={() => {
          if (programs.hasNextPage && !programs.isFetchingNextPage)
            void programs.fetchNextPage();
        }}
        renderItem={({ item }) => (
          <ProgramCard
            item={item}
            onPress={() =>
              navigation.navigate("ProgramEditor", { programId: item.id })
            }
          />
        )}
        ListEmptyComponent={
          programs.isLoading ? (
            <LoadingRow label="Loading programs" />
          ) : programFailure ? null : (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {query || goalTag
                ? "No programs match these filters."
                : status === "archived"
                  ? "No archived programs."
                  : "No programs yet. Create one (for example a 4-week intro), fill the days with workouts, then assign it to clients or add it to a package."}
            </Text>
          )
        }
        ListFooterComponent={
          programs.isFetchingNextPage ? (
            <LoadingRow label="Loading more" />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function ProgramCard({
  item,
  onPress,
}: {
  item: ProgramSummary;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const slots = item.weeks * 7;
  const label = [
    item.name,
    item.goal_tag ? `goal ${item.goal_tag}` : null,
    weeksByDays(item.weeks, item.days_per_week),
    `${item.filled_days} workouts`,
    plural(item.assigned_count, "client assigned", "clients assigned"),
    plural(item.package_count, "package", "packages"),
    item.is_regime ? "named regime" : null,
    item.can_edit ? null : "read only",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the program"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.cardTop}>
        <Text
          style={[styles.cardTitle, { color: colors.textPrimary }]}
          numberOfLines={2}
        >
          {item.is_regime && item.regime_display_name
            ? item.regime_display_name
            : item.name}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
      <View style={styles.metaRow}>
        {item.goal_tag ? <Tag text={item.goal_tag} /> : null}
        {item.is_regime ? <Tag text="Regime" /> : null}
        {!item.can_edit ? <Tag text="Team, read only" /> : null}
      </View>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {weeksByDays(item.weeks, item.days_per_week)} · {item.filled_days} of{" "}
        {slots} days filled
      </Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {plural(item.assigned_count, "client", "clients")} assigned · in{" "}
        {plural(item.package_count, "package", "packages")}
      </Text>
    </Pressable>
  );
}

function SavedWorkoutRow({
  item,
  onPress,
}: {
  item: SavedWorkout;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const minutes = item.duration_estimate_minutes
    ? ` · about ${item.duration_estimate_minutes} min`
    : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.type}, ${plural(item.exercise_count, "exercise", "exercises")}${minutes}`}
      accessibilityHint="Opens the workout builder"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.cardTop}>
        <Text
          style={[styles.cardTitle, { color: colors.textPrimary }]}
          numberOfLines={2}
        >
          {item.name}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {item.type} · {plural(item.exercise_count, "exercise", "exercises")}
        {minutes}
      </Text>
    </Pressable>
  );
}

function Tag({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: colors.primaryPale }]}>
      <Text style={[styles.tagText, { color: colors.primaryDark }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16, paddingBottom: 48, gap: 12 },
  headerBlock: { gap: 12, marginBottom: 4 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 26, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: "600", flex: 1 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  meta: { fontSize: 14 },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 12, fontWeight: "600" },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 24,
    textAlign: "center",
  },
});
