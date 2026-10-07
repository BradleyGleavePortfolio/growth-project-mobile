/** useAiBuilder (AIB-5): idle -> thinking (staged reveal) -> review -> applying. Nothing reaches the plan before Apply. */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { aiBuilderApi, toAiBuilderError, type AiBuilderInjuryArea, type AiBuilderProposal, type AiBuilderQuickAction, type AiBuilderRef, type AiBuilderStatus } from '../../../api/aiBuilderApi';
import { AI_STAGES, aiStages, describeAiBuilderError, WAIT_FOR_SAVE_COPY } from './aiBuilderCopy';

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

const AI_STAGE_MS = 700; // staged reveal step; card ticks capped at 5 per reveal

export interface UseAiBuilderArgs {
  planId: string | undefined;
  isBlank: boolean;
  prepare: () => Promise<{ ok: boolean; lockToken?: string }>; // land pending edits; ok=false while one is unsaved
  onApplied: (ref: AiBuilderRef, count: number) => void | Promise<void>; // fold the server copy into the screen
}

export function useAiBuilder({ planId, isBlank, prepare, onApplied }: UseAiBuilderArgs) {
  // value null = route absent (404): the ONLY hide case. error = status unreadable: the entry stays visible with a retry.
  const [status, setStatus] = useState<{ loaded: boolean; value?: AiBuilderStatus | null; error?: string; checking?: boolean }>({ loaded: false });
  const live = useRef(true);
  const loadStatus = useCallback(() => {
    setStatus((s) => ({ ...s, checking: true }));
    void Promise.resolve().then(() => aiBuilderApi.getStatus()).then(
      (value) => live.current && setStatus({ loaded: true, value }),
      (err: unknown) => live.current && setStatus({ loaded: true, error: describeAiBuilderError(toAiBuilderError(err).code) }),
    );
  }, []);
  useEffect(() => {
    live.current = true;
    loadStatus();
    return () => void (live.current = false);
  }, [loadStatus]);

  const [phase, setPhase] = useState<'idle' | 'thinking' | 'review' | 'applying'>('idle');
  const [stage, setStage] = useState(0);
  const [stages, setStages] = useState<readonly string[]>(AI_STAGES); // U1: the labels match what the server screens for this ask
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
      setError(null); setProposal(null); setPhase('thinking'); setStage(0); setStages(aiStages(!!args.injuryArea)); stopStages();
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
        res.changes.slice(0, 5).forEach((_, i) => setTimeout(() => fireAiHaptic('light'), i * 60));
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
    fireAiHaptic(kept[changeId] ? 'warning' : 'selection');
    setKept((cur) => ({ ...cur, [changeId]: !cur[changeId] }));
  }, [kept]);

  const acceptedIds = proposal ? proposal.changes.filter((c) => kept[c.change_id]).map((c) => c.change_id) : [];

  const apply = useCallback(async () => {
    if (!proposal?.draft_id || phase !== 'review' || acceptedIds.length === 0) return false;
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
    setProposal(null); setPhase('idle'); setError(null);
    if (!proposal?.draft_id) return; // explain writes no draft: nothing to reject
    try {
      await aiBuilderApi.discard(proposal.draft_id);
    } catch {
      // A failed reject leaves the draft pending server-side (it expires); the plan is unchanged either way.
    }
  }, [proposal]);

  return { visible: status.loaded && status.value !== null, status: status.value ?? null, statusError: status.error ?? null, checking: !!status.checking, retryStatus: loadStatus, phase, stage, stages, proposal, kept, acceptedIds, error, propose, toggle, apply, discard };
}

export type AiBuilderController = ReturnType<typeof useAiBuilder>;
