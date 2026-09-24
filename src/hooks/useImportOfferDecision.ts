/**
 * useImportOfferDecision — account-scoped consumer of the persisted Roman
 * import-offer answer (`yes` | `later` | `starting_fresh`), UX-01 J0/J1.
 *
 * What it is: the minimal, truthful state contract a Home-card host needs to
 * wire `onYes` / `onLater` / `onStartingFresh` (and to decide which variant of
 * the offer card, if any, to mount) without owning storage or identity itself.
 *
 * What it is NOT: it does not decide eligibility (CQ-01 is server-side and
 * unresolved; the host still needs a server truth before showing the offer to
 * real coaches), it does not create or bind an import intent (S7-gated), it
 * does not mount any UI, poll, time, or emit analytics, and it never presents a
 * device-local write as a server record.
 *
 * Identity binding follows the accepted #291 `useExtensionPairing` posture:
 *   - the coach id comes from `useCurrentUser()`, which is `null` on first
 *     render and again after 'logout'; while it is null the hook is
 *     `unresolved` and records nothing (it never guesses an owner);
 *   - every read and write is bound to the id resolved at the moment it
 *     started; a result that settles after the identity changed is discarded,
 *     and a write that landed after sign-out/switch is removed again (bounded
 *     residual: a process death between that write and its removal leaves a
 *     user-scoped, non-secret record only that same coach could read back);
 *   - identity change on a live mount (A→null, A→B) resets the in-memory answer
 *     before the new identity's record is read, so account B can never see A's
 *     card even for one frame.
 *
 * Read/write ordering: writes are serialized so the coach's LATEST answer is
 * also the last one on disk; a read still in flight when an answer is recorded
 * is superseded and cannot overwrite that answer in memory.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { featureFlags } from '../config/featureFlags';
import {
  clearImportOfferDecision,
  readImportOfferDecision,
  writeImportOfferDecision,
  type ImportOfferDecision,
} from '../storage/importOfferDecision';
import { logger } from '../utils/logger';
import { useCurrentUser } from './useCurrentUser';

export type { ImportOfferDecision } from '../storage/importOfferDecision';

/**
 * - `disabled`: `enabled` is false (default: the existing `extensionImport`
 *   flag, OFF by default, same kill switch as `useExtensionPairing`); no
 *   storage is touched. Render nothing.
 * - `unresolved`: the coach identity is not (yet) known. Render nothing.
 * - `loading`: identity known, persisted answer being read. Render nothing
 *   (never flash the offer before the answer is known).
 * - `ready`: `decision` is authoritative for this device and account:
 *   `null` means no recorded answer, otherwise the recorded answer.
 */
export type ImportOfferDecisionStatus = 'disabled' | 'unresolved' | 'loading' | 'ready';

export interface ImportOfferDecisionState {
  status: ImportOfferDecisionStatus;
  /** Meaningful only when `status === 'ready'`; always `null` otherwise. */
  decision: ImportOfferDecision | null;
  /**
   * Record the coach's answer for the account signed in NOW. The in-memory
   * `decision` reflects the answer immediately (the tap is a fact for this
   * session). Resolves `true` only when the answer was durably written on this
   * device for that same account and the account is still signed in; `false`
   * when disabled, when no identity was resolved (nothing is recorded), when
   * the identity changed while writing (the write is removed again), or when
   * the write itself failed (the offer is simply asked again on the next
   * entry; no "saved" claim may be shown). Never a server-side claim.
   */
  recordDecision: (decision: ImportOfferDecision) => Promise<boolean>;
}

interface View {
  status: ImportOfferDecisionStatus;
  decision: ImportOfferDecision | null;
}

function initialView(enabled: boolean, userId: string | null): View {
  if (!enabled) return { status: 'disabled', decision: null };
  if (!userId) return { status: 'unresolved', decision: null };
  return { status: 'loading', decision: null };
}

export function useImportOfferDecision(
  enabled: boolean = featureFlags.extensionImport,
): ImportOfferDecisionState {
  const userId = useCurrentUser()?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const mountedRef = useRef(true);
  /**
   * Monotonic id of the latest identity epoch or recorded answer. A read or
   * write whose epoch is no longer current acts on nothing.
   */
  const epochRef = useRef(0);
  /** Serializes disk writes so the last answer given is the last one written. */
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());

  const [view, setView] = useState<View>(() => initialView(enabled, userId));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Any identity or enablement change supersedes whatever was in flight.
    const epoch = ++epochRef.current;
    const next = initialView(enabled, userId);
    setView((prev) =>
      prev.status === next.status && prev.decision === next.decision ? prev : next,
    );
    if (next.status !== 'loading' || !userId) return;
    void (async () => {
      const decision = await readImportOfferDecision(userId);
      // Superseded by a newer identity, a recorded answer, or unmount → discard.
      if (!mountedRef.current || epochRef.current !== epoch) return;
      setView({ status: 'ready', decision });
    })();
  }, [enabled, userId]);

  const recordDecision = useCallback(async (decision: ImportOfferDecision): Promise<boolean> => {
    if (!enabledRef.current) return false;
    // The answer belongs to the coach signed in NOW. With no resolved identity
    // there is nothing safe to bind it to: refuse rather than guess an owner.
    const owner = userIdRef.current;
    if (!owner) return false;
    // Supersede any read still in flight: the tap is newer than the disk.
    epochRef.current += 1;
    if (mountedRef.current) setView({ status: 'ready', decision });

    let written = false;
    const run = async () => {
      try {
        await writeImportOfferDecision(owner, decision);
        written = true;
      } catch (err) {
        // Degraded durability, not a dead flow: memory keeps the answer for
        // this session and the offer is asked again on the next entry.
        logger.warn('[useImportOfferDecision] write failed', err);
      }
    };
    const chained = writeChainRef.current.then(run, run);
    writeChainRef.current = chained;
    await chained;

    if (!written) return false;
    if (userIdRef.current !== owner) {
      // The write landed AFTER the coach signed out or the account switched,
      // i.e. after signOut() removed `import_offer_decision:<owner>`. Remove
      // what we wrote so sign-out remains a completed local-state boundary.
      void clearImportOfferDecision(owner);
      return false;
    }
    // A newer answer from the same coach may have been recorded while this one
    // was queued; because writes are serialized, that answer is written after
    // this one and the disk still ends at the latest answer.
    return true;
  }, []);

  return { status: view.status, decision: view.decision, recordDecision };
}
