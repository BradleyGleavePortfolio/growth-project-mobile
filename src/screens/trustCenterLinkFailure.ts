/**
 * Opening a Trust & Privacy footer link, and what the screen says when it
 * does not open (operator ruling OR-112-15; owner rule 2026-10-01 13:34: no
 * generic or vague errors, ever).
 *
 * Every failure names the page and gives a next step that works:
 *   - offline      the phone has no connection: say so, connect, tap again.
 *   - cannot_open  the phone cannot open web links (Linking.canOpenURL is
 *                  false, or Linking.openURL rejects): show the exact web
 *                  address to open in any browser.
 *   - unexpected   anything else: the web address, the support email and a
 *                  short reference that is also on the Sentry report.
 *
 * Every non-offline failure is reported to Sentry without personal data: the
 * report carries the link id, the step that failed, the reference and the
 * page address without any query string or fragment. The raw error message
 * is not sent as is; it is passed through sentrySafeText first (no email
 * addresses, no query strings).
 *
 * openTrustCenterLink never rejects, so a tap can never leave an unhandled
 * promise behind.
 */
import { Linking } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { SUPPORT_EMAIL } from '../constants/support';
import { captureError } from '../services/sentry';
import type { TrustCenterLink } from './trustCenterLinks';

export type LinkFailureCause = 'offline' | 'cannot_open' | 'unexpected';

/** Which step failed; diagnostics only, never shown. */
export type LinkFailureStep =
  | 'offline_before_open'
  | 'offline_after_open_rejected'
  | 'can_open_url_false'
  | 'can_open_url_rejected'
  | 'open_url_rejected'
  | 'unexpected';

export interface LinkFailure {
  cause: LinkFailureCause;
  step: LinkFailureStep;
  /** Short reference shown to the user and sent to Sentry (unexpected only). */
  reference: string | null;
}

export const LINK_FAILURE_ACTIONS = {
  copy: 'Copy web address',
  copied: 'Web address copied. Paste it into any browser.',
  copyFailed: 'The web address could not be copied. Press and hold the address to select it.',
  email: 'Email support',
} as const;

/** The message shown under the link that did not open. */
export function linkFailureMessage(link: TrustCenterLink, failure: LinkFailure): string {
  const page = link.pageName;
  switch (failure.cause) {
    case 'offline':
      return `This phone is offline, so the ${page} did not open. Connect to Wi-Fi or mobile data, then tap the link again.`;
    case 'cannot_open':
      return `This phone could not open the ${page} in a web browser. Open any browser, on this phone or another device, and go to the address below.`;
    default: {
      const ref = failure.reference ? ` and mention reference ${failure.reference}` : '';
      return `The ${page} did not open on this phone. Open any browser and go to the address below. If it still does not open, email ${SUPPORT_EMAIL}${ref}.`;
    }
  }
}

/** Subject line for the support email offered after an unexpected failure. */
export function linkFailureEmailSubject(link: TrustCenterLink, failure: LinkFailure): string {
  const ref = failure.reference ? ` (reference ${failure.reference})` : '';
  return `Trust & Privacy: the ${link.pageName} did not open${ref}`;
}

/** The page address without any query string or fragment. */
export function addressWithoutQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_WITH_QUERY = /\b([a-z][a-z0-9+.-]*:[^\s?#'"]*)[?#][^\s'"]*/gi;

/** Error text safe to send to Sentry: no query strings or fragments, no email addresses. */
export function sentrySafeText(text: string): string {
  return text.replace(URL_WITH_QUERY, '$1').replace(EMAIL, '[email]').slice(0, 200);
}

/** 8 hex characters; enough to find one report, not an identifier of the user. */
export function newLinkFailureReference(): string {
  return Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, '0');
}

function errorField(err: unknown, key: 'name' | 'message'): string | undefined {
  if (typeof err === 'string') return key === 'message' ? err : undefined;
  if (typeof err !== 'object' || err === null) return undefined;
  const value = Reflect.get(err, key);
  return typeof value === 'string' ? value : undefined;
}

function report(link: TrustCenterLink, failure: LinkFailure, err?: unknown): void {
  const error = new Error(`Trust & Privacy link did not open (${link.id}, ${failure.step})`);
  error.name = 'TrustCenterLinkError';
  const name = errorField(err, 'name');
  const message = errorField(err, 'message');
  captureError(error, {
    where: 'trust_center.link_open',
    link: link.id,
    cause: failure.cause,
    step: failure.step,
    reference: failure.reference,
    url: addressWithoutQuery(link.url),
    ...(name ? { error_name: sentrySafeText(name) } : {}),
    ...(message ? { error_message: sentrySafeText(message) } : {}),
  });
}

interface Connectivity {
  /** The phone reports no network connection at all. */
  definitelyOffline: boolean;
  /** No connection, or NetInfo's reachability probe says the internet is unreachable. */
  probablyOffline: boolean;
}

async function connectivity(): Promise<Connectivity> {
  try {
    const state = await NetInfo.fetch();
    const definitelyOffline = state.isConnected === false;
    return { definitelyOffline, probablyOffline: definitelyOffline || state.isInternetReachable === false };
  } catch {
    // Unknown connectivity is not offline: try to open the page.
    return { definitelyOffline: false, probablyOffline: false };
  }
}

function fail(
  link: TrustCenterLink,
  cause: LinkFailureCause,
  step: LinkFailureStep,
  err?: unknown,
): LinkFailure {
  const failure: LinkFailure = {
    cause,
    step,
    reference: cause === 'unexpected' ? newLinkFailureReference() : null,
  };
  // Being offline is the phone's state, not a defect; everything else is reported.
  if (cause !== 'offline') {
    try {
      report(link, failure, err);
    } catch {
      // A failing error reporter must not change what the user is told.
    }
  }
  return failure;
}

/**
 * Opens the link in the phone's browser. Resolves null when it opened, or the
 * failure to show. Never rejects.
 *
 * Only a phone with no connection at all is stopped before opening: NetInfo's
 * reachability probe can be wrong, and a browser shows its own offline page,
 * so a "reachable: false" alone never blocks the tap. It is used only to
 * explain an open that failed.
 */
export async function openTrustCenterLink(link: TrustCenterLink): Promise<LinkFailure | null> {
  try {
    if ((await connectivity()).definitelyOffline) {
      return fail(link, 'offline', 'offline_before_open');
    }
    let supported: boolean;
    try {
      supported = await Linking.canOpenURL(link.url);
    } catch (err) {
      return fail(link, 'unexpected', 'can_open_url_rejected', err);
    }
    if (!supported) return fail(link, 'cannot_open', 'can_open_url_false');
    try {
      await Linking.openURL(link.url);
      return null;
    } catch (err) {
      if ((await connectivity()).probablyOffline) {
        return fail(link, 'offline', 'offline_after_open_rejected');
      }
      return fail(link, 'cannot_open', 'open_url_rejected', err);
    }
  } catch (err) {
    return fail(link, 'unexpected', 'unexpected', err);
  }
}
