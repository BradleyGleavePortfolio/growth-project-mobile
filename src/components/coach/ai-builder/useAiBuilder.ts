/**
 * useAiBuilder — state for Ask AI in the workout builder (AIB-5).
 * idle -> thinking (staged reveal) -> review (change cards) -> applying -> idle,
 * with a specific error line for every refusal. Nothing reaches the plan until
 * the coach taps Apply; Discard rejects the draft on the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  aiBuilderApi,
  toAiBuilderError,
  type AiBuilderDecision,
  type AiBuilderInjuryArea,
  type AiBuilderProposal,
  type AiBuilderQuickAction,
  type AiBuilderStatus,
} from '../../../api/aiBuilderApi';
import { AI_STAGES, describeAiBuilderError, WAIT_FOR_SAVE_COPY } from './aiBuilderCopy';

export type AiHaptic = 'light' | 'medium' | 'success' | 'warning' | 'error' | 'selection';

export function fireAiHaptic(kind: AiHaptic): void {
  const run = (): Promise<void> => {
    switch (kind) {
      case 'light':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'medium':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'selection':
        return Haptics.selectionAsync();
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'warning':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case 'error':
      default:
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };
  try {
    // Haptics are decoration: an unsupported device must never break a tap.
    void run().catch(() => {
      /* no haptic engine (web, simulator): nothing to do */
    });
  } catch {
    /* expo-haptics unavailable */
  }
}

export const AI_STAGE_MS = 700;
export const AI_CARD_TICKS_MAX = 5;

export type AiBuilderPhase = 'idle' | 'thinking' | 'review' | 'applying';

export interface UseAiBuilderArgs {
  planId: string | undefined;
  isBlank: boolean;
  clientId?: string;
  /** Land pending autosave edits; resolves false when an edit is still unsaved. */
  prepare: () => Promise<{ ok: boolean; lockToken?: string }>;
  /** Fold the server copy into the screen after an apply. */
  onApplied: (ref: AiBuilderDecision['materialised_ref'], count: number) => void | Promise<void>;
}

export function useAiBuilder({ planId, isBlank, clientId, prepare, onApplied }: UseAiBuilderArgs) {
  // undefined = loading or unreadable (entry stays visible; propose reports
  // the cause); null = route absent on this backend (404): the ONLY hide case.
  const [status, setStatus] = useState<AiBuilderStatus | null | undefined>(undefined);
  const [statusLoaded, setStatusLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => aiBuilderApi.getStatus())
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(undefined);
      })
      .finally(() => {
        if (!cancelled) setStatusLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const visible = statusLoaded && status !== null;

  const [phase, setPhase] = useState<AiBuilderPhase>('idle');
  const [stage, setStage] = useState(0);
  const [proposal, setProposal] = useState<AiBuilderProposal | null>(null);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStages = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stopStages, [stopStages]);

  const fail = useCallback((err: unknown) => {
    const e = toAiBuilderError(err);
    setError(describeAiBuilderError(e.code, e.resetsAt));
    fireAiHaptic('error');
  }, []);

  const propose = useCallback(
    async (args: { instruction: string; quickAction?: AiBuilderQuickAction; injuryArea?: AiBuilderInjuryArea }) => {
      if (!planId || phase === 'thinking' || phase === 'applying') return;
      fireAiHaptic('medium');
      setError(null);
      setProposal(null);
      setPhase('thinking');
      setStage(0);
      stopStages();
      timer.current = setInterval(() => {
        setStage((s) => Math.min(s + 1, AI_STAGES.length - 1));
      }, AI_STAGE_MS);
      try {
        const ready = await prepare();
        if (!ready.ok) {
          setError(WAIT_FOR_SAVE_COPY);
          setPhase('idle');
          return;
        }
        const res = await aiBuilderApi.propose({
          mode: isBlank ? 'create' : 'edit',
          plan_id: planId,
          lock_token: ready.lockToken,
          client_id: clientId,
          instruction: args.instruction.trim(),
          quick_action: args.quickAction,
          injury_area: args.injuryArea,
        });
        setProposal(res);
        setKept(Object.fromEntries(res.changes.map((c) => [c.change_id, true])));
        setPhase('review');
        res.changes.slice(0, AI_CARD_TICKS_MAX).forEach((_, i) => {
          setTimeout(() => fireAiHaptic('light'), i * 60);
        });
      } catch (err) {
        fail(err);
        setPhase('idle');
      } finally {
        stopStages();
      }
    },
    [planId, phase, prepare, isBlank, clientId, stopStages, fail],
  );

  const toggle = useCallback((changeId: string) => {
    setKept((cur) => {
      const next = !cur[changeId];
      fireAiHaptic(next ? 'selection' : 'warning');
      return { ...cur, [changeId]: next };
    });
  }, []);

  const acceptedIds = proposal ? proposal.changes.filter((c) => kept[c.change_id]).map((c) => c.change_id) : [];

  const apply = useCallback(async () => {
    if (!proposal || phase !== 'review' || acceptedIds.length === 0) return false;
    setPhase('applying');
    setError(null);
    try {
      const res = await aiBuilderApi.apply(proposal.draft_id, acceptedIds);
      fireAiHaptic('success');
      setProposal(null);
      setPhase('idle');
      await onApplied(res.materialised_ref ?? null, acceptedIds.length);
      return true;
    } catch (err) {
      fail(err);
      setPhase('review');
      return false;
    }
  }, [proposal, phase, acceptedIds, onApplied, fail]);

  const discard = useCallback(async () => {
    fireAiHaptic('warning');
    const draft = proposal;
    setProposal(null);
    setPhase('idle');
    setError(null);
    if (!draft) return;
    try {
      await aiBuilderApi.discard(draft.draft_id);
    } catch {
      // The draft stays pending server-side and expires; the plan is unchanged.
    }
  }, [proposal]);

  return {
    visible,
    status: status ?? null,
    phase,
    stage,
    proposal,
    kept,
    acceptedIds,
    error,
    propose,
    toggle,
    apply,
    discard,
    clearError: () => setError(null),
  };
}

export type AiBuilderController = ReturnType<typeof useAiBuilder>;
