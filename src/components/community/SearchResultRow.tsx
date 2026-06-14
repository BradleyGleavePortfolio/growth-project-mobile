/**
 * SearchResultRow — a single v3-4 community search hit. Renders the result's
 * kind (as a calm line icon + label), its PII-stripped excerpt, and a relative
 * timestamp. The row is a button that opens the underlying object.
 *
 * The backend never sends a post/transcript BODY here — only an excerpt — so
 * this row deliberately renders `result.excerpt` and nothing else from the
 * payload. Tokens only (no raw hex), line Ionicons only (no emoji), fontWeight
 * <= '600' (quiet-luxury doctrine).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import type {
  SearchResultRow as SearchResultRowModel,
  CommunitySearchKind,
} from '../../api/communitySearchApi';

/** Per-kind line icon + human label (no emoji; line Ionicons only). */
const KIND_META: Record<
  CommunitySearchKind,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  post: { icon: 'chatbubble-outline', label: 'Post' },
  classroom_lesson: { icon: 'book-outline', label: 'Lesson' },
  voice_note_transcript: { icon: 'mic-outline', label: 'Voice note' },
  event: { icon: 'calendar-outline', label: 'Event' },
};

/** Compact relative time (e.g. "3d", "2h", "just now") from an ISO string. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const diffMs = Math.max(0, now - then);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  return `${Math.floor(day / 30)}mo`;
}

export interface SearchResultRowProps {
  result: SearchResultRowModel;
  onPress: (result: SearchResultRowModel) => void;
  testID?: string;
}

export default function SearchResultRow({
  result,
  onPress,
  testID,
}: SearchResultRowProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const meta = KIND_META[result.kind];
  const when = formatRelative(result.createdAt);

  return (
    <Pressable
      onPress={() => onPress(result)}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}. ${result.excerpt}`}
      testID={testID ?? `community-search-result-${result.id}`}
      style={[
        styles.container,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
        },
      ]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={meta.icon} size={18} color={semanticColors.textMuted} />
      </View>
      <View style={styles.body}>
        <View style={styles.metaRow}>
          <Text
            style={[styles.kind, { color: semanticColors.textMuted }]}
            numberOfLines={1}
          >
            {meta.label}
          </Text>
          {when.length > 0 ? (
            <Text style={[styles.when, { color: semanticColors.textMuted }]}>
              {when}
            </Text>
          ) : null}
        </View>
        <Text
          style={[styles.excerpt, { color: semanticColors.textPrimary }]}
          numberOfLines={2}
        >
          {result.excerpt}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={semanticColors.textMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  iconWrap: { paddingTop: 1 },
  body: { flex: 1, gap: spacing.xs },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  kind: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  when: { fontSize: 12 },
  excerpt: { fontSize: 15, lineHeight: 20 },
});
