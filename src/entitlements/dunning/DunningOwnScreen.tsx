import React, { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { DunningBanner } from './DunningBanner';
import { useDunning } from './DunningLockoutProvider';

/**
 * Owner ruling 2026-10-08 23:5x: a locked client keeps their own logging.
 * withProtectedScreen wraps every OWN screen in this. While locked, the
 * lockout steps aside (OPEN_FOR_OWN_LOGGING) and the DunningBanner sits at
 * the foot, above the tab bar, hidden while the keyboard is up. Same tree
 * locked or not, so a live workout never remounts when the lock lands.
 */
export function DunningOwnScreen({ surface, children }: { surface: string; children: React.ReactNode }) {
  const locked = useDunning()?.locked === true;
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    if (!locked) return undefined;
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [locked]);

  return (
    <View style={styles.fill}>
      <View style={styles.fill}>{children}</View>
      {locked && !keyboardUp ? <DunningBanner surface={surface} presentation="locked" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
