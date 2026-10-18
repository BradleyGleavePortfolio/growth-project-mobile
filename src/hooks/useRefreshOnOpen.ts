/**
 * useRefreshOnOpen — re-reads a screen each time it is opened again: when it comes back into focus
 * ('focus') and when the app returns to the foreground while it is in focus ('foreground'). This is
 * the focus and foreground pattern Home's header uses for unread messages (HomeHeaderActions). The
 * first focus is the mount, whose reads are already running, so it is skipped.
 */
import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export type OpenReason = 'focus' | 'foreground';

export function useRefreshOnOpen(refresh: (why: OpenReason) => void): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) latest.current('focus');
      focusedBefore.current = true;
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') latest.current('foreground');
      });
      return () => sub.remove();
    }, []),
  );
}
