/**
 * RegimeListScreen — F2 named-regimes list (coach surface).
 *
 * Lists the coach's active named regimes with their package-attachment counts
 * and a "+ New Regime" entry point. Tapping a row opens RegimeEditorScreen.
 *
 * Flag-gated by `featureFlags.namedRegimes`: the route is only REGISTERED in
 * CoachNavigator behind the flag (see navigation/CoachNavigator.tsx), so this
 * screen is unreachable when the flag is OFF. As a defence-in-depth backstop
 * the body also renders null when the flag is OFF — the route can never mount
 * a visible surface in a flag-off build.
 *
 * Standardized on semanticColors / tokens.ts (bgSurface, never `surface`).
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useRegimes } from '../../hooks/useRegimes';
import type { RegimeListItem } from '../../types/regimes';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';

type Props = NativeStackScreenProps<ClientsStackParamList, 'RegimeList'>;

/** Human label for the attachment count (singular/plural, status-honest). */
export function attachmentLabel(count: number): string {
  if (count === 0) return 'Not attached to any package';
  return count === 1 ? '1 package' : `${count} packages`;
}

/** The display name a regime shows, falling back to the program name. */
export function regimeTitle(item: RegimeListItem): string {
  return item.regime_display_name?.trim() || item.name;
}

export default function RegimeListScreen({
  navigation,
}: Props): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(), []);
  const regimes = useRegimes();

  // Defence-in-depth: the route is not registered when the flag is OFF, but if
  // it is somehow reached the screen renders nothing rather than a surface.
  if (!featureFlags.namedRegimes) return null;

  return (
    <SafeAreaView
      testID="regime-list-screen"
      style={[styles.screen, { backgroundColor: semanticColors.bgPrimary }]}
    >
      <View style={styles.header}>
        <Text style={[styles.heading, { color: semanticColors.textPrimary }]}>
          Regimes
        </Text>
        <TouchableOpacity
          testID="regime-new-button"
          accessibilityRole="button"
          onPress={() => navigation.navigate('RegimeEditor', { regimeId: null })}
          style={[styles.newButton, { backgroundColor: semanticColors.accent }]}
        >
          <Text style={[styles.newButtonText, { color: semanticColors.textOnAccent }]}>
            + New Regime
          </Text>
        </TouchableOpacity>
      </View>

      {regimes.isLoading ? (
        <ActivityIndicator testID="regime-list-spinner" style={styles.spinner} />
      ) : regimes.isError ? (
        <Text
          testID="regime-list-error"
          style={[styles.empty, { color: semanticColors.textMuted }]}
        >
          Could not load regimes. Pull to retry.
        </Text>
      ) : (regimes.data?.length ?? 0) === 0 ? (
        <Text
          testID="regime-list-empty"
          style={[styles.empty, { color: semanticColors.textMuted }]}
        >
          No regimes yet. Promote a workout program to make your first one.
        </Text>
      ) : (
        <FlatList
          testID="regime-list"
          data={regimes.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              testID={`regime-row-${item.id}`}
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate('RegimeEditor', { regimeId: item.id })
              }
              style={[
                styles.row,
                {
                  backgroundColor: semanticColors.bgSurface,
                  borderColor: semanticColors.border,
                },
              ]}
            >
              <Text style={[styles.rowTitle, { color: semanticColors.textPrimary }]}>
                {regimeTitle(item)}
              </Text>
              <Text style={[styles.rowMeta, { color: semanticColors.textMuted }]}>
                {item.weeks}-week · {item.days_per_week}×/week ·{' '}
                {attachmentLabel(item.package_attachments_count)}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles() {
  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    heading: {
      fontSize: 22,
      fontWeight: '700',
    },
    newButton: {
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    newButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    listContent: {
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    row: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '600',
    },
    rowMeta: {
      fontSize: 13,
    },
    spinner: {
      marginTop: spacing.lg,
    },
    empty: {
      textAlign: 'center',
      marginTop: spacing.lg,
      paddingHorizontal: spacing.lg,
      fontSize: 14,
      lineHeight: 20,
    },
  });
}
