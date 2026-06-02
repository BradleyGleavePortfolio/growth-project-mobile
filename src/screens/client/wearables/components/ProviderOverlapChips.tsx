/**
 * ProviderOverlapChips — per-provider source chips on the Metric Detail screen
 * (brief §4.4).
 *
 * Visible ONLY when ≥2 providers have samples for the same metric in the
 * window (otherwise there is nothing to choose between). The active chip is the
 * currently-preferred provider — or, when no explicit preference is set, the
 * resolveBest fallback provider tagged "auto".
 *
 * Tapping a chip writes the preference via `useWearablePreference()`, which
 * optimistically flips the active chip and rolls back on error. On rollback we
 * surface an ACTIONABLE toast ("Couldn't update preferred source — try again")
 * — NEVER a generic "Error" (§4.4). The toast is owned by the caller (Metric
 * Detail) via the `onError` callback so it can place it in its own layout.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  withAlpha,
} from '../../../../theme/tokens';
import {
  configFor,
  type WearableProvider,
} from '../../../../api/wearablesConnectionsApi';
import type { WearableMetricType } from '../../../../api/wearablesSamplesApi';
import { useWearablePreference } from '../../../../hooks/useWearablePreference';
import { toneTokens, type BucketTone } from '../wearablesTheme';

interface Props {
  readonly metric: WearableMetricType;
  /** Providers that have samples for this metric in the window. */
  readonly providers: readonly WearableProvider[];
  /**
   * The currently-active provider — the explicit preference if set, else the
   * resolveBest fallback (rendered with an "auto" tag).
   */
  readonly activeProvider: WearableProvider | null;
  /** True when `activeProvider` is the auto fallback (no explicit preference). */
  readonly isAuto: boolean;
  readonly tone: BucketTone;
  /** Surface an actionable rollback toast (§4.4). */
  readonly onError: (message: string) => void;
}

const ROLLBACK_COPY = "Couldn't update preferred source — try again";

export default function ProviderOverlapChips({
  metric,
  providers,
  activeProvider,
  isAuto,
  tone,
  onError,
}: Props) {
  const toneTk = toneTokens(tone);
  const preference = useWearablePreference();

  const handlePick = useCallback(
    (provider: WearableProvider) => {
      if (provider === activeProvider && !isAuto) return;
      preference.mutate(
        { metric, preferredProvider: provider },
        {
          onError: () => onError(ROLLBACK_COPY),
        },
      );
    },
    [activeProvider, isAuto, metric, preference, onError],
  );

  // Only meaningful with ≥2 overlapping providers (§4.4).
  if (providers.length < 2) return null;

  return (
    <View
      style={styles.container}
      accessibilityRole="radiogroup"
      accessibilityLabel="Preferred data source"
    >
      <Text style={styles.heading}>Source</Text>
      <View style={styles.chips}>
        {providers.map((provider) => {
          const active = provider === activeProvider;
          const cfg = configFor(provider);
          return (
            <Pressable
              key={provider}
              onPress={() => handlePick(provider)}
              disabled={preference.isPending}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: preference.isPending }}
              accessibilityLabel={cfg.displayName}
              style={[
                styles.chip,
                {
                  borderColor: active ? toneTk.accent : withAlpha(colors.ink, 0.15),
                  backgroundColor: active ? withAlpha(toneTk.accent, 0.12) : 'transparent',
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? toneTk.accent : colors.charcoal },
                ]}
              >
                {cfg.displayName}
                {active && isAuto ? ' · auto' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.lg,
  },
  heading: {
    ...typography.eyebrow,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: {
    ...typography.bodySmall,
    fontFamily: 'Inter_500Medium',
  },
});
