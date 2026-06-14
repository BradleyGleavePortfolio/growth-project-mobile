/**
 * WearablePromptCard — a single COACH-ONLY AI-generated coaching prompt card
 * (v3-4). Shows the human-readable coaching text, the source-attribution pills
 * (which real WearableSample drove it), and two actions: "Dismiss" and "Mark
 * acted on". An already-dismissed or already-acted prompt renders a calm status
 * line instead of the action row (the server is idempotent, but the UI should
 * not offer an action that is already taken).
 *
 * No raw health VALUE is ever surfaced to a client; this card is rendered only
 * inside the coach prompts surface (itself flag- + role-gated). Tokens only (no
 * raw hex), line Ionicons only (no emoji), fontWeight <= '600'.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import type { PromptView } from '../../api/communityWearablePromptsApi';
import WearablePromptSourcePill from './WearablePromptSourcePill';

export interface WearablePromptCardProps {
  prompt: PromptView;
  onDismiss: (promptId: string) => void;
  onActOn: (promptId: string) => void;
  /** Disables the action buttons while a mutation for THIS prompt is inflight. */
  busy?: boolean;
  testID?: string;
}

export default function WearablePromptCard({
  prompt,
  onDismiss,
  onActOn,
  busy = false,
  testID,
}: WearablePromptCardProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const isDismissed = prompt.dismissedAt != null;
  const isActedOn = prompt.actedOnAt != null;
  const resolved = isDismissed || isActedOn;

  const statusLine = isActedOn
    ? 'Marked as acted on'
    : isDismissed
      ? 'Dismissed'
      : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={prompt.promptText}
      testID={testID ?? `wearable-prompt-card-${prompt.id}`}
    >
      <Text style={[styles.body, { color: semanticColors.textPrimary }]}>
        {prompt.promptText}
      </Text>

      {prompt.sources.length > 0 ? (
        <View
          style={styles.sources}
          testID={`wearable-prompt-sources-${prompt.id}`}
        >
          {prompt.sources.map((s) => (
            <WearablePromptSourcePill key={s.sampleId} source={s} />
          ))}
        </View>
      ) : null}

      {resolved ? (
        <View style={styles.statusRow} testID={`wearable-prompt-status-${prompt.id}`}>
          <Ionicons
            name={isActedOn ? 'checkmark-circle-outline' : 'close-circle-outline'}
            size={16}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.status, { color: semanticColors.textMuted }]}>
            {statusLine}
          </Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            onPress={() => onDismiss(prompt.id)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Dismiss prompt"
            accessibilityState={{ disabled: busy }}
            hitSlop={8}
            testID={`wearable-prompt-dismiss-${prompt.id}`}
            style={[
              styles.secondaryBtn,
              { borderColor: semanticColors.border, opacity: busy ? 0.5 : 1 },
            ]}
          >
            <Text style={[styles.secondaryLabel, { color: semanticColors.textMuted }]}>
              Dismiss
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onActOn(prompt.id)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Mark prompt as acted on"
            accessibilityState={{ disabled: busy }}
            hitSlop={8}
            testID={`wearable-prompt-act-${prompt.id}`}
            style={[
              styles.primaryBtn,
              { backgroundColor: semanticColors.accent, opacity: busy ? 0.5 : 1 },
            ]}
          >
            <Text style={[styles.primaryLabel, { color: semanticColors.textOnAccent }]}>
              Mark acted on
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  body: { fontSize: 15, lineHeight: 22 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  status: { fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  secondaryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryLabel: { fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryLabel: { fontSize: 14, fontWeight: '600' },
});
