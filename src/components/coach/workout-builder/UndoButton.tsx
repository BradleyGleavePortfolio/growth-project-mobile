/**
 * UndoButton — EW2 toolbar undo glyph for the coach workout builder.
 *
 * A single, calm toolbar button (left-justified, hairline-divided from the
 * title per the doctrine) that reverts the coach's last edit. It binds the SAME
 * `onUndo` handler to a two-finger swipe-down gesture (matches the doctrine
 * spec in MOBILE_WORKOUT_INVENTORY.md §3) so the gesture and the button are
 * interchangeable.
 *
 * State contract (EW2 spec):
 *   - When `canUndo` is false the button is DISABLED: 50% opacity,
 *     `accessibilityState.disabled = true`, no press, and the gesture does not
 *     fire (the handler is gated on `canUndo`).
 *   - The glyph is a line Ionicons `arrow-undo-outline` (no emoji, doctrine §
 *     line-icon rule).
 *
 * Tokens only — `semanticColors.bgSurface` for the hairline-divided container,
 * `accentText` for the enabled glyph, `border` for the divider hairline (the
 * designated divider/hairline token; `textMuted` would be wrong for a structural
 * separator). No raw hex, no `surface` shorthand (theme token is `bgSurface`).
 *
 * Decoupled by design: this component owns NO command-stack state. It is a pure
 * presentation + gesture surface driven by `canUndo` and `onUndo`, so the screen
 * (which owns `useBuilderCommandStack`) stays the single source of truth.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { spacing } from '../../../theme/tokens';
import type { SemanticTokens } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';

export interface UndoButtonProps {
  /** Fired by a tap OR a two-finger swipe-down. No-op upstream when stack empty. */
  onUndo: () => void;
  /** Whether there is anything to undo. Drives enabled/disabled presentation. */
  canUndo: boolean;
  /** testID for the pressable (defaults to a stable id the screen/tests use). */
  testID?: string;
}

export default function UndoButton({
  onUndo,
  canUndo,
  testID = 'mwb-undo-button',
}: UndoButtonProps): React.JSX.Element {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  // Two-finger swipe-down: a Pan gesture constrained to exactly two pointers
  // moving downward. `runOnJS(true)` so the JS `onUndo` (which touches React
  // Query / autosave) runs on the JS thread, not a worklet. Gated on `canUndo`
  // so a swipe with an empty stack is inert — the gesture and the button share
  // the exact same enable contract.
  const swipeDown = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minPointers(2)
        .maxPointers(2)
        .onEnd((e) => {
          if (!canUndo) return;
          // Downward fling: positive translationY past a small threshold.
          if (e.translationY > 40) {
            onUndo();
          }
        }),
    [canUndo, onUndo],
  );

  return (
    <GestureDetector gesture={swipeDown}>
      <View style={styles.container} testID={`${testID}-container`}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel="Undo last change"
          accessibilityState={{ disabled: !canUndo }}
          disabled={!canUndo}
          onPress={() => {
            if (!canUndo) return;
            onUndo();
          }}
          style={[styles.button, !canUndo && styles.buttonDisabled]}
          hitSlop={8}
        >
          <Ionicons
            name="arrow-undo-outline"
            size={22}
            color={canUndo ? sc.accentText : sc.textMuted}
          />
        </Pressable>
        <View style={styles.divider} />
      </View>
    </GestureDetector>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      // Hairline-divided from the title: a calm surface chip on the left.
      backgroundColor: sc.bgSurface,
      borderRadius: 8,
    },
    button: {
      // >= 44dp touch target (accessibility), with a comfortable glyph inset.
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    buttonDisabled: {
      // EW2: disabled = 50% opacity.
      opacity: 0.5,
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      marginVertical: spacing.xs,
      backgroundColor: sc.border,
    },
  });
}
