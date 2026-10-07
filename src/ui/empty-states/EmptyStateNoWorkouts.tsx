/**
 * EmptyStateNoWorkouts — Empty state for the client's own routines.
 *
 * @module src/ui/empty-states/EmptyStateNoWorkouts
 */

import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from './EmptyState';
import { IconClipboard } from './icons';

export function EmptyStateNoWorkouts({ onCreate }: { onCreate?: () => void }) {
  const { colors } = useTheme();

  return (
    <>
      <EmptyState
      icon={<IconClipboard size={64} color={colors.textMuted} />}
      headline="No routines yet"
      body="Save a set of exercises as a routine to start it in one tap."
      />
      {onCreate ? (
        <TouchableOpacity onPress={onCreate} accessibilityRole="button" accessibilityLabel="Create a routine"
          style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.primary }}>Create a routine</Text>
        </TouchableOpacity>
      ) : null}
    </>
  );
}

export default EmptyStateNoWorkouts;
