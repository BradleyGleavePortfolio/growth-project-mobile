/**
 * Unread notification count for the client bell (polls every 30 s and on
 * foreground). Moved out of ClientNavigator, where it fed a headerRight bell
 * that never rendered (Home stack is headerShown:false). Now used by
 * components/home/HomeHeaderActions, and by the UI-2 coach Home's bell with
 * `enabled` = screen focus: it pauses off screen and re-reads on each return.
 * FR-880: a block or unblock reads it again at once, not on the next 30 s tick.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { fetchUnreadCount } from '../services/notificationsApi';
import { useBlockedUsersStore } from '../store/blockedUsersStore';
import { logger } from '../utils/logger';
import { normalizeError } from '../screens/client/_completionLogging';

export function useClientUnreadCount(enabled = true): number {
  const [count, setCount] = useState(0);
  const blocked = useBlockedUsersStore((st) => st.blocked);
  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    const refresh = async () => {
      try {
        const n = await fetchUnreadCount();
        if (mounted) setCount(n);
      } catch (error) {
        // Non-fatal: the badge keeps its last-known count on a failed poll.
        // Surfaced for diagnosis rather than swallowed (R69) so a persistently
        // failing unread-count fetch is visible instead of silently stale.
        logger.warn('clientNavigator.unread-count', {
          route: 'ClientNavigator',
          action: 'fetch-unread-count',
          error: normalizeError(error),
        });
      }
    };
    refresh();
    const interval = setInterval(refresh, 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      mounted = false;
      clearInterval(interval);
      sub.remove();
    };
  }, [enabled, blocked]);
  return count;
}
