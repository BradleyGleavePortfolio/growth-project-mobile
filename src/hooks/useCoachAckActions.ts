/**
 * useCoachAckActions — v2-2 coach ack-signal mutations (seen / acked / replied).
 *
 * A coach explicitly advances a client message through the ordered states
 * `seen` -> `acked` -> `replied`. Each mutation:
 *   - posts to the matching `/community/ack/:messageId/<target>` endpoint
 *     through `coachCommunityApi` (which Zod-validates the wire shape), and
 *   - applies an OPTIMISTIC update to the per-message ack cache so the
 *     `CoachAckBadge` reflects the new state instantly, then reconciles with
 *     the server envelope on success or ROLLS BACK to the prior snapshot on
 *     failure (the hard-gate optimistic + rollback contract).
 *
 * The acting coach is always derived from the JWT inside `coachCommunityApi`;
 * no coachId is ever threaded through here.
 *
 * Idempotency: the backend transitions are idempotent and monotonic (re-marking
 * a state the message already reached is a server-side no-op that returns the
 * existing timestamp; it never regresses a stronger state). Because the
 * optimistic value only ever RAISES the cached `state` to the target (it never
 * lowers it), a double-tap of the same action is a visual no-op too, matching
 * the server.
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  coachCommunityApi,
  ACK_STATE_RANK,
  type AckStateDto,
  type CoachAckState,
} from '../api/coachCommunityApi';
import { coachCommunityKeys } from './useCoachCommunity';

/** A single ack transition target reachable from the coach UI. */
export type CoachAckTarget = Exclude<CoachAckState, 'none'>;

/**
 * Compose an optimistic ack envelope for a target transition. We only RAISE the
 * state (never lower it): a `seen` tap on an already-`replied` message leaves
 * the cached state at `replied`, mirroring the backend's monotonic rule. The
 * relevant `*_at` timestamp is stamped to "now" so the badge can render a
 * sensible relative time until the server envelope reconciles it. The SLA
 * snapshot is carried over unchanged from the prior cache (it is a read-time
 * projection the server recomputes on its response).
 */
function projectOptimistic(
  prev: AckStateDto | undefined,
  target: CoachAckTarget,
): AckStateDto {
  const nowIso = new Date().toISOString();
  const base: AckStateDto =
    prev ?? {
      state: 'none',
      seen_at: null,
      acked_at: null,
      replied_at: null,
      sla: {
        sla_state: 'within',
        elapsed_ms: 0,
        soft_target_ms: 24 * 60 * 60 * 1000,
        hard_target_ms: 48 * 60 * 60 * 1000,
      },
    };

  const next: AckStateDto = {
    ...base,
    seen_at:
      target === 'seen' && base.seen_at == null ? nowIso : base.seen_at,
    acked_at:
      target === 'acked' && base.acked_at == null ? nowIso : base.acked_at,
    replied_at:
      target === 'replied' && base.replied_at == null
        ? nowIso
        : base.replied_at,
  };

  // Monotonic: the displayed state is the strongest of the prior state and the
  // target — never a regression.
  next.state =
    ACK_STATE_RANK[target] >= ACK_STATE_RANK[base.state] ? target : base.state;

  return next;
}

/**
 * The three typed ack mutations for one message. Each is a React Query mutation
 * exposing `mutate`/`mutateAsync`/`isPending`/`isError`/etc. so a row can fire
 * an action and reflect the pending/disabled state without bespoke wiring.
 */
export interface CoachAckActions {
  markSeen: UseMutationResult<AckStateDto, unknown, void>;
  markAcked: UseMutationResult<AckStateDto, unknown, void>;
  markReplied: UseMutationResult<AckStateDto, unknown, void>;
}

/**
 * Build one ack mutation for a given message + target. Shared by the three
 * public actions so the optimistic/rollback/reconcile logic lives in one place.
 */
function useAckMutation(
  messageId: string,
  target: CoachAckTarget,
): UseMutationResult<AckStateDto, unknown, void> {
  const qc = useQueryClient();
  const key = coachCommunityKeys.ackState(messageId);
  const fn =
    target === 'seen'
      ? coachCommunityApi.markCoachAckSeen
      : target === 'acked'
        ? coachCommunityApi.markCoachAckAcked
        : coachCommunityApi.markCoachAckReplied;

  return useMutation<AckStateDto, unknown, void, { prev?: AckStateDto }>({
    mutationFn: async () => {
      const res = await fn(messageId);
      return res.ack;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AckStateDto>(key);
      qc.setQueryData<AckStateDto>(key, projectOptimistic(prev, target));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      // Restore the exact prior snapshot. When there was NO prior value we
      // remove the cache entry rather than calling setQueryData(undefined)
      // (React Query treats an `undefined` updater value as a no-op, which
      // would otherwise strand the optimistic state). Removing it makes the
      // badge fall back to its `none` source-of-truth, never a stale optimistic
      // state.
      if (ctx?.prev === undefined) {
        qc.removeQueries({ queryKey: key, exact: true });
      } else {
        qc.setQueryData<AckStateDto>(key, ctx.prev);
      }
    },
    onSuccess: (ack) => {
      // Reconcile with the authoritative server envelope (canonical timestamps
      // + recomputed SLA snapshot).
      qc.setQueryData<AckStateDto>(key, ack);
    },
  });
}

/**
 * Typed ack actions for a single message. The screen reads the live ack state
 * from `coachCommunityKeys.ackState(messageId)` (seeded by the inbox payload
 * and updated optimistically here) and fires `markSeen/markAcked/markReplied`
 * from the row quick-actions.
 */
export function useCoachAckActions(messageId: string): CoachAckActions {
  return {
    markSeen: useAckMutation(messageId, 'seen'),
    markAcked: useAckMutation(messageId, 'acked'),
    markReplied: useAckMutation(messageId, 'replied'),
  };
}
