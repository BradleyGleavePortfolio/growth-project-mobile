/**
 * REPORT-ANY-M (#200-S4, owner #201-E6 item 7): "when you press and hold ANY message, you should be able to report that
 * message". The one hold helper beside SafetyMenu (its own file, so the suites that stand SafetyMenu in keep drawing
 * their screens). A hold opens that item's own SafetyMenu through its way in (SafetyMenuHandle), so it shows exactly
 * the rows its ••• shows and sends exactly what its ••• sends; where no menu is drawn, a hold does nothing.
 */
import React, { useMemo, useRef } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { HapticService } from '../../ui/haptics/haptics.service';
import type { SafetyMenuHandle } from './SafetyMenu';

/** The press and hold, after 350 ms as the space chat's rows (one medium haptic, only when a
 * menu opens). */
export interface SafetyHoldBinding {
  onLongPress: () => void;
  delayLongPress: number;
}

/**
 * REPORT-ANY-M: the one hold helper. Each item's own SafetyMenu takes `menu(key)` as its ref; the element the finger
 * lands on takes `hold(key)`: spread onto a pressable the item already is (its own onLongPress; a tap keeps its own
 * job), else through SafetyHold. A hold opens that item's menu exactly as its ••• does; with no menu drawn, nothing.
 */
export function useSafetyHolds(): {
  menu: (key: string) => (handle: SafetyMenuHandle | null) => void;
  hold: (key: string) => SafetyHoldBinding;
} {
  const menus = useRef(new Map<string, SafetyMenuHandle>());
  return useMemo(() => ({
    menu: (key) => (handle) => {
      if (handle) menus.current.set(key, handle);
      else menus.current.delete(key);
    },
    hold: (key) => ({
      onLongPress: () => {
        if (menus.current.get(key)?.open()) void HapticService.mediumImpact();
      },
      delayLongPress: 350,
    }),
  }), []);
}

/**
 * REPORT-ANY-M: where the held element is a plain View, this stands in its place with the View's own style and testID:
 * no look, padding or ripple of its own, and not one accessible element, so a screen reader still reaches the item's
 * words and its ••• as before. With no hold it is that same plain View.
 */
export function SafetyHold({ hold, style, testID, children }: {
  hold?: SafetyHoldBinding;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  if (!hold) return <View style={style} testID={testID}>{children}</View>;
  return <Pressable {...hold} accessible={false} style={style} testID={testID}>{children}</Pressable>;
}

