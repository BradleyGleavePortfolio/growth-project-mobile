/**
 * pushTapRouter — turns a push-notification tap into a navigation.
 *
 * App.tsx installs `installNotificationResponseHandler(routePushTap)` once.
 * RootNavigator owns the NavigationContainer ref and calls
 * `attachPushNavigator(ref)` + `flushPendingPushTap()` whenever the mounted
 * navigator changes (auth → client, splash → ready). A tap that arrives
 * before the right navigator is mounted (cold start, still signing in) is
 * held and replayed; a second delivery of the same notification id (the
 * cold-start replay plus the live listener) is ignored.
 *
 * `actionScreen` values come from a constrained server enum (see
 * screens/notifications/README.md routing table). Client screens live in
 * nested stacks, so known names are mapped to their tab. Unknown names fall
 * back to a plain navigate (bubbling), which is a no-op if unhandled.
 */

export interface PushNavigator {
  isReady(): boolean;
  navigate(name: string, params?: object): void;
  getRootState(): { routeNames?: readonly string[] } | undefined;
}

/** Client (student) routes that live inside a tab stack. */
export const CLIENT_PUSH_ROUTES: Record<string, 'Home' | 'MoreTab' | 'WorkoutTab' | 'Log'> = {
  Messages: 'Home',
  NotificationCenter: 'Home',
  Notifications: 'Home',
  Habits: 'Home',
  Timeline: 'MoreTab',
  MoreIndex: 'MoreTab',
  Membership: 'MoreTab',
  Deliverables: 'MoreTab',
  WorkoutMain: 'WorkoutTab',
};

const AUTH_ROUTE_NAMES = ['Welcome', 'Login', 'CreateAccount', 'RoleSelection'];

let navigator: PushNavigator | null = null;
let pending: { screen: string; params?: Record<string, string> } | null = null;
const seen = new Set<string>();

export function attachPushNavigator(nav: PushNavigator): () => void {
  navigator = nav;
  return () => {
    if (navigator === nav) navigator = null;
  };
}

export function routePushTap(
  actionScreen?: string,
  actionParams?: Record<string, string>,
  notificationId?: string,
): void {
  if (!actionScreen || typeof actionScreen !== 'string') return;
  if (notificationId) {
    if (seen.has(notificationId)) return;
    seen.add(notificationId);
  }
  pending = { screen: actionScreen, params: actionParams };
  flushPendingPushTap();
}

/** Returns true when a pending tap was delivered. */
export function flushPendingPushTap(): boolean {
  if (!pending || !navigator || !navigator.isReady()) return false;
  const routeNames = navigator.getRootState()?.routeNames ?? [];
  // Signed-out / auth stack mounted: hold the tap until the app navigator is up.
  if (routeNames.some((n) => AUTH_ROUTE_NAMES.includes(n))) return false;
  if (routeNames.length === 0) return false;

  const { screen, params } = pending;
  const tab = CLIENT_PUSH_ROUTES[screen];
  try {
    if (routeNames.includes(screen)) {
      navigator.navigate(screen, params);
    } else if (tab && routeNames.includes(tab)) {
      navigator.navigate(tab, { screen, params });
    } else {
      navigator.navigate(screen, params);
    }
  } catch {
    // Unroutable target: drop it rather than crash.
  }
  pending = null;
  return true;
}

/** Test-only reset. */
export function __resetPushTapRouterForTests(): void {
  navigator = null;
  pending = null;
  seen.clear();
}
