/**
 * S-COACH-3 (OR-112-16, B-329-1) — the coach's "create my first package"
 * operation, made durable so no retry can ever make a second package.
 *
 * One create attempt has ONE Idempotency-Key and ONE request body. Both are
 * written to device storage before the request leaves, and every retry (a
 * second tap, a timeout, the app being killed and reopened) re-sends exactly
 * that key and body. The backend stores the key per coach and replays the
 * package it created the first time; a second request that arrives while the
 * first is still running waits for it and gets the same package back. So the
 * guarantee no longer rests on reading the package list after a timeout.
 *
 * The key is replaced only when the server definitively refused the create
 * (nothing exists), or once the package is live and the intent is cleared.
 */
import { prefsStorage } from "../../storage/mmkv";
import type { PackageCreateInput } from "../../api/packagesApi";
import { generateIdempotencyKey } from "../../utils/idempotency";

const KEY_BASE = "coachSetup.packageCreate.v1";

/**
 * How long a remembered attempt is re-sent with its key. The backend keeps
 * package-create keys with no expiry (the WorkoutBuilderIdempotencyKey
 * ledger is never purged), so a replay inside a day always finds the key;
 * after a day the intent is dropped and the coach starts fresh (the wizard
 * then offers any draft that exists as "Make it live").
 */
export const INTENT_TTL_MS = 24 * 60 * 60_000;

export interface PackageCreateIntent {
  v: 1;
  /** Idempotency-Key sent with every try of this create. */
  key: string;
  /** The exact body sent with that key; never changes for this key. */
  input: PackageCreateInput;
  /** Set once the server answered with the package. */
  packageId: string | null;
  /** Device time the intent was first written. */
  createdAt: number;
}

export function intentStorageKey(coachId: string): string {
  return `${KEY_BASE}:${coachId}`;
}

export function newIntent(
  input: PackageCreateInput,
  now: number = Date.now(),
): PackageCreateIntent {
  return {
    v: 1,
    key: generateIdempotencyKey(),
    input,
    packageId: null,
    createdAt: now,
  };
}

function isInput(x: unknown): x is PackageCreateInput {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.title === "string" &&
    typeof i.priceCents === "number" &&
    Number.isInteger(i.priceCents) &&
    typeof i.billingInterval === "string"
  );
}

/** Parse a stored intent; anything malformed or expired reads as none. */
export function parseIntent(
  raw: string | null | undefined,
  now: number = Date.now(),
): PackageCreateIntent | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as Record<string, unknown>;
    if (
      x.v !== 1 ||
      typeof x.key !== "string" ||
      x.key.length < 8 ||
      !isInput(x.input) ||
      !(x.packageId === null || typeof x.packageId === "string") ||
      typeof x.createdAt !== "number"
    ) {
      return null;
    }
    if (now - x.createdAt > INTENT_TTL_MS || x.createdAt - now > INTENT_TTL_MS)
      return null;
    return {
      v: 1,
      key: x.key,
      input: x.input,
      packageId: x.packageId,
      createdAt: x.createdAt,
    };
  } catch {
    return null;
  }
}

export async function loadIntent(
  coachId: string | null,
): Promise<PackageCreateIntent | null> {
  if (!coachId) return null;
  try {
    return parseIntent(
      await prefsStorage.getStringAsync(intentStorageKey(coachId)),
    );
  } catch {
    return null;
  }
}

/**
 * Write-ahead: called before the create is sent. A storage failure is not
 * fatal (the in-memory intent still makes in-session retries idempotent),
 * so it resolves false rather than blocking the coach.
 */
export async function saveIntent(
  coachId: string | null,
  intent: PackageCreateIntent,
): Promise<boolean> {
  if (!coachId) return false;
  try {
    await prefsStorage.set(intentStorageKey(coachId), JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}

export async function clearIntent(coachId: string | null): Promise<void> {
  if (!coachId) return;
  try {
    await prefsStorage.delete(intentStorageKey(coachId));
  } catch {
    // A stale intent expires on its own (INTENT_TTL_MS) and its key only
    // ever replays the same package, so a failed delete cannot duplicate.
  }
}

/** Same body the backend would store for this key. */
export function sameCreateInput(
  a: PackageCreateInput,
  b: PackageCreateInput,
): boolean {
  return (
    a.title === b.title &&
    (a.description ?? null) === (b.description ?? null) &&
    a.priceCents === b.priceCents &&
    (a.currency ?? "usd") === (b.currency ?? "usd") &&
    a.billingInterval === b.billingInterval &&
    (a.intervalCount ?? 1) === (b.intervalCount ?? 1)
  );
}
