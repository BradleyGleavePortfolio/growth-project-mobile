/**
 * SearchEmptyState — the v3-4 community search empty/idle states. The screen
 * has two distinct "nothing to show" cases that must NOT be conflated with a
 * loading or error state (DESIGN_INTELLIGENCE: distinct loading/empty/error):
 *
 *   - `idle`  — no term entered yet: a calm prompt to start typing.
 *   - `noResults` — a term was searched and the server returned zero hits.
 *
 * Tokens only (no raw hex), line Ionicons only (no emoji), fontWeight <= '600'.
 * The block carries an `accessibilityRole="text"` summary so a screen reader
 * announces the state as a single coherent message.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing } from '../../theme/tokens';

export type SearchEmptyVariant = 'idle' | 'noResults';

export interface SearchEmptyStateProps {
  variant: SearchEmptyVariant;
  /** The searched term, surfaced in the no-results copy. */
  term?: string;
  testID?: string;
}

export default function SearchEmptyState({
  variant,
  term,
  testID,
}: SearchEmptyStateProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const trimmed = (term ?? '').trim();

  const { icon, title, body } =
    variant === 'idle'
      ? {
          icon: 'search-outline' as const,
          title: 'Search the community',
          body: 'Find posts, lessons, events, and voice notes you can see.',
        }
      : {
          icon: 'document-outline' as const,
          title: 'No matches',
          body:
            trimmed.length > 0
              ? `Nothing matched “${trimmed}”. Try a different word.`
              : 'Nothing matched. Try a different word.',
        };

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${body}`}
      testID={testID ?? `community-search-empty-${variant}`}
    >
      <Ionicons name={icon} size={32} color={semanticColors.textMuted} />
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
