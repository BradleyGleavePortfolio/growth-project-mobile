/**
 * AutosaveStatusPill — the calm, always-visible save-state header pill for the
 * workout builder (MWB-4, MASTER_WORKOUT_BUILDER_SPEC.md §6.5).
 *
 * States (the exact vocabulary from the spec):
 *   - 'saved'    -> "Saved · Xs ago"            (settled, reassuring)
 *   - 'saving'   -> "Saving…"                   (in-flight)
 *   - 'offline'  -> "Offline — saved on device, will sync"  (queued; CALM, never alarm red)
 *   - 'conflict' -> "Edited elsewhere — tap to refresh"
 *   - 'idle'     -> nothing rendered yet (no edits, no residue)
 *
 * Design doctrine applied:
 *   - CALM treatment for the anxiety moment (§4.7 / design §5.5): offline is the
 *     OfflineBanner's warm gold-brown, NOT a danger red — "your work is safe,
 *     it'll sync", not "error". A coach who just backgrounded the app must feel
 *     reassured, not alarmed.
 *   - Meaning WITHOUT colour alone: every state pairs an icon + text label, so a
 *     colour-blind coach (or a greyscale screenshot) reads the state from the
 *     glyph + words, not the hue.
 *   - Reduced-motion is REAL: the "Saving…" pulse is suppressed when the OS
 *     reduce-motion setting is on (the hook deps include `reduceMotion`); the
 *     pill then shows a static dot. No motion is ever required to read state.
 *   - Consistency tax avoided (§4.7): reuses the OfflineBanner visual vocabulary
 *     (cloud-offline glyph, warm-gold fill) so "offline" reads identically to
 *     the app-wide banner the coach already knows.
 *   - Touch target ≥48dp WHEN interactive: a conflict/offline pill is tappable
 *     (to trigger a manual refresh/retry) and hits the 48dp minimum; the
 *     settled 'saved'/'saving' pill is non-interactive chrome and is not padded
 *     to a fake button size.
 *
 * Copy note (Roman-voice gate): these are FUNCTIONAL save-state labels — the
 * same category as OfflineBanner's own string — NOT brand-voiced empty/error
 * content. The Roman-voice "copy from backend payload, never local constants"
 * rule governs Roman empty/error STATES; a status indicator's microcopy is
 * chrome and lives with the component, mirroring OfflineBanner.tsx.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography, radius, semantic } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useReduceMotion } from '../../screens/client/wearables/components/useReduceMotion';
import type { AutosaveStatus } from '../../hooks/useAutosave';

export interface AutosaveStatusPillProps {
  status: AutosaveStatus;
  /** Wallclock ms of the last confirmed save (drives "Xs ago"). */
  lastSavedAt: number | null;
  /**
   * Optional tap handler for the recoverable states (offline/conflict) — e.g.
   * "retry now" / "refresh". When omitted the pill is non-interactive.
   */
  onPress?: () => void;
  /** Test id for the integration tests. */
  testID?: string;
}

/** Relative "Xs ago" / "Xm ago" string for the saved state. */
function relativeSavedLabel(lastSavedAt: number | null, now: number): string {
  if (lastSavedAt == null) return 'Saved';
  const deltaSec = Math.max(0, Math.round((now - lastSavedAt) / 1000));
  if (deltaSec < 5) return 'Saved · just now';
  if (deltaSec < 60) return `Saved · ${deltaSec}s ago`;
  const mins = Math.round(deltaSec / 60);
  if (mins < 60) return `Saved · ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `Saved · ${hrs}h ago`;
}

interface PillVisual {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  fg: string;
  bg: string;
  border: string;
  /** Whether this state invites a tap (and thus needs a 48dp target). */
  interactive: boolean;
  /**
   * State-specific a11y hint for the interactive (tappable) states. Conflict
   * resolution reloads the latest version; offline retries the queued sync.
   * Omitted for non-interactive states.
   */
  hint?: string;
}

export default function AutosaveStatusPill(props: AutosaveStatusPillProps) {
  const { status, lastSavedAt, onPress, testID } = props;
  const { semanticColors: sc } = useTheme();
  const reduceMotion = useReduceMotion();

  // Tick once a second while 'saved' so the relative label stays fresh without
  // a render storm. Only runs in the saved state.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (status !== 'saved') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Pulse the saving dot — suppressed entirely under reduce-motion (static dot).
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (status !== 'saving' || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, reduceMotion, pulse]);

  const visual = useMemo<PillVisual | null>(() => {
    switch (status) {
      case 'idle':
        return null;
      case 'saving':
        return {
          label: 'Saving…',
          icon: 'sync-outline',
          fg: sc.textMuted,
          bg: sc.bgSurface,
          border: sc.border,
          interactive: false,
        };
      case 'saved':
        return {
          label: relativeSavedLabel(lastSavedAt, now),
          icon: 'checkmark-circle-outline',
          fg: semantic.success.fg,
          bg: semantic.success.bg,
          border: semantic.success.border,
          interactive: false,
        };
      case 'offline':
        // CALM: warm gold-brown (the OfflineBanner hue), never danger red. The
        // copy explicitly reassures that the edit is preserved on-device and
        // will sync — the core reassurance job of this anxiety moment.
        return {
          label: 'Offline — saved on device, will sync',
          icon: 'cloud-offline-outline',
          fg: semantic.warning.fg,
          bg: semantic.warning.bg,
          border: semantic.warning.border,
          interactive: true,
          hint: 'Tap to retry syncing now',
        };
      case 'conflict':
        // CALM, action-oriented: "tap to refresh" describes the next action
        // without implying data loss, and stays accurate after a refetch (the
        // earlier "refreshing" went stale once the refetch completed/failed).
        return {
          label: 'Edited elsewhere — tap to refresh',
          icon: 'refresh-outline',
          fg: semantic.warning.fg,
          bg: semantic.warning.bg,
          border: semantic.warning.border,
          interactive: true,
          hint: 'Tap to reload the latest version',
        };
      default:
        return null;
    }
  }, [status, lastSavedAt, now, sc]);

  if (!visual) return null;

  const a11yLabel = visual.label;
  const dot = (
    <Animated.View style={{ opacity: status === 'saving' ? pulse : 1 }}>
      <Ionicons name={visual.icon} size={14} color={visual.fg} />
    </Animated.View>
  );

  const body = (
    <View
      style={[
        styles.pill,
        { backgroundColor: visual.bg, borderColor: visual.border },
        visual.interactive ? styles.interactivePadding : null,
      ]}
    >
      {dot}
      <Text
        style={[typography.caption, styles.label, { color: visual.fg }]}
        numberOfLines={1}
      >
        {visual.label}
      </Text>
    </View>
  );

  // `saving` is the only busy state; settled/recoverable states are not busy.
  const accessibilityState = { busy: status === 'saving' };

  if (visual.interactive && onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={visual.hint}
        accessibilityState={accessibilityState}
        accessibilityLiveRegion="polite"
        onPress={onPress}
        style={styles.tapTarget as ViewStyle}
        hitSlop={8}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      accessibilityState={accessibilityState}
      accessibilityLiveRegion="polite"
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  // Non-interactive states sit at a compact chip height; interactive states get
  // padded to a ≥48dp tap target via `tapTarget` + `interactivePadding`.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-start',
  },
  interactivePadding: {
    paddingVertical: spacing.sm,
  },
  // 48dp minimum hit area for the tappable (offline/conflict) states.
  tapTarget: {
    minHeight: 48,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  label: {
    fontWeight: '600',
  },
});
