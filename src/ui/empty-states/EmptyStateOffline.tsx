/**
 * EmptyStateOffline — Network-down state for screens that require connectivity.
 *
 * Shown when the device is offline and cached data is unavailable. Includes
 * an optional retry CTA.
 *
 * @module src/ui/empty-states/EmptyStateOffline
 */

import React from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from './EmptyState';
import { IconOffline } from './icons';

interface Props {
  /** Optional retry handler — shows "Try again" CTA when provided. */
  onRetry?: () => void;
}

/**
 * Offline / no network — data cannot be loaded.
 */
export function EmptyStateOffline({ onRetry }: Props) {
  const { colors } = useTheme();

  return (
    <EmptyState
      icon={<IconOffline size={64} color={colors.textMuted} />}
      headline="You are offline"
      body="Check your connection and try again. Data will reload automatically when back online."
      ctaLabel={onRetry ? 'Try again' : undefined}
      onCta={onRetry}
    />
  );
}

export default EmptyStateOffline;
