/**
 * accountBinding: ties a request to the account (and the sign-in) that asked
 * for it. Mobile #331 Sol A-331-4.
 *
 * The API client reads the access token from SecureStore asynchronously for
 * every request (services/api.ts request interceptor), and a 401 refreshes and
 * replays it. Without a binding, a destructive request started while account
 * A was signed in could pick up account B's token if A signed out and B signed
 * in while the request was still waiting for its credential. A bound request
 * cannot:
 *
 *   - `captureAccountBinding()` records WHO is signed in (the token subject)
 *     and WHICH sign-in it is (the auth epoch) when the intent is formed, for
 *     example when the list that offers Delete is loaded.
 *   - The request interceptor re-checks the binding after it has the token,
 *     immediately before the request goes out: no token, another subject or a
 *     newer epoch cancels the request (`AccountChangedError`). The request is
 *     never sent with another account's credential.
 *   - A 401 on a bound request refreshes only while the epoch is unchanged,
 *     and the replay goes through the same check again.
 *   - Every auth change (sign-out, sign-in, re-bootstrap: any `authEvents`
 *     emit) bumps the epoch and aborts every bound request still in flight,
 *     so its answer can never be applied to the next session. Same-account
 *     sign-out and sign-in (A -> logout -> A) is a new epoch too.
 *
 * Nothing here is stored. The binding holds the token subject (the account
 * id inside the JWT) or, for a token that is not a JWT, a short hash of it;
 * never the token itself. Nothing here is logged or reported.
 */
import { authEvents } from '../utils/authEvents';
import { secureStorage } from './secureStorage';

export interface AccountBinding {
  /** The signed-in account: the access token's `sub`, or a hash of an opaque token. */
  readonly subject: string;
  /** The sign-in it belongs to (auth epoch when it was captured). */
  readonly epoch: number;
}

/** Machine code of a request stopped because the account changed. */
export const ACCOUNT_CHANGED = 'ACCOUNT_CHANGED';

/**
 * A bound request was stopped because the signed-in account (or sign-in)
 * is no longer the one that asked for it. `mayHaveBeenSent` is false when it
 * was stopped before it left the phone, true when it was aborted (or its
 * answer dropped) after it may already have reached the server under the
 * account that asked for it.
 */
export class AccountChangedError extends Error {
  readonly code = ACCOUNT_CHANGED;
  readonly mayHaveBeenSent: boolean;
  constructor(mayHaveBeenSent = false) {
    super('The signed-in account changed, so this request was stopped.');
    this.name = 'AccountChangedError';
    this.mayHaveBeenSent = mayHaveBeenSent;
  }
}

export function isAccountChangedError(err: unknown): err is AccountChangedError {
  return (
    err instanceof AccountChangedError ||
    (!!err && typeof err === 'object' && Reflect.get(err, 'code') === ACCOUNT_CHANGED)
  );
}

let epoch = 0;
type Listener = (epoch: number) => void;
const listeners = new Set<Listener>();
const inflight = new Set<AbortController>();

function bump(): void {
  epoch += 1;
  // Abort first, so no listener can observe a bound request of the old
  // sign-in still running.
  const running = [...inflight];
  inflight.clear();
  running.forEach((c) => c.abort());
  const now = epoch;
  listeners.forEach((fn) => fn(now));
}

// Every sign-out, sign-in and re-bootstrap goes through authEvents.emit,
// which always calls the generic listeners (named 'logout' included).
authEvents.onAuthChange(bump);

/** The current auth epoch. */
export function authEpoch(): number {
  return epoch;
}

/** Called after every epoch change (sign-out, sign-in, re-bootstrap). */
export function onAuthEpochChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True while the sign-in the binding was captured under is still current. */
export function bindingIsCurrent(binding: AccountBinding | null | undefined): binding is AccountBinding {
  return !!binding && binding.epoch === epoch;
}

function decodeBase64Url(input: string): string | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const clean = input.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return null;
  }
}

/** FNV-1a, 32 bit: identifies an opaque (non-JWT) token without keeping it. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The account a token belongs to: its JWT `sub`. A token that is not a JWT
 * with a `sub` is identified by a hash, so a different token never counts as
 * the same account (a refresh of such a token cancels a bound request rather
 * than guessing).
 */
export function credentialSubject(token: string | null | undefined): string | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (part) {
    const json = decodeBase64Url(part);
    if (json) {
      try {
        const claims: unknown = JSON.parse(json);
        const sub = claims && typeof claims === 'object' ? Reflect.get(claims, 'sub') : undefined;
        if (typeof sub === 'string' && sub.length > 0) return `sub:${sub}`;
      } catch {
        // Not JSON: fall through to the opaque form.
      }
    }
  }
  return `tok:${fnv1a(token)}:${token.length}`;
}

/**
 * Who is signed in right now, as a binding. Null when nobody is signed in or
 * the sign-in changed while the token was being read.
 */
export async function captureAccountBinding(): Promise<AccountBinding | null> {
  const startedAt = epoch;
  const token = await secureStorage.getItem('supabase_token');
  if (startedAt !== epoch) return null;
  const subject = credentialSubject(token);
  return subject ? { subject, epoch: startedAt } : null;
}

/**
 * Called by the API client with the token it is about to send. Throws when
 * the request must not go out under this credential.
 */
export function assertBindingMatches(binding: AccountBinding, token: string | null | undefined): void {
  if (binding.epoch !== epoch) throw new AccountChangedError(false);
  const subject = credentialSubject(token);
  if (!subject || subject !== binding.subject) throw new AccountChangedError(false);
}

/**
 * An abort signal for one bound request: aborted on the next auth change.
 * Call `done()` when the request settles. If the binding is already stale the
 * signal starts aborted.
 */
export function boundRequestSignal(binding: AccountBinding): {
  signal: AbortSignal;
  done: () => void;
} {
  const controller = new AbortController();
  if (binding.epoch !== epoch) {
    controller.abort();
    return { signal: controller.signal, done: () => undefined };
  }
  inflight.add(controller);
  return {
    signal: controller.signal,
    done: () => {
      inflight.delete(controller);
    },
  };
}

/** Test-only: how many bound requests are registered as in flight. */
export function __boundRequestsInFlightForTests(): number {
  return inflight.size;
}
