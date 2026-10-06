/**
 * S-COACH — one loader for "how far is this coach with setup", shared by the
 * Home checklist and the wizard's last step so both read the same server
 * truth (never in-memory or device-only state):
 *
 *   Get paid        GET /coach/connect/status          state === 'active'
 *   First package   GET /v1/coach/packages             a LIVE package (active,
 *                                                      not archived, published)
 *   First client    GET /coach/clients?status=all&take=1   a client has joined
 *   First payment   GET /v1/coach/money/charges?status=paid&limit=1
 *                   (older backend without Money: the first-payment gate)
 *
 * Each item is `null` when its read failed; the failures come back as
 * specific FriendlyError copy so the caller can show them with a retry.
 * The device-local "link shared" flag is only a hint for the copy, never a
 * tick.
 */
import api from "../../services/api";
import { coachSetupApi, type ConnectView } from "../../api/coachSetupApi";
import { coachPackagesApi, isLivePackage } from "../../api/packagesApi";
import { prefsStorage } from "../../storage/mmkv";
import { hasSeenFirstPayment } from "../../screens/coach/ed/firstPaymentGate";
import { errorStatus } from "../../types/common";
import {
  describeError,
  isSubCoachBillingBlocked,
  type FriendlyError,
} from "./errors";

// Same key InviteShareCard writes when the coach shares or copies the link.
export const INVITE_SHARED_KEY_BASE = "coach.setup.invite_shared";

export function inviteSharedKey(coachId: string): string {
  return `${INVITE_SHARED_KEY_BASE}:${coachId}`;
}

export interface SetupSnapshot {
  connect: ConnectView | null;
  /** Title of the first live package, "" when none; null = unknown. */
  livePackageTitle: string | null;
  /** True once at least one client has joined; null = unknown. */
  hasClient: boolean | null;
  /** True once the coach has a paid charge; null = unknown. */
  paid: boolean | null;
  /** The coach shared or copied their link on this device (hint only). */
  sharedLink: boolean;
  /** Specific copy for each read that failed (deduplicated by title). */
  errors: FriendlyError[];
  /**
   * C-332-1 (Opus): the signed-in coach is an active sub-coach, so Stripe
   * and money belong to the head coach and the setup checklist is not theirs.
   */
  headCoachHandlesMoney?: boolean;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Count rows in either a bare array or a `{ clients | data | items }` page. */
export function rowCount(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["clients", "data", "items"]) {
      if (Array.isArray(d[k])) return (d[k] as unknown[]).length;
    }
  }
  return null;
}

async function readFirstPaid(coachId: string): Promise<boolean> {
  try {
    const r = await api.get<{ charges?: unknown[] }>(
      "/v1/coach/money/charges",
      { params: { status: "paid", limit: 1 } },
    );
    const n = rowCount(r.data?.charges ?? null);
    if (n === null) {
      throw Object.assign(new Error("charges payload missing"), {
        response: { status: 502, data: { code: "MONEY_PAYLOAD_INVALID" } },
      });
    }
    return n > 0;
  } catch (err) {
    // Older backend without the Money routes: the celebration gate.
    if (errorStatus(err) === 404) return hasSeenFirstPayment(coachId);
    throw err;
  }
}

async function readHasClient(): Promise<boolean> {
  const r = await api.get("/coach/clients", {
    params: { status: "all", take: 1 },
  });
  const n = rowCount(r.data);
  if (n === null) {
    throw Object.assign(new Error("clients payload missing"), {
      response: { status: 502, data: { code: "CLIENTS_PAYLOAD_INVALID" } },
    });
  }
  return n > 0;
}

export async function loadSetupStatus(coachId: string): Promise<SetupSnapshot> {
  const [connect, packages, clients, paid, shared] = await Promise.all([
    settle(coachSetupApi.connectStatus()),
    settle(coachPackagesApi.list()),
    settle(readHasClient()),
    settle(readFirstPaid(coachId)),
    settle(prefsStorage.getStringAsync(inviteSharedKey(coachId))),
  ]);
  const errors: FriendlyError[] = [];
  const add = (err: unknown, action: string) => {
    const e = describeError(err, action);
    if (!errors.some((x) => x.title === e.title)) errors.push(e);
  };
  const headCoachHandlesMoney =
    !connect.ok && isSubCoachBillingBlocked(connect.error);
  if (!connect.ok && !headCoachHandlesMoney)
    add(connect.error, "check your Stripe status");
  if (!packages.ok) add(packages.error, "check your packages");
  if (!clients.ok) add(clients.error, "check your client list");
  if (!paid.ok) add(paid.error, "check your payments");
  const live = packages.ok ? packages.value.data.find(isLivePackage) : null;
  return {
    connect: connect.ok ? connect.value : null,
    livePackageTitle: packages.ok ? (live ? live.title : "") : null,
    hasClient: clients.ok ? clients.value : null,
    paid: paid.ok ? paid.value : null,
    sharedLink: shared.ok ? shared.value === "true" : false,
    errors,
    headCoachHandlesMoney,
  };
}
