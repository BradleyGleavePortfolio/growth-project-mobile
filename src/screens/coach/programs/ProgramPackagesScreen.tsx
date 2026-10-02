/**
 * S-MWB — "Add to package": put this program in one of the coach's packages
 * (paid or $0). Every client who gets the package (checkout, $0 invite grant
 * or free claim) receives their own copy of the whole program from day 1 of
 * their join date. Replaces typing a raw asset id.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../theme/ThemeProvider";
import { coachPackagesApi, CoachPackage } from "../../../api/packagesApi";
import { coachPackageContentsApi } from "../../../api/packageContentsApi";
import { useInvalidatePrograms, useProgram } from "../../../hooks/usePrograms";
import {
  describeProgramFailure,
  ProgramFailure,
} from "../../../utils/programErrors";
import { generateIdempotencyKey } from "../../../utils/idempotency";
import { FailureBox, LoadingRow, plural } from "./ProgramUi";
import type { ProgramsScreenProps } from "./types";

export default function ProgramPackagesScreen({
  route,
  navigation,
}: ProgramsScreenProps<"ProgramPackages">) {
  const { programId } = route.params;
  const { colors } = useTheme();
  const invalidate = useInvalidatePrograms();
  const program = useProgram(programId);
  const packages = useQuery({
    queryKey: ["coach", "packages", "for-program-picker"],
    queryFn: async () => (await coachPackagesApi.list()).data,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    f: ProgramFailure;
    retry?: () => void;
  } | null>(null);
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    navigation.setOptions({ title: "Add to package" });
  }, [navigation]);

  const inPackage = useMemo(
    () => new Set((program.data?.packages ?? []).map((p) => p.package_id)),
    [program.data?.packages],
  );
  const rows = useMemo(
    () =>
      (packages.data ?? []).filter(
        (p) => p.status !== "archived" && !p.archivedAt,
      ),
    [packages.data],
  );

  const attach = async (pkg: CoachPackage) => {
    if (busy || !program.data) return;
    setBusy(pkg.id);
    setFailure(null);
    const key = keys.current.get(pkg.id) ?? generateIdempotencyKey();
    keys.current.set(pkg.id, key);
    try {
      await coachPackageContentsApi.attach(
        pkg.id,
        {
          asset_type: "workout_program",
          asset_id: programId,
          cadence_kind: "immediate",
          cadence_payload: {},
          display_title: program.data.name,
        },
        key,
      );
      keys.current.delete(pkg.id);
      await invalidate();
      Alert.alert(
        "Added to package",
        `${pkg.title} now delivers ${program.data.name}. New clients get it from their join date. Clients already in the package do not get it automatically; send it to them from Settings, Packages, then this package's contents.`,
      );
    } catch (err) {
      const f = describeProgramFailure(err, `add the program to ${pkg.title}`);
      if (!f.reference) keys.current.delete(pkg.id);
      setFailure({
        f,
        retry: f.reference ? () => void attach(pkg) : undefined,
      });
      if (f.reload) await Promise.all([invalidate(), packages.refetch()]);
    } finally {
      setBusy(null);
    }
  };

  if (program.isLoading || packages.isLoading)
    return <LoadingRow label="Loading packages" />;

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.lead, { color: colors.textSecondary }]}>
            Pick a package. It delivers the whole program, starting on each
            client's join date, including $0 packages.
          </Text>
          {program.error ? (
            <FailureBox
              failure={describeProgramFailure(
                program.error,
                "load this program",
              )}
              onRetry={() => program.refetch()}
            />
          ) : null}
          {packages.error ? (
            <FailureBox
              failure={describeProgramFailure(
                packages.error,
                "load your packages",
              )}
              onRetry={() => packages.refetch()}
            />
          ) : null}
          {failure ? (
            <FailureBox failure={failure.f} onRetry={failure.retry} />
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const already = inPackage.has(item.id);
        const price =
          item.priceCents === 0
            ? "Free ($0)"
            : `${(item.priceCents / 100).toFixed(2)} ${item.currency.toUpperCase()}`;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${price}, ${item.status}, ${plural(item.subscriberCount, "client", "clients")}${
              already ? ", already includes this program" : ""
            }`}
            accessibilityState={{
              disabled: already || !!busy,
              busy: busy === item.id,
            }}
            disabled={already || !!busy}
            onPress={() => void attach(item)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.surface, borderColor: colors.border },
              (pressed || already) && { opacity: 0.7 },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {item.title}
              </Text>
              <Text style={[styles.sub, { color: colors.textSecondary }]}>
                {price} · {item.status} ·{" "}
                {plural(item.subscriberCount, "client", "clients")}
              </Text>
              {already ? (
                <Text style={[styles.sub, { color: colors.success }]}>
                  Already includes this program
                </Text>
              ) : null}
              {busy === item.id ? (
                <Text style={[styles.sub, { color: colors.textPrimary }]}>
                  Adding
                </Text>
              ) : null}
            </View>
            <Ionicons
              name={already ? "checkmark-circle" : "add-circle-outline"}
              size={24}
              color={already ? colors.success : colors.primary}
            />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        packages.error ? null : (
          <Text
            style={[
              styles.lead,
              {
                color: colors.textSecondary,
                textAlign: "center",
                paddingVertical: 24,
              },
            ]}
          >
            No packages yet. Create one in Settings, Packages, then come back to
            add this program.
          </Text>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, paddingBottom: 48 },
  header: { gap: 8, marginBottom: 4 },
  lead: { fontSize: 15, lineHeight: 21 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 56,
  },
  title: { fontSize: 15, fontWeight: "700" },
  sub: { fontSize: 13 },
});
