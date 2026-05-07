/**
 * AISourceBadge — audit / source-display primitive for AI Gateway drafts.
 *
 * Renders a single line attributing an AI-generated draft to a provider +
 * model + grounding timestamp, plus the approval actor when present. This is
 * the *audit* surface — required wherever an AI draft is shown to a user, so
 * the doctrine "AI summarises, a human approves" remains visible.
 *
 * Companion to PR #100's `AINote` (which carries the disclaimer copy) and
 * `SignoffStatusChip` (which renders the approval lifecycle). This component
 * specifically surfaces *where the draft came from* and *whether the
 * underlying data is fresh*.
 *
 * Doctrine guardrails enforced here:
 *   - Provider/model strings are display-only — UI never branches on them.
 *   - When `approval.actor === null`, the "approved by" line is omitted; the
 *     component never invents an approver.
 *   - When `isStale === true`, the freshness chip flips to "source stale" and
 *     the component refuses to render `groundedAt` as if it were current.
 *
 * Security: provider and model are opaque display strings. No PII is rendered
 * here. Token usage is tracked server-side only. The app never holds provider
 * keys — all AI calls are proxied through the backend gateway.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Spacing, Radius, Typography } from '../../theme/index';
import type { AIGatewayDraftOk } from '../../types/aiGateway';
import { aiGatewayFlags } from '../../config/aiGatewayFlags';

interface Props {
  draft: AIGatewayDraftOk;
  // Optional override of the global flag — useful for tests and a future
  // per-screen suppression (e.g. the screenshot reviewer mode).
  showSourceBadge?: boolean;
}

function formatTimestamp(iso: string): string {
  // Render YYYY-MM-DD HH:mm in the user's locale. We don't pull in dayjs/
  // date-fns here — the surface is small and the rest of the app uses
  // `toLocaleString`. If the input is malformed, fall back to the raw value
  // so the audit line is never empty.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function AISourceBadge({ draft, showSourceBadge }: Props) {
  const { colors } = useTheme();
  const enabled = showSourceBadge ?? aiGatewayFlags.showSourceBadge;
  if (!enabled) return null;

  const { source, approval, isStale } = draft;
  const generatedAt = formatTimestamp(source.generatedAt);
  const groundedAt = source.groundedAt
    ? formatTimestamp(source.groundedAt)
    : null;

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: colors.divider,
          backgroundColor: colors.surface,
        },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={[
        `AI-drafted by ${source.provider} ${source.model}`,
        `generated ${generatedAt}`,
        groundedAt
          ? isStale
            ? `data from ${groundedAt} (stale)`
            : `data from ${groundedAt}`
          : null,
        approval.actor
          ? `approved by ${approval.actor.role} ${approval.actor.name ?? ''}`.trim()
          : 'pending coach review',
      ]
        .filter(Boolean)
        .join('. ')}
      testID="ai-source-badge"
    >
      <Text style={[styles.line, { color: colors.textSecondary }]}>
        <Text style={{ color: colors.textMuted }}>AI draft · </Text>
        <Text style={{ color: colors.textSecondary }}>
          {source.provider} {source.model}
        </Text>
      </Text>
      <Text style={[styles.line, { color: colors.textSecondary }]}>
        <Text style={{ color: colors.textMuted }}>Generated · </Text>
        <Text style={{ color: colors.textSecondary }}>{generatedAt}</Text>
      </Text>
      {groundedAt && (
        <Text style={[styles.line, { color: colors.textSecondary }]}>
          <Text style={{ color: colors.textMuted }}>Grounded in data · </Text>
          <Text
            style={{
              color: isStale ? colors.warning : colors.textSecondary,
            }}
          >
            {groundedAt}
            {isStale ? ' (stale)' : ''}
          </Text>
        </Text>
      )}
      <Text style={[styles.line, { color: colors.textSecondary }]}>
        <Text style={{ color: colors.textMuted }}>Status · </Text>
        {approval.actor ? (
          <Text style={{ color: colors.textSecondary }}>
            approved by {approval.actor.role}
            {approval.actor.name ? ` · ${approval.actor.name}` : ''}
          </Text>
        ) : (
          <Text style={{ color: colors.warning }}>pending coach review</Text>
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  line: {
    ...Typography.caption,
    marginBottom: 2,
  },
});
