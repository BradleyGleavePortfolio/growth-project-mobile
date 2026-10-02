/**
 * pushTapRouter — turns a push-notification tap into a navigation.
 *
 * App.tsx installs `installNotificationResponseHandler(routePushTap)` once.
 * RootNavigator owns the NavigationContainer ref and calls
 * `attachPushNavigator(ref)` once, then `setPushSession(...)` on every auth
 * state change and `flushPendingPushTap()` on navigator ready / state change.
 *
 * Fix round (#304 audits, Sol B2/B3/C2, Opus C3):
 *  - Delivery is gated on an EXPLICIT app-ready session set by RootNavigator
 *    (`{ kind: 'app', role }`), not on a list of auth route names. While the
 *    session is bootstrapping or in onboarding (lean questions, Day-1, coach
 *    wizard, Day-1 win) a tap is held, never consumed into a navigator that
 *    does not own the destination.
 *  - A held tap is bound to the user it arrived for. Sign-out drops it; a
 *    tap that arrives while signed out is dropped, not held (so a late
 *    `getLastNotificationResponseAsync` cannot replay into the next account);
 *    a session for a different user id drops it.
 *  - Destinations are an allow-listed, role-aware table of real nested
 *    routes (client tab stacks, coach ClientsStack / SettingsStack /
 *    CommunityStack). Flag-gated routes resolve only when their flag is on.
 *    Unknown names land on the role's notification center rather than a
 *    blind root navigate.
 *  - Params are decoded to a bounded string map; the delivered-id dedupe set
 *    is bounded.
 */
import { featureFlags } from '../config/featureFlags';
import { nonP2PPurchasesHidden } from '../config/purchaseSurfaces';

export interface PushNavigator {
  isReady(): boolean;
  navigate(name: string, params?: object): void;
  getRootState(): { routeNames?: readonly string[] } | undefined;
}

export type PushRole = 'student' | 'coach';

/**
 * - `unknown`: bootstrap has not resolved yet (cold start). Taps are held.
 * - `signedOut`: auth stack. Taps are dropped.
 * - `onboarding`: signed in, but the app navigator is not mounted yet. Held.
 * - `app`: the client or coach app navigator is mounted. Taps are delivered.
 */
export type PushSession =
  | { kind: 'unknown' }
  | { kind: 'signedOut' }
  | { kind: 'onboarding'; userId: string | null }
  | { kind: 'app'; userId: string | null; role: PushRole };

/** A resolved destination: root route, optional nested screen. */
interface Target {
  root: string;
  screen?: string;
}

type Resolver = () => Target | null;

/** Client (student) destinations. Root = ClientNavigator tab names. */
export const CLIENT_PUSH_ROUTES: Record<string, Resolver> = {
  Messages: () => ({ root: 'Home', screen: 'Messages' }),
  NotificationCenter: () => ({ root: 'Home', screen: 'NotificationCenter' }),
  // Legacy name: the Home stack's Notifications stub resolves to the center.
  Notifications: () => ({ root: 'Home', screen: 'NotificationCenter' }),
  Habits: () => ({ root: 'Home', screen: 'Habits' }),
  Timeline: () => ({ root: 'MoreTab', screen: 'Timeline' }),
  MoreIndex: () => ({ root: 'MoreTab', screen: 'MoreIndex' }),
  Membership: () => ({ root: 'MoreTab', screen: 'Membership' }),
  Deliverables: () => ({ root: 'MoreTab', screen: 'Deliverables' }),
  WorkoutMain: () => ({ root: 'WorkoutTab', screen: 'WorkoutMain' }),
  Log: () => ({ root: 'Log' }),
  // S-SCHED destination for the existing actionScreen/actionParams format.
  // Backend booking delivery must supply this format before launch; registering
  // a destination does not establish an end-to-end notification transport.
  // Flag off: the tab does not exist, so land on the notification center.
  CalendarSession: () =>
    featureFlags.clientCalendar
      ? { root: 'CalendarTab', screen: 'CalendarSession' }
      : { root: 'Home', screen: 'NotificationCenter' },
  CommunityEventDetail: () =>
    featureFlags.communityTab && featureFlags.communityEvents
      ? { root: 'CommunityTab', screen: 'CommunityEventDetail' }
      : null,
};

/** Coach destinations. Root = CoachNavigator tab names. */
export const COACH_PUSH_ROUTES: Record<string, Resolver> = {
  Messages: () => ({ root: 'Messages' }),
  NotificationCenter: () => ({ root: 'ClientsStack', screen: 'NotificationCenter' }),
  Notifications: () => ({ root: 'ClientsStack', screen: 'NotificationCenter' }),
  NotificationPreferences: () => ({ root: 'ClientsStack', screen: 'NotificationPreferences' }),
  // S-SCHED: coach booking pushes open the booking inbox.
  CoachBookingInbox: () => ({ root: 'ClientsStack', screen: 'CoachBookingInbox' }),
  // AI credit top-ups are not purchasable on hidden iOS builds: a budget
  // push lands on Settings, never on the checkout route (whose gated
  // wrapper would only say "Managed on the web").
  CreditPackCheckout: () =>
    nonP2PPurchasesHidden()
      ? { root: 'SettingsStack', screen: 'SettingsHome' }
      : { root: 'SettingsStack', screen: 'CreditPackCheckout' },
  CommunityEventDetail: () =>
    featureFlags.coachCommunity && featureFlags.communityEvents
      ? { root: 'CommunityStack', screen: 'CoachCommunityEvents' }
      : null,
  CoachCommunityEvents: () =>
    featureFlags.coachCommunity && featureFlags.communityEvents
      ? { root: 'CommunityStack', screen: 'CoachCommunityEvents' }
      : null,
};

/** The root route each role's navigator always mounts (readiness anchor). */
const ROLE_ANCHOR: Record<PushRole, string> = { student: 'Home', coach: 'ClientsStack' };
const ROLE_ROUTES: Record<PushRole, Record<string, Resolver>> = {
  student: CLIENT_PUSH_ROUTES,
  coach: COACH_PUSH_ROUTES,
};

export const MAX_SEEN_IDS = 200;
const MAX_PARAMS = 8;
const PARAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_PARAM_VALUE = 200;
const SCREEN_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

interface PendingTap {
  screen: string;
  params?: Record<string, string>;
  /** The signed-in user the tap belongs to; null while bootstrap is unknown. */
  ownerUserId: string | null;
}

let navigator: PushNavigator | null = null;
let pending: PendingTap | null = null;
let session: PushSession = { kind: 'unknown' };
const seen = new Set<string>();

/** Runtime decoder for untrusted push params: string values only, bounded. */
export function decodePushParams(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_PARAMS) break;
    if (!PARAM_KEY.test(k)) continue;
    if (typeof v === 'string' && v.length <= MAX_PARAM_VALUE) {
      out[k] = v;
      n += 1;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = String(v);
      n += 1;
    }
  }
  return n > 0 ? out : undefined;
}

function rememberId(id: string): void {
  seen.add(id);
  while (seen.size > MAX_SEEN_IDS) {
    const oldest = seen.values().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
}

function sessionUserId(s: PushSession): string | null {
  return s.kind === 'app' || s.kind === 'onboarding' ? s.userId : null;
}

/**
 * Map RootNavigator's auth state to a push session. Only the mounted client
 * (`student`, `package_prompt`) or coach (`coach`) navigator may receive a
 * tap; every onboarding root (LeanQ1-6, Day-1, CoachWizardStep1-6, Day-1 win)
 * holds it.
 */
export function pushSessionFor(authState: string, userId: string | null | undefined): PushSession {
  const uid = typeof userId === 'string' && userId ? userId : null;
  switch (authState) {
    case 'loading':
      return { kind: 'unknown' };
    case 'unauthenticated':
      return { kind: 'signedOut' };
    case 'student':
    case 'package_prompt':
      return { kind: 'app', userId: uid, role: 'student' };
    case 'coach':
      return { kind: 'app', userId: uid, role: 'coach' };
    default:
      return { kind: 'onboarding', userId: uid };
  }
}

export function attachPushNavigator(nav: PushNavigator): () => void {
  navigator = nav;
  return () => {
    if (navigator === nav) navigator = null;
  };
}

/**
 * RootNavigator reports every auth transition here. Sign-out drops a held
 * tap; a different signed-in user drops it; a tap held during bootstrap is
 * bound to the first signed-in user.
 */
export function setPushSession(next: PushSession): void {
  session = next;
  if (!pending) return;
  if (next.kind === 'signedOut') {
    pending = null;
    return;
  }
  if (next.kind === 'unknown') return;
  const uid = next.userId;
  if (pending.ownerUserId === null) {
    pending.ownerUserId = uid;
  } else if (uid !== null && uid !== pending.ownerUserId) {
    pending = null;
    return;
  }
  flushPendingPushTap();
}

export function routePushTap(
  actionScreen?: string,
  actionParams?: unknown,
  notificationId?: string,
): void {
  if (!actionScreen || typeof actionScreen !== 'string' || !SCREEN_NAME.test(actionScreen)) return;
  if (notificationId) {
    if (seen.has(notificationId)) return;
    rememberId(notificationId);
  }
  // Signed out: drop, never hold (Opus C3). The next account must not
  // receive this tap.
  if (session.kind === 'signedOut') return;
  pending = {
    screen: actionScreen,
    params: decodePushParams(actionParams),
    ownerUserId: sessionUserId(session),
  };
  flushPendingPushTap();
}

/** Resolve a destination for a role. Unknown or unavailable → notification center. */
export function resolvePushTarget(role: PushRole, screen: string): Target {
  const routes = ROLE_ROUTES[role];
  const resolver = Object.prototype.hasOwnProperty.call(routes, screen) ? routes[screen] : undefined;
  const t = resolver ? resolver() : null;
  return t ?? (routes.NotificationCenter() as Target);
}

/** Returns true when a pending tap was delivered. */
export function flushPendingPushTap(): boolean {
  if (!pending || !navigator || !navigator.isReady()) return false;
  if (session.kind !== 'app') return false;
  if (pending.ownerUserId !== null && session.userId !== null && pending.ownerUserId !== session.userId) {
    pending = null;
    return false;
  }
  const routeNames = navigator.getRootState()?.routeNames ?? [];
  // The role's navigator must actually be the mounted root (guards the
  // frame between an auth-state change and the navigator commit).
  if (!routeNames.includes(ROLE_ANCHOR[session.role])) return false;

  const { screen, params } = pending;
  let target = resolvePushTarget(session.role, screen);
  if (!routeNames.includes(target.root)) {
    target = resolvePushTarget(session.role, 'NotificationCenter');
  }
  pending = null;
  try {
    if (target.screen) {
      navigator.navigate(target.root, { screen: target.screen, params });
    } else {
      navigator.navigate(target.root, params);
    }
  } catch {
    // Unroutable target: drop it rather than crash.
  }
  return true;
}

/** Drop a held tap (kept for callers; setPushSession signedOut does this). */
export function clearPendingPushTap(): void {
  pending = null;
}

/** Test-only reset. */
export function __resetPushTapRouterForTests(): void {
  navigator = null;
  pending = null;
  session = { kind: 'unknown' };
  seen.clear();
}
