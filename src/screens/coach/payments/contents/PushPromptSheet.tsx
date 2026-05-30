/**
 * PushPromptSheet — PR-17 M3 (the "trigger = prompt each time" step from
 * PR-17 decision #3).
 *
 * When a coach attaches NEW content or edits an existing item's cadence/details
 * on the package-contents screen, they are ASKED whether the change should push
 * to EXISTING buyers (vs apply to future buyers only). This component is the
 * PROMPT UI ONLY — a bottom sheet that asks exactly that one question. It does
 * NOT run the confirm/preview (M4) and does NOT wire into the screen (M5).
 *
 * ── UI Bible compliance (graded) ─────────────────────────────────────────────
 *  • CALM + one-concept-per-moment: the sheet asks ONE question. Two explicit
 *    choices + a dismiss. No secondary clutter, no numbers (the real buyer
 *    count + date preview belong to M4).
 *  • Hick's Law: ONE primary path with a smart default — "Send to existing
 *    buyers" is the affirmative primary (forest fill, visually dominant);
 *    "Just future buyers" is the de-emphasised secondary; dismiss is a quiet
 *    close affordance.
 *  • Miller's Law: ≤5 elements on screen — title, one-line explainer, primary
 *    button, secondary button, dismiss (close).
 *  • Warm copy: title "Share this update?"; the body names the content title so
 *    the coach knows exactly what they are about to send.
 *  • Brand / NO hardcoded hex: all colours come from useTheme() — semanticColors
 *    for surfaces/text and the forest brand token for the primary accent (Forest
 *    is the primary accent per the doctrine). No hex is hand-typed in this file;
 *    the scrim is derived from the ink token via withAlpha().
 *  • Error-prevention / accessibility: every action has an accessible label +
 *    testID (`push-prompt-existing`, `push-prompt-future`, `push-prompt-dismiss`),
 *    a ≥44pt touch target, and the sheet respects the bottom safe-area inset.
 *
 * Pattern reuse (consistency): mirrors the transparent slide-up RN <Modal> +
 * scrim Pressable bottom-sheet precedent in AskAiActionSheet.tsx, and the
 * primary-button shape from ContentAttachForm.tsx. No new dependency is added
 * (datetimepicker belongs to M4).
 */

import React, { useMemo } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../../../theme/useTheme';
import type { SemanticTokens } from '../../../../theme/tokens';
import { colors as palette, typography, radius, spacing } from '../../../../theme/tokens';

/**
 * The mode that triggered the prompt — matches PR-17 decision #4 coverage.
 * Exported so M5 (the wiring layer) and M4 (the confirm step) can share the
 * exact same union without re-declaring it.
 */
export type PushPromptMode = 'new_content' | 'cadence_edit' | 'full_edit';

/**
 * Props contract — STABLE. M5 wires this without changes; if this shape ever
 * changes it must be documented loudly in the build report so M5's brief can
 * match. Kept minimal: M3 owns the CHOICE, not the numbers.
 */
export interface PushPromptSheetProps {
  /** Controls visibility of the bottom sheet. */
  visible: boolean;
  /** The content's display title, woven into the warm body copy. */
  contentTitle: string;
  /** Which change triggered the prompt (decision #4 coverage). */
  mode: PushPromptMode;
  /**
   * Optional one-line audience hint (e.g. "12 buyers already own this"). M3
   * stays about the choice, not the numbers — the real buyer count + date
   * preview live in M4 — but a caller may pass a soft hint if available.
   */
  audienceHint?: string;
  /** Coach chose: push to existing buyers (→ M5 opens the M4 confirm step). */
  onPushExisting: () => void;
  /** Coach chose: apply to future buyers only, no push. */
  onFutureOnly: () => void;
  /** Sheet closed without choosing (scrim tap, close icon, hardware back). */
  onDismiss: () => void;
}

// ── Mode → warm explainer copy ────────────────────────────────────────────────
// One short line per mode. No numbers (M4 owns the real count + date preview).
function explainerForMode(mode: PushPromptMode, contentTitle: string): string {
  const titled = contentTitle.trim().length > 0 ? `“${contentTitle.trim()}”` : 'this update';
  switch (mode) {
    case 'new_content':
      return `Send ${titled} to the buyers who already own this package, or add it for future buyers only.`;
    case 'cadence_edit':
      return `Apply the new timing for ${titled} to buyers who already own this package, or only to future buyers.`;
    case 'full_edit':
      return `Share your changes to ${titled} with buyers who already own this package, or keep them for future buyers only.`;
    default:
      return `Send ${titled} to buyers who already own this package, or apply it to future buyers only.`;
  }
}

/**
 * withAlpha — derive an rgba() string from a theme hex token + alpha so the
 * scrim colour stays sourced from the palette rather than a hand-typed hex.
 */
function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function PushPromptSheet({
  visible,
  contentTitle,
  mode,
  audienceHint,
  onPushExisting,
  onFutureOnly,
  onDismiss,
}: PushPromptSheetProps): React.ReactElement {
  const { semanticColors: colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const explainer = explainerForMode(mode, contentTitle);

  return (
    <Modal
      visible={visible}
      onRequestClose={onDismiss}
      animationType="slide"
      transparent
      testID="push-prompt-sheet"
    >
      <View style={styles.scrim}>
        {/* Scrim tap dismisses without choosing (error-prevention: closing is
            never a destructive commitment). */}
        <Pressable
          style={styles.scrimPress}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          testID="push-prompt-scrim"
        />

        <View
          style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}
          accessibilityViewIsModal
        >
          {/* Header row: title + quiet close affordance (Miller element 1 + 5). */}
          <View style={styles.headerRow}>
            <Text style={styles.title} accessibilityRole="header">
              Share this update?
            </Text>
            <Pressable
              onPress={onDismiss}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close without sending"
              testID="push-prompt-dismiss"
            >
              <Text style={styles.closeGlyph}>✕</Text>
            </Pressable>
          </View>

          {/* One-line explainer (Miller element 2). */}
          <Text style={styles.explainer}>{explainer}</Text>

          {audienceHint && audienceHint.trim().length > 0 ? (
            <Text style={styles.audienceHint} testID="push-prompt-audience-hint">
              {audienceHint.trim()}
            </Text>
          ) : null}

          {/* PRIMARY affirmative — forest fill, visually dominant (Hick's Law
              smart-default emphasis). Miller element 3. */}
          <Pressable
            style={styles.primaryBtn}
            onPress={onPushExisting}
            accessibilityRole="button"
            accessibilityLabel="Send to existing buyers"
            accessibilityHint="Pushes this update to buyers who already own this package"
            testID="push-prompt-existing"
          >
            <Text style={styles.primaryBtnText}>Send to existing buyers</Text>
          </Pressable>

          {/* SECONDARY — de-emphasised (text-weight, no fill). Miller element 4. */}
          <Pressable
            style={styles.secondaryBtn}
            onPress={onFutureOnly}
            accessibilityRole="button"
            accessibilityLabel="Just future buyers"
            accessibilityHint="Applies this update to future buyers only, with no push"
            testID="push-prompt-future"
          >
            <Text style={styles.secondaryBtnText}>Just future buyers</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: SemanticTokens) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      // Scrim derived from the ink palette token (no hand-typed hex).
      backgroundColor: withAlpha(palette.ink, 0.45),
      justifyContent: 'flex-end',
    },
    scrimPress: { flex: 1 },
    sheet: {
      backgroundColor: colors.bgSurface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      ...typography.h3,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    closeBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: -spacing.sm,
    },
    closeGlyph: {
      ...typography.bodyMd,
      color: colors.textMuted,
    },
    explainer: {
      ...typography.body,
      color: colors.textMuted,
      marginTop: spacing.sm,
    },
    audienceHint: {
      ...typography.bodySmall,
      color: colors.textMuted,
      marginTop: spacing.xs,
    },
    primaryBtn: {
      // Forest is the PRIMARY accent (doctrine). Dominant affirmative path.
      backgroundColor: palette.forest,
      borderRadius: radius.sm,
      minHeight: 48,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.lg,
    },
    primaryBtnText: {
      ...typography.bodyMd,
      // Bone reads as the on-forest foreground (no hand-typed hex).
      color: palette.bone,
    },
    secondaryBtn: {
      minHeight: 44,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.sm,
    },
    secondaryBtnText: {
      ...typography.bodyMd,
      color: colors.textMuted,
    },
  });
}

export default PushPromptSheet;
