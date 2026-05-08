/**
 * AINote — Wave 11.
 *
 * A reusable wrapper that visually marks any AI-generated text in the UI.
 * Always pairs the content with the canonical disclaimer from `aiHonestyCopy`.
 *
 * Doctrine: AI summarises / drafts / flags / explains. A human approves.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors as tokens, typography, semantic } from '../../theme/tokens';
import { AI_BADGES, aiDisclaimer } from '../../lib/aiHonestyCopy';

interface AINoteProps {
  /** Body text. Should be the AI's summary/draft, NOT a recommendation. */
  children: React.ReactNode;
  /** Which kind of AI output this is — controls the badge label. */
  variant?: keyof typeof AI_BADGES;
  /** Domain hint for the disclaimer. Defaults to "general". */
  disclaimer?: 'health' | 'finance' | 'general' | 'none';
}

export default function AINote({
  children,
  variant = 'summary',
  disclaimer = 'general',
}: AINoteProps) {
  const label = AI_BADGES[variant];
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.badgeRow}>
        <Ionicons name="sparkles-outline" size={14} color={semantic.info.fg} />
        <Text style={styles.badge}>{label}</Text>
      </View>
      {typeof children === 'string' ? (
        <Text style={styles.body}>{children}</Text>
      ) : (
        children
      )}
      {disclaimer !== 'none' && (
        <Text style={styles.disclaimer}>{aiDisclaimer(disclaimer)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: semantic.info.bg,
    borderColor: semantic.info.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: semantic.info.fg,
    fontWeight: '600',
  },
  body: {
    fontFamily: typography.body.fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: tokens.ink,
  },
  disclaimer: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: tokens.charcoal,
    fontStyle: 'italic',
  },
});
