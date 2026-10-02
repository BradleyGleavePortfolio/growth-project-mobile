/**
 * What the package editor shows when saving a package fails (#321, Sol
 * B-321-1; owner rule 13:34: no generic errors).
 *
 * Every failure says what happened, that the coach's edits are still on the
 * screen, and offers a working next action:
 *   - no answer (offline, timeout): Try again;
 *   - session ended (401): Sign in;
 *   - plan not active (403 subscription codes): Open billing;
 *   - not allowed (403) / package gone (404): Back to packages;
 *   - price rule, pricing locked, archived, invalid input (400 / 409 codes):
 *     the specific correction;
 *   - too many requests (429): wait, then save again;
 *   - anything else (5xx, unknown): a short reference (the server's
 *     request_id when present), Try again and Contact support, and a
 *     sanitised Sentry event under the same reference.
 *
 * Classification reads the HTTP status and the backend machine code (`code`,
 * then `error`) through toAuthErrorDetail, never the message alone.
 *
 * Privacy: only the fixed event name, mode, status, machine code and
 * reference reach Sentry. Never the request body (prices, descriptions),
 * headers or tokens.
 */
import { toAuthErrorDetail } from './authErrorDetail';
import { failureReference, isNetworkFailure } from './authFailure';
import {
  PACKAGE_FREE_ONE_TIME_MESSAGE,
  PACKAGE_PRICE_ERROR_CODES,
  PACKAGE_PRICE_HELPER,
} from './packagePrice';
import { captureError } from '../services/sentry';

export type PackageSaveMode = 'create' | 'update';

export type PackageSaveFailureKind =
  | 'network'
  | 'timeout'
  | 'session'
  | 'subscription'
  | 'forbidden'
  | 'not_found'
  | 'price'
  | 'locked'
  | 'archived'
  | 'not_configured'
  | 'invalid'
  | 'rate_limited'
  | 'server';

/** The one next step the dialog leads with. */
export type PackageSaveAction =
  | 'retry'
  | 'sign_in'
  | 'billing'
  | 'back_to_packages'
  | 'fix_price'
  | 'new_package'
  | 'fix_input'
  | 'wait';

export interface PackageSaveFailure {
  kind: PackageSaveFailureKind;
  title: string;
  message: string;
  action: PackageSaveAction;
  /** The dialog also offers Contact support (unknown / server failures). */
  support: boolean;
  /** Short reference shown to the coach and attached to the Sentry event. */
  reference: string | null;
}

const SUBSCRIPTION_CODES = new Set([
  'SUBSCRIPTION_INACTIVE',
  'SUBSCRIPTION_PAST_DUE_GRACE_EXPIRED',
  'TIER_UPGRADE_REQUIRED',
]);
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);

const KEPT = 'Your changes are still here.';

function savedWhat(mode: PackageSaveMode): string {
  return mode === 'create' ? 'The package was not created.' : 'Your changes were not saved.';
}

function backendMessage(raw: string, fallback: string): string {
  const m = raw.trim();
  // The backend's own copy for a known code is specific; keep it unless it
  // is empty or a bare HTTP phrase.
  if (!m || /^(bad request|conflict|forbidden|not found)$/i.test(m)) return fallback;
  return m;
}

/** Report an unknown failure (sanitised) and return its reference. */
export function reportPackageSaveFailure(
  err: unknown,
  mode: PackageSaveMode,
): { full: string; short: string } {
  const detail = toAuthErrorDetail(err);
  const ref = failureReference(err);
  captureError(new Error(`package_save_${mode}_failed`), {
    flow: 'package_save',
    mode,
    status: detail.status,
    code: detail.code,
    reference: ref.full,
  });
  return ref;
}

export function describePackageSaveFailure(
  err: unknown,
  mode: PackageSaveMode,
): PackageSaveFailure {
  const detail = toAuthErrorDetail(err);
  const { status, code } = detail;

  if (status === null) {
    if ((code && TIMEOUT_CODES.has(code)) || /timeout|timed out/i.test(detail.message)) {
      return {
        kind: 'timeout',
        title: 'The server took too long',
        message: `The server did not answer in time. ${savedWhat(mode)} ${KEPT} Check your connection, then tap Try again.`,
        action: 'retry',
        support: false,
        reference: null,
      };
    }
    if (isNetworkFailure(err)) {
      return {
        kind: 'network',
        title: 'No connection',
        message: `We could not reach the server. ${savedWhat(mode)} ${KEPT} Check your connection, then tap Try again.`,
        action: 'retry',
        support: false,
        reference: null,
      };
    }
  }

  if (status === 401) {
    return {
      kind: 'session',
      title: 'Please sign in again',
      message: `Your session has ended. ${savedWhat(mode)} Sign in again, then save the package.`,
      action: 'sign_in',
      support: false,
      reference: null,
    };
  }

  if (code && PACKAGE_PRICE_ERROR_CODES.has(code)) {
    const fallback =
      code === 'PACKAGE_FREE_MUST_BE_ONE_TIME' ? PACKAGE_FREE_ONE_TIME_MESSAGE : PACKAGE_PRICE_HELPER;
    return {
      kind: 'price',
      title: 'Check the price',
      message: backendMessage(detail.message, fallback),
      action: 'fix_price',
      support: false,
      reference: null,
    };
  }

  if (code === 'PACKAGE_PRICING_LOCKED') {
    return {
      kind: 'locked',
      title: 'Pricing is locked',
      message:
        'Pricing is locked because this package already has active subscribers. Create a new package for new pricing; you can still edit name, description, deliverables, and availability.',
      action: 'new_package',
      support: false,
      reference: null,
    };
  }

  if (code === 'PACKAGE_ARCHIVED') {
    return {
      kind: 'archived',
      title: 'This package is archived',
      message: `Archived packages cannot be changed. ${savedWhat(mode)} Go back to your packages and create a new one instead.`,
      action: 'back_to_packages',
      support: false,
      reference: null,
    };
  }

  if (code === 'PACKAGES_NOT_CONFIGURED') {
    return {
      kind: 'not_configured',
      title: 'Packages are not available yet',
      message: `Packages are not switched on for this server yet. ${savedWhat(mode)} Contact support and we will turn them on.`,
      action: 'back_to_packages',
      support: true,
      reference: null,
    };
  }

  if (status === 403 && code && SUBSCRIPTION_CODES.has(code)) {
    return {
      kind: 'subscription',
      title: 'Your plan is not active',
      message: `Saving packages needs an active coaching plan. ${savedWhat(mode)} Open Billing to update your plan, then save again.`,
      action: 'billing',
      support: false,
      reference: null,
    };
  }

  if (status === 403) {
    return {
      kind: 'forbidden',
      title: 'You cannot edit this package',
      message: `This account is not allowed to change this package. ${savedWhat(mode)} Go back to your packages, or ask the head coach who owns it.`,
      action: 'back_to_packages',
      support: false,
      reference: null,
    };
  }

  if (status === 404 || code === 'PACKAGE_NOT_FOUND') {
    return {
      kind: 'not_found',
      title: 'Package not found',
      message: `This package no longer exists or was moved to another coach. ${savedWhat(mode)} Go back to your packages to see the current list.`,
      action: 'back_to_packages',
      support: false,
      reference: null,
    };
  }

  if (status === 429) {
    return {
      kind: 'rate_limited',
      title: 'Too many saves',
      message: `Too many saves in a short time. ${KEPT} Wait a minute, then save again.`,
      action: 'wait',
      support: false,
      reference: null,
    };
  }

  if (status === 400 || code === 'PACKAGE_INVALID') {
    return {
      kind: 'invalid',
      title: 'Check the package details',
      message: backendMessage(
        detail.message,
        'One of the fields is not valid. Check the price, billing and trial days, then save again.',
      ),
      action: 'fix_input',
      support: false,
      reference: null,
    };
  }

  // 5xx, an unexpected status, or a failure we cannot classify.
  const ref = reportPackageSaveFailure(err, mode);
  return {
    kind: 'server',
    title: 'Could not save the package',
    message: `${savedWhat(mode)} There was a problem on our side. ${KEPT} Tap Try again, or contact support and quote reference ${ref.short}.`,
    action: 'retry',
    support: true,
    reference: ref.short,
  };
}
