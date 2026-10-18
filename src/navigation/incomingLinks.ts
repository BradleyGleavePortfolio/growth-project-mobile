import { featureFlags } from '../config/featureFlags';
import { isValidPackageShareToken } from '../utils/packageShare';

/** The authority in a custom URL is a route segment, not a web host. */
export function incomingLinkPath(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)([?#].*)?$/i.exec(url);
  if (!match || /[\s\\]/.test(url)) return null;
  const [, rawScheme, host, path, suffix = ''] = match;
  const scheme = rawScheme.toLowerCase();
  if (scheme === 'https') {
    if (host.toLowerCase() !== 'app.trygrowthproject.com') return null;
    return path.replace(/^\/+/, '') + suffix;
  }
  if (scheme !== 'tgp' && scheme !== 'com.growthproject.app') return null;
  if (/[@:%]/.test(host)) return null;
  return (host + path).replace(/^\/+/, '') + suffix;
}

/** Only the auth stack is handled by React Navigation's native receiver. */
export function isPublicLinkPath(path: string): boolean {
  return /^(?:welcome|login|auth\/callback|verified|join(?:\/[^/?#]*)?|invite\/accept\/[^/?#]+|reset-password)(?:[?#]|$)/i.test(path);
}

export interface AppLinkTarget {
  root: string;
  screen?: string;
  initial?: false;
  pop?: true;
  params?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nested = (root: string, screen: string, params?: Record<string, string>): AppLinkTarget =>
  ({ root, screen, params, initial: false });

/** Existing screens only; never infer a route name or role from an external URL. */
export function resolveAppLink(path: string, role: 'student' | 'coach'): AppLinkTarget | null {
  let segments: string[];
  try {
    segments = path.split(/[?#]/, 1)[0].replace(/\/$/, '').split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  const [first, id] = segments;
  const plain = segments.join('/');
  const pair = segments.length === 2;
  const uuidPair = pair && UUID.test(id);
  if (role === 'student') {
    if (first === 'meal-plan' && uuidPair) return nested('MoreTab', 'ClientDailyMealPlan', { assignmentId: id });
    if (first === 'workouts' && uuidPair) return nested('MoreTab', 'WorkoutAssignmentDetail', { assignmentId: id });
    if (plain === 'workouts') return nested('WorkoutTab', 'WorkoutMain');
    if (plain === 'home') return nested('Home', 'HomeMain');
    if (plain === 'plan') return nested('MoreTab', 'ClientDailyMealPlan');
    if (plain === 'weight') return nested('MoreTab', 'Progress');
    if (plain === 'timeline') return nested('MoreTab', 'Timeline');
    if (plain === 'checkin/today') return nested('Home', 'Habits');
    if (plain === 'messages' || (first === 'messages' && uuidPair)) return nested('Home', 'Messages');
    if (plain === 'billing/update' || plain === 'billing/update-card') return nested('MoreTab', 'UpdateCard');
    if (first === 'p' && pair && isValidPackageShareToken(id)) return nested('MoreTab', 'PackageCheckout', { shareToken: id });
    const query = new URLSearchParams(path.split('?')[1]?.split('#')[0]);
    if (plain === 'wearables/connected') {
      const params: Record<string, string> = {};
      for (const key of ['status', 'provider', 'ticket']) {
        const value = query.get(key);
        if (value !== null && value.length <= 200) params[key] = value;
      }
      return nested('MoreTab', 'Connections', params);
    }
    if (first === 'checkout' && pair && (id === 'success' || id === 'cancel')) {
      const params: Record<string, string> = { outcome: id };
      const sessionId = query.get('session_id');
      if (sessionId && /^[A-Za-z0-9_]{1,200}$/.test(sessionId)) params.session_id = sessionId;
      return nested('MoreTab', 'CheckoutReturn', params);
    }
    if (featureFlags.clientCalendar) {
      const sessionId = first === 'sessions' && uuidPair ? id
        : segments.length === 3 && first === 'client' && id === 'sessions' && UUID.test(segments[2]) ? segments[2] : null;
      if (sessionId) return nested('CalendarTab', 'CalendarSession', { sessionId });
    }
    if (featureFlags.communityTab) {
      if (plain === 'community' || plain === 'community/home') return { root: 'CommunityTab' };
      if (segments.length === 3 && first === 'community' && UUID.test(segments[2])) {
        if (id === 'thread') return nested('CommunityTab', 'CommunityThread', { postId: segments[2] });
        if (id === 'dm') return nested('CommunityTab', 'CommunityDmThread', { recipientId: segments[2] });
      }
    }
    return null;
  }
  if (plain === 'messages' || (first === 'messages' && uuidPair)) {
    return featureFlags.coachTabsV2 ? { root: 'Messages', screen: 'MessagesInbox', pop: true } : { root: 'Messages' };
  }
  if (first !== 'coach') return null;
  if (id === 'clients' && UUID.test(segments[2] ?? '') &&
      (segments.length === 3 || (segments.length === 4 && segments[3] === 'checkins'))) {
    return nested('ClientsStack', 'ClientDetail', { clientId: segments[2], clientName: '' });
  }
  if (id === 'sessions' && segments.length === 3 && UUID.test(segments[2])) {
    return featureFlags.coachTabsV2 ? { root: 'CalendarStack', screen: 'CoachBookingInbox', pop: true }
      : nested('ClientsStack', 'CoachBookingInbox');
  }
  if (plain === 'coach/brief/today' && featureFlags.coachBrief) return nested('SettingsStack', 'CoachBrief');
  if (plain === 'coach/alerts') return { root: 'CommandCenter', params: { tab: 'action-queue' } };
  return null;
}
