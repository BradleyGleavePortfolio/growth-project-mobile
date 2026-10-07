/**
 * useAiBuilder — Ask AI state (AIB-5): idle -> thinking (staged reveal) -> review (cards) -> applying.
 * Nothing reaches the plan until the coach taps Apply; Discard rejects the draft on the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  aiBuilderApi, toAiBuilderError,
  type AiBuilderInjuryArea, type AiBuilderProposal, type AiBuilderQuickAction, type AiBuilderRef, type AiBuilderStatus,
} from '../../../api/aiBuilderApi';
import { AI_STAGES, describeAiBuilderError, WAIT_FOR_SAVE_COPY } from './aiBuilderCopy';

export type AiHaptic = 'light' | 'medium' | 'success' | 'warning' | 'error' | 'selection';

/** Haptics are decoration: an unsupported device (web, simulator) must never break a tap. */
export function fireAiHaptic(kind: AiHaptic): void {
  void (async () => {
    try {
      const { ImpactFeedbackStyle: I, NotificationFeedbackType: N } = Haptics;
      await (kind === 'selection' ? Haptics.selectionAsync()
        : kind === 'light' || kind === 'medium' ? Haptics.impactAsync(kind === 'light' ? I.Light : I.Medium)
        : Haptics.notificationAsync(kind === 'success' ? N.Success : kind === 'warning' ? N.Warning : N.Error));
    } catch {
      // No haptic engine on this device: nothing to do.
    }
  })();
}

export const AI_STAGE_MS = 700;
const AI_CARD_TICKS_MAX = 5;

export interface UseAiBuilderArgs {
  planId: string | undefined;
  isBlank: boolean;
  prepare: () => Promise<{ ok: boolean; lockToken?: string }>; // land pending edits; ok=false while one is unsaved
  onApplied: (ref: AiBuilderRef, count: number) => void | Promise<void>; // fold the server copy into the screen
}

export function useAiBuilder({ planId, isBlank, prepare, onApplied }: UseAiBuilderArgs) {
  // undefined = loading or unreadable (entry stays visible; propose reports the cause);
  // null = route absent on this backend (404): the ONLY hide case.
  const [status, setStatus] = useState<AiBuilderStatus | null | undefined>(undefined);
  const [statusLoaded, setStatusLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => aiBuilderApi.getStatus())
      .then((s) => live && setStatus(s), () => live && setStatus(undefined))
      .finally(() => live && setStatusLoaded(true));
    return () => void (live = false);
  }, []);

  const [phase, setPhase] = useState<'idle' | 'thinking' | 'review' | 'applying'>('idle');
  const [stage, setStage] = useState(0);
  const [proposal, setProposal] = useState<AiBuilderProposal | null>(null);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopStages = useCallback(() => void (timer.current && clearInterval(timer.current)), []);
  useEffect(() => stopStages, [stopStages]);

  const fail = useCallback((err: unknown) => {
    const e = toAiBuilderError(err);
    fireAiHaptic('error');
    setError(describeAiBuilderError(e.code, e.resetsAt));
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
      timer.current = setInterval(() => setStage((s) => Math.min(s + 1, AI_STAGES.length - 1)), AI_STAGE_MS);
      try {
        const ready = await prepare();
        if (!ready.ok) {
          setError(WAIT_FOR_SAVE_COPY);
          return setPhase('idle');
        }
        const res = await aiBuilderApi.propose({
          mode: isBlank ? 'create' : 'edit', plan_id: planId, lock_token: ready.lockToken,
          instruction: args.instruction.trim(), quick_action: args.quickAction, injury_area: args.injuryArea,
        });
        setProposal(res);
        setKept(Object.fromEntries(res.changes.map((c) => [c.change_id, true])));
        setPhase('review');
        res.changes.slice(0, AI_CARD_TICKS_MAX).forEach((_, i) => setTimeout(() => fireAiHaptic('light'), i * 60));
      } catch (err) {
        fail(err);
        setPhase('idle');
      } finally {
        stopStages();
      }
    },
    [planId, phase, prepare, isBlank, stopStages, fail],
  );

  const toggle = useCallback((changeId: string) => {
    setKept((cur) => {
      fireAiHaptic(cur[changeId] ? 'warning' : 'selection');
      return { ...cur, [changeId]: !cur[changeId] };
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
    setProposal(null);
    setPhase('idle');
    setError(null);
    if (!proposal) return;
    try {
      await aiBuilderApi.discard(proposal.draft_id);
    } catch {
      // A failed reject leaves the draft pending server-side (it expires); the plan is unchanged either way.
    }
  }, [proposal]);

  return { visible: statusLoaded && status !== null, status: status ?? null, phase, stage, proposal, kept, acceptedIds, error, propose, toggle, apply, discard };
}

export type AiBuilderController = ReturnType<typeof useAiBuilder>;
