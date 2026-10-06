/**
 * Copy and pure helpers for the owner's Featured coach editor. One specific
 * line per server refusal (what happened and what to do next). No first
 * person, no exclamation marks, never the raw server text.
 */
import type { FeaturedFailure, FeaturedFailureCode, FeaturedCoachPackage } from '../../../api/featuredCoachApi';
import { money } from '../../../lib/planTerms';

/** The owner's public code (owner 10-01 13:45 "GP-BRADLEY is great"). */
export const SUGGESTED_CODE = 'GP-BRADLEY';

const SAVE_REFUSAL: Record<FeaturedFailureCode, string> = {
  featured_code_other_coach: 'That code already belongs to a different coach. Enter another code for this coach.',
  featured_coach_invalid: 'That account is not a coach account. Choose a coach from the list; owner and client accounts cannot be featured.',
  featured_code_unknown: 'That code does not exist yet. Turn on "Create the code if it is new", or enter a code this coach already has.',
  featured_package_invalid: 'That package is not an active package of this coach. Choose one of the packages listed.',
  not_owner: 'Only the owner account can change the featured coach. Sign in with the owner account.',
  network: 'No connection. Check the internet connection, then tap Save again.',
  rate_limited: 'Too many saves in a short time. Wait a minute, then tap Save again.',
  bad_format: 'The server did not accept one of the fields. Check that the code uses only letters, numbers and dashes, then tap Save again.',
  server: 'The featured coach could not be saved because of a server problem. Tap Save to try again.',
  unexpected: 'The featured coach could not be saved. Tap Save to try again.',
};

const LOAD_REFUSAL: Partial<Record<FeaturedFailureCode, string>> = {
  not_owner: 'Only the owner account can open the featured coach settings.',
  network: 'No connection. Check the internet connection, then tap Try again.',
  rate_limited: 'Too many requests in a short time. Wait a minute, then tap Try again.',
  server: 'The featured coach settings could not be loaded because of a server problem. Tap Try again.',
};

function withReference(base: string, failure: Pick<FeaturedFailure, 'code' | 'status' | 'requestId'>): string {
  if (failure.code !== 'server' && failure.code !== 'unexpected') return base;
  if (failure.requestId) return `${base} If it keeps happening, contact support with reference ${failure.requestId}.`;
  if (failure.status) return `${base} If it keeps happening, contact support and mention error ${failure.status}.`;
  return base;
}

export function saveRefusalLine(failure: FeaturedFailure): string {
  return withReference(SAVE_REFUSAL[failure.code], failure);
}

export function loadRefusalLine(failure: FeaturedFailure): string {
  const base =
    LOAD_REFUSAL[failure.code] ?? 'The featured coach settings could not be loaded. Tap Try again.';
  return withReference(base, failure);
}

/** Which form field a refusal belongs to (the line is shown under it). */
export function refusalField(code: FeaturedFailureCode): 'coach' | 'code' | 'package' | 'form' {
  if (code === 'featured_coach_invalid') return 'coach';
  if (code === 'featured_code_other_coach' || code === 'featured_code_unknown') return 'code';
  if (code === 'featured_package_invalid') return 'package';
  return 'form';
}

const UNIT_SHORT: Record<string, string> = { day: 'day', week: 'wk', month: 'mo', year: 'yr' };

/** Price as the pitch says it: "$49/mo", "$300/3 mo", "$99". */
export function pitchPrice(pkg: Pick<FeaturedCoachPackage, 'amount_cents' | 'currency' | 'billing_type' | 'interval' | 'interval_count'>): string {
  const full = money(pkg.amount_cents, pkg.currency.toLowerCase());
  const amount = pkg.amount_cents % 100 === 0 ? full.replace(/[.,]00(?=\D*$)/, '') : full;
  const unit = pkg.interval ? UNIT_SHORT[pkg.interval] : undefined;
  if (pkg.billing_type === 'one_time' || !unit) return amount;
  return pkg.interval_count > 1 ? `${amount}/${pkg.interval_count} ${unit}` : `${amount}/${unit}`;
}

/** Roman's pitch (owner 10-01 13:41), with the code and the package price filled in. */
export function suggestedPitch(code: string, price: string | null): string {
  const join = price ? ` and join for ${price}` : ' and join';
  return `Sir/Ma'am, just so you're aware, TGP's top coach has available slots. Enter code ${code}${join}. Interested?`;
}

/** Same shape check as the server DTO (letters, digits, dashes; 3 to 32 after trim). */
export function isFeaturedCodeShape(raw: string): boolean {
  const t = raw.trim();
  return t.length >= 3 && t.length <= 32 && /^[A-Za-z0-9-]+$/.test(t);
}
