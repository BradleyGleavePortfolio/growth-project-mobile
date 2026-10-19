/**
 * ReactionBar — allowlisted-emoji reaction row for a post or comment.
 *
 * The emoji set mirrors the backend allowlist (COMMUNITY_REACTION_EMOJI). The
 * backend broadcasts only a delta ping on reaction change; the client refetches
 * aggregated state. Tapping a chip toggles the caller's reaction (optimistic at
 * the screen-hook level). Each chip is a >= 44pt/48dp touch target.
 *
 * Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import {
  COMMUNITY_REACTION_EMOJI,
  communityReactionDisplay,
  isAllowedCommunityReaction,
  type CommunityReactionEmoji,
  type CommunityReactionSummary,
} from '../../api/communityApi';

export interface ReactionBarProps {
  /** Aggregated reaction state for the target (may be empty). */
  reactions?: CommunityReactionSummary[];
  /** Toggle handler: receives the accepted REST key and its current state. */
  onToggle: (emoji: CommunityReactionEmoji, active: boolean) => void;
  /** Subset of the allowlist to show as quick-add chips. Defaults to first 4. */
  quickEmoji?: CommunityReactionEmoji[];
  testID?: string;
}

export default function ReactionBar({
  reactions = [],
  onToggle,
  quickEmoji,
  testID,
}: ReactionBarProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const quick = (quickEmoji ?? COMMUNITY_REACTION_EMOJI.slice(0, 4))
    .filter(isAllowedCommunityReaction);

  const byEmoji = new Map(reactions.map((r) => [r.emoji, r]));
  // Merge the quick-add set with any emoji that already have counts.
  const shown = new Set<string>([...quick, ...reactions.map((r) => r.emoji)]);

  return (
    <View style={styles.row} testID={testID}>
      {[...shown].map((emoji) => {
        const summary = byEmoji.get(emoji);
        const active = summary?.reacted_by_me ?? false;
        const count = summary?.count ?? 0;
        const display = communityReactionDisplay(emoji);
        const content = (
          <>
            <Text style={styles.glyph}>{display}</Text>
            {count > 0 ? (
              <Text
                style={[
                  styles.count,
                  {
                    color: active
                      ? semanticColors.textOnAccent
                      : semanticColors.textMuted,
                  },
                ]}
              >
                {count}
              </Text>
            ) : null}
          </>
        );
        const chipTestID = `reaction-${emoji}`;
        const chipStyle = [
          styles.chip,
          {
            backgroundColor: active
              ? semanticColors.accent
              : semanticColors.bgSurface,
            borderColor: semanticColors.border,
          },
        ];
        // Keep stored legacy/unknown keys visible, but never offer a refused tap.
        if (!isAllowedCommunityReaction(emoji)) {
          return (
            <View key={emoji} testID={chipTestID} style={chipStyle}>
              {content}
            </View>
          );
        }
        return (
          <HapticPressable
            key={emoji}
            testID={chipTestID}
            style={chipStyle}
            intent="light"
            onPress={() => onToggle(emoji, active)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`React ${display}${count ? `, ${count}` : ''}`}
          >
            {content}
          </HapticPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chip: {
    minHeight: 44, // accessible touch target
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  glyph: {
    fontSize: 16,
  },
  count: {
    fontSize: 13,
    fontWeight: '600',
  },
});
