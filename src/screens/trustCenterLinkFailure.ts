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
 * Every non-offline failure is reported to Sentry without personal data
 * (captureErrorWithoutPii: no signed-in user id, no request data, no
 * breadcrumbs). Sol B-315-1: the report is a CLOSED allowlist built here from
 * constants and enums only (LinkFailureReport): the event name, the link id,
 * the operation (step) and cause, an error-class enum, the platform and a
 * generated reference. No free-form text from the native exception (its
 * name, message, stack or any other field) is ever sent: the error class is
 * decided by `instanceof` checks, never by reading the exception's text, and
 * the exception handed to Sentry is a fixed synthetic one.
 *
 * openTrustCenterLink never rejects, so a tap can never leave an unhandled
 * promise behind.
 */
import { Linking, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { SUPPORT_EMAIL } from '../constants/support';
import { captureErrorWithoutPii } from '../services/sentry';
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
  /**
   * Short reference sent with the Sentry report (every cause but offline);
   * shown to the user with the support path (unexpected).
   */
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

/** 8 hex characters; enough to find one report, not an identifier of the user. */
export function newLinkFailureReference(): string {
  return Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, '0');
}

/** The kind of value the failing call rejected with; decided without reading any of its text. */
export type LinkErrorClass = 'none' | 'type_error' | 'range_error' | 'error' | 'string' | 'other';

export function linkErrorClassOf(err: unknown): LinkErrorClass {
  if (err === undefined) return 'none';
  if (err instanceof TypeError) return 'type_error';
  if (err instanceof RangeError) return 'range_error';
  if (err instanceof Error) return 'error';
  if (typeof err === 'string') return 'string';
  return 'other';
}

export type LinkReportPlatform = 'ios' | 'android' | 'web' | 'other';

function platformOf(): LinkReportPlatform {
  const os: string = Platform.OS;
  return os === 'ios' || os === 'android' || os === 'web' ? os : 'other';
}

/** Event name of every link-failure report. */
export const LINK_FAILURE_EVENT = 'trust_center.link_open_failed' as const;

/**
 * Everything a link-failure report may carry (Sol B-315-1). Every field is
 * a constant, an enum or the generated reference: nothing comes from the
 * native exception or from the person.
 */
export interface LinkFailureReport {
  event: typeof LINK_FAILURE_EVENT;
  link: TrustCenterLink['id'];
  operation: LinkFailureStep;
  cause: Exclude<LinkFailureCause, 'offline'>;
  error_class: LinkErrorClass;
  platform: LinkReportPlatform;
  reference: string;
}

/** The exact keys a report may carry, in order; tests pin this list. */
export const LINK_FAILURE_REPORT_KEYS = ['event', 'link', 'operation', 'cause', 'error_class', 'platform', 'reference'] as const;

export function linkFailureReport(
  link: TrustCenterLink,
  failure: LinkFailure & { cause: Exclude<LinkFailureCause, 'offline'>; reference: string },
  err?: unknown,
): LinkFailureReport {
  return {
    event: LINK_FAILURE_EVENT,
    link: link.id,
    operation: failure.step,
    cause: failure.cause,
    error_class: linkErrorClassOf(err),
    platform: platformOf(),
    reference: failure.reference,
  };
}

function report(link: TrustCenterLink, failure: LinkFailure, err?: unknown): void {
  if (failure.cause === 'offline' || !failure.reference) return;
  const extras = linkFailureReport(link, { ...failure, cause: failure.cause, reference: failure.reference }, err);
  // A fixed synthetic exception: its message holds only the two enums.
  const error = new Error(`Trust & Privacy link did not open (${extras.link}, ${extras.operation})`);
  error.name = 'TrustCenterLinkError';
  captureErrorWithoutPii(error, { ...extras });
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
    reference: cause === 'offline' ? null : newLinkFailureReference(),
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
