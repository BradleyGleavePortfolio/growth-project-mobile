/**
 * ClassroomEmptyState — the empty state for the read-only student classroom
 * feed (v3-2). Unlike the authoring/social empty states (which carry a primary
 * "create" CTA), the classroom is a CONSUMPTION surface for the student: there
 * is nothing for them to create here, so a forced CTA would be a dead button.
 * Instead this renders a calm, reassuring "your coach hasn't posted a lesson
 * yet" message with a line icon — distinct from the loading and error states so
 * a still-loading prerequisite is never mistaken for "no lessons"
 * (DESIGN_INTELLIGENCE: distinct loading/empty/error; no spinner-only empties).
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). The block carries an
 * `accessibilityRole="text"` summary so a screen reader announces the empty
 * state as a single coherent message.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing } from '../../theme/tokens';

export interface ClassroomEmptyStateProps {
  testID?: string;
}

export default function ClassroomEmptyState({
  testID,
}: ClassroomEmptyStateProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const title = 'No lessons yet';
  const body = 'Your coach will share lessons here when they are ready.';

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${body}`}
      testID={testID ?? 'classroom-empty'}
    >
      <Ionicons
        name="book-outline"
        size={32}
        color={semanticColors.textMuted}
      />
      <Text style={[styles.title, { color: semanticColors.textPrimary }]}>
        {title}
      </Text>
      <Text style={[styles.body, { color: semanticColors.textMuted }]}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
