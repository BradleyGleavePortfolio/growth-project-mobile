/**
 * EmptyStateNoWorkouts — Empty state for the client's own routines.
 *
 * @module src/ui/empty-states/EmptyStateNoWorkouts
 */

import React from 'react';
import { Text } from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';
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
        <HapticPressable intent="light" onPress={onCreate} accessibilityRole="button" accessibilityLabel="Create a routine"
          style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ ...typography.bodyMd, color: colors.primary }}>Create a routine</Text>
        </HapticPressable>
      ) : null}
    </>
  );
}

export default EmptyStateNoWorkouts;
