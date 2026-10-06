/**
 * S-MWB — pick a program (workout_program) or saved workout (workout_plan)
 * for a package content row instead of pasting a raw id. Lists come from
 * `/v1/coach/programs` and `/v1/coach/programs/saved-workouts`.
 */
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "../../../theme/ThemeProvider";
import { programsApi } from "../../../api/programsApi";
import { describeProgramFailure } from "../../../utils/programErrors";
import { Chip, FailureBox, LoadingRow, plural } from "./ProgramUi";

export default function ProgramAssetPicker({
  assetType,
  selectedId,
  onSelect,
}: {
  assetType: "workout_program" | "workout_plan";
  selectedId: string;
  onSelect: (id: string, name: string) => void;
}) {
  const { colors } = useTheme();
  const options = useQuery({
    queryKey: ["coach", "programs", "asset-picker", assetType],
    queryFn: async () => {
      if (assetType === "workout_program") {
        const page = await programsApi.list({ status: "active" });
        return page.items
          .filter((p) => p.filled_days > 0)
          .map((p) => ({
            id: p.id,
            name: p.name,
            detail: `${plural(p.filled_days, "workout", "workouts")}`,
          }));
      }
      const page = await programsApi.savedWorkouts();
      return page.items.map((w) => ({
        id: w.id,
        name: w.name,
        detail: plural(w.exercise_count, "exercise", "exercises"),
      }));
    },
  });

  if (options.isLoading) return <LoadingRow label="Loading your library" />;
  if (options.error) {
    return (
      <FailureBox
        failure={describeProgramFailure(options.error, "load your programs")}
        onRetry={() => options.refetch()}
      />
    );
  }
  const rows = options.data ?? [];
  if (rows.length === 0) {
    return (
      <Text style={[styles.empty, { color: colors.textSecondary }]}>
        {assetType === "workout_program"
          ? "No programs with workouts yet. Build one in the Programs tab first."
          : "No saved workouts yet. Build one in Programs, Saved workouts."}
      </Text>
    );
  }
  return (
    <View
      accessibilityLabel={
        assetType === "workout_program"
          ? "Choose a program"
          : "Choose a saved workout"
      }
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {rows.map((r) => (
          <Chip
            key={r.id}
            label={r.name}
            selected={selectedId === r.id}
            onPress={() => onSelect(r.id, r.name)}
            accessibilityLabel={`${r.name}, ${r.detail}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 4 },
  empty: { fontSize: 13, lineHeight: 19 },
});
