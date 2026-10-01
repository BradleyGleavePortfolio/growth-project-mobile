/**
 * Coach signup attempts whose outcome was never proven (#306 fix rounds 3-4).
 *
 * A coach signup can reach the server and commit while its response is lost
 * (network drop, timeout, 5xx after commit). The app then says the outcome is
 * unconfirmed and that a retry with the same sign-in is safe. When the retry,
 * or a later sign-in on the Login screen, answers "existing account, not a
 * coach", that account may well be the one the lost attempt created (for
 * example the kill switch made it a client), so "this account already
 * existed" would be untrue, and silently entering the client app would hide
 * that the coach request was not applied. This marker lets every place that
 * gets a server answer (CreateAccount and Login, email, Apple and Google) say
 * "coach sign-up was not applied" instead, and lets CreateAccount keep the
 * "outcome unknown" state after the request itself has settled (#306 r4,
 * Sol B1-R3 / B2-R3).
 *
 * Scope: one entry per sign-in method and identity (the email for email
 * signups; the provider email when the provider gave one before the request),
 * short-lived, so a later person on a shared device does not inherit it.
 * An entry is resolved only by a server answer for the same method and
 * identity (never by a cancelled sheet, a refusal of a later request, or a
 * policy re-check). All entries are cleared on sign-out (services/authActions).
 *
 * Emails are compared NFKC-normalised, trimmed and lower-cased, the same
 * canonical form the backend stores (#597 normalizeEmail), so
 * "Jane@Example.com " and "jane@example.com" are the same identity.
 *
 * Invite-code signups never consult or resolve a marker (#306 r5, Opus
 * C-306-1): a QR / invite signup is a client joining a coach, so a coach
 * notice about someone else's earlier attempt is never shown to it, and it
 * does not consume that evidence.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const COACH_SIGNUP_UNCONFIRMED_KEY = 'signup_coach_unconfirmed';
export const COACH_SIGNUP_UNCONFIRMED_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 6;

export type CoachSignupMethod = 'email' | 'apple' | 'google';

interface Marker {
  method: CoachSignupMethod;
  email?: string;
  /** #306 r6 (Sol C-306-5): stable provider id (Apple user id, Google Supabase user id). */
  subject?: string;
  at: number;
}

/**
 * Who signed in: an email (string, as before) or, for Apple and Google, the
 * email and the stable provider subject when known.
 */
export type CoachSignupIdentity =
  | string
  | null
  | undefined
  | { email?: string | null; subject?: string | null };

function identityOf(id: CoachSignupIdentity): { email?: string; subject?: string } {
  if (id && typeof id === 'object') {
    const email = normaliseEmail(id.email);
    const subject = typeof id.subject === 'string' && id.subject.trim() ? id.subject.trim().slice(0, 200) : undefined;
    return { ...(email ? { email } : {}), ...(subject ? { subject } : {}) };
  }
  const email = normaliseEmail(id);
  return email ? { email } : {};
}

export function normaliseEmail(email: string | undefined | null): string | undefined {
  // Same canonical form as the backend (#597 normalizeEmail: NFKC, trimmed,
  // lower-cased), so a compatibility variant of an address still matches its
  // marker (#306 r5, Opus C-306-3 iii).
  let e = '';
  if (typeof email === 'string') {
    let n = email;
    try {
      n = n.normalize('NFKC');
    } catch {
      // keep the raw form when the runtime lacks normalize
    }
    e = n.trim().toLowerCase();
  }
  return e ? e : undefined;
}

function isMethod(v: unknown): v is CoachSignupMethod {
  return v === 'email' || v === 'apple' || v === 'google';
}

function fresh(m: Marker, now: number): boolean {
  return now >= m.at && now - m.at <= COACH_SIGNUP_UNCONFIRMED_TTL_MS;
}

async function readMarkers(now: number): Promise<Marker[]> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(COACH_SIGNUP_UNCONFIRMED_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // Round-3 builds stored a single object; read it as a one-entry list.
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const out: Marker[] = [];
  for (const item of list) {
    const m = item as Partial<Marker> | null;
    if (!m || !isMethod(m.method) || typeof m.at !== 'number') continue;
    const marker: Marker = { method: m.method, at: m.at };
    const email = normaliseEmail(typeof m.email === 'string' ? m.email : undefined);
    if (email) marker.email = email;
    if (typeof m.subject === 'string' && m.subject) marker.subject = m.subject;
    if (marker.method === 'email' && !marker.email) continue;
    if (fresh(marker, now)) out.push(marker);
  }
  return out;
}

async function writeMarkers(markers: Marker[]): Promise<void> {
  try {
    if (markers.length === 0) await AsyncStorage.removeItem(COACH_SIGNUP_UNCONFIRMED_KEY);
    else await AsyncStorage.setItem(COACH_SIGNUP_UNCONFIRMED_KEY, JSON.stringify(markers.slice(-MAX_ENTRIES)));
  } catch {
    // Best effort: without the marker the retry falls back to the generic notice.
  }
}

/**
 * Does `m` describe the same sign-in as (method, identity)?
 *  - email: the address must match.
 *  - apple / google (#306 r6, Sol C-306-5): when both sides know the stable
 *    provider subject, it decides (a different Apple ID or Google account
 *    never matches, even with no email). Otherwise, when both know the email,
 *    it decides. Only when no identity can be compared (a marker written
 *    when the helper threw before any identity was known, or by an r5 build
 *    within its 30-minute window) does the method alone decide, so an
 *    unproven outcome is never forgotten for lack of an identifier.
 */
function sameSignIn(m: Marker, method: CoachSignupMethod, id: { email?: string; subject?: string }): boolean {
  if (m.method !== method) return false;
  if (method === 'email') return !!id.email && m.email === id.email;
  if (m.subject && id.subject) return m.subject === id.subject;
  if (m.email && id.email) return m.email === id.email;
  return true;
}

function sameMarker(m: Marker, method: CoachSignupMethod, id: { email?: string; subject?: string }): boolean {
  return m.method === method && m.email === id.email && m.subject === id.subject;
}

export async function rememberUnconfirmedCoachSignup(
  method: CoachSignupMethod,
  identity?: CoachSignupIdentity,
  now: number = Date.now(),
): Promise<void> {
  const id = identityOf(identity);
  if (method === 'email' && !id.email) return;
  if (method === 'email') delete id.subject;
  const kept = (await readMarkers(now)).filter((m) => !sameMarker(m, method, id));
  const marker: Marker = { method, at: now, ...id };
  await writeMarkers([...kept, marker]);
}

/** True when an unconfirmed coach attempt with the same method (and identity) is recent. */
export async function hasUnconfirmedCoachSignup(
  method: CoachSignupMethod,
  identity?: CoachSignupIdentity,
  now: number = Date.now(),
): Promise<boolean> {
  const id = identityOf(identity);
  return (await readMarkers(now)).some((m) => sameSignIn(m, method, id));
}

/** True when any unconfirmed coach attempt from this device is recent. */
export async function hasAnyUnconfirmedCoachSignup(now: number = Date.now()): Promise<boolean> {
  return (await readMarkers(now)).length > 0;
}

/**
 * A server answer for this sign-in arrived: its earlier unconfirmed attempt is
 * resolved. Returns whether one was pending. Other sign-ins keep theirs.
 */
export async function resolveUnconfirmedCoachSignup(
  method: CoachSignupMethod,
  identity?: CoachSignupIdentity,
  now: number = Date.now(),
): Promise<boolean> {
  const id = identityOf(identity);
  const markers = await readMarkers(now);
  const kept = markers.filter((m) => !sameSignIn(m, method, id));
  if (kept.length !== markers.length) {
    await writeMarkers(kept);
    return true;
  }
  return false;
}

/** Sign-out: forget every marker. */
export async function clearUnconfirmedCoachSignup(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COACH_SIGNUP_UNCONFIRMED_KEY);
  } catch {
    // ignore
  }
}

/**
 * Shared reconciliation for any server-confirmed sign-in (CreateAccount and
 * Login; email, Apple, Google). Returns `coach_retry_not_applied` when an
 * unconfirmed coach attempt for this sign-in is pending and the server says
 * the account is not a coach, so the caller must show that notice and have it
 * acknowledged before the client flow. A server coach resolves the attempt
 * with no notice. The marker is resolved by the caller once the notice is
 * acknowledged (`resolveUnconfirmedCoachSignup`), so a crash before then
 * repeats the notice instead of losing it.
 */
export async function reconcileCoachAttempt(
  method: CoachSignupMethod,
  user: { role?: unknown; email?: unknown } | null | undefined,
  opts: { emailHint?: string | null; isNewUser?: boolean; providerSubject?: string | null } = {},
  now: number = Date.now(),
): Promise<'coach_retry_not_applied' | null> {
  if (typeof user?.role !== 'string') return null;
  const email = normaliseEmail(typeof user.email === 'string' && user.email ? user.email : opts.emailHint ?? undefined);
  const id = { email, subject: method === 'email' ? undefined : opts.providerSubject };
  if (!(await hasUnconfirmedCoachSignup(method, id, now))) return null;
  // A server coach, or an account the server says it created just now (so
  // the earlier attempt did not create one): resolved, nothing to say.
  if (user.role === 'coach' || opts.isNewUser === true) {
    await resolveUnconfirmedCoachSignup(method, id, now);
    return null;
  }
  return 'coach_retry_not_applied';
}
