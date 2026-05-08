/**
 * EmptyStateNoWorkouts — Empty state for the client's workout log.
 *
 * Shown when no routines have been assigned by the coach. Passive messaging —
 * no CTA (client cannot self-assign; coach assigns).
 *
 * @module src/ui/empty-states/EmptyStateNoWorkouts
 */

import React from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from './EmptyState';
import { IconClipboard } from './icons';

/**
 * Client workout log — coach has not yet assigned a routine.
 */
export function EmptyStateNoWorkouts() {
  const { colors } = useTheme();

  return (
    <EmptyState
      icon={<IconClipboard size={64} color={colors.textMuted} />}
      headline="No workouts yet"
      body="Your coach hasn't assigned a workout yet. Check back after your next session."
    />
  );
}

export default EmptyStateNoWorkouts;
