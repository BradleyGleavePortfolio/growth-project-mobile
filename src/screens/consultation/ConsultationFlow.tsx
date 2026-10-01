/**
 * ConsultationFlow: the config-driven consultation onboarding.
 *
 * One component owns the flow state (answers, current screen, phase) and
 * renders each screen from its data definition. Navigation, validation and
 * resume rules live in the pure engine (`lib/consultation/engine.ts`), resume
 * reconciliation in `lib/consultation/resume.ts`.
 *
 * Consent first (Sol A-02, A-03; D2 ruling 2026-10-01, two boxes on P0):
 *   - P0 comes straight after W1. Box 1 (waiver, collection and use for
 *     coaching) is required to continue; box 2 (Roman and AI drafts,
 *     processed by Anthropic) is optional and unticked by default.
 *   - Box 1 is recorded by the onboarding intake (backend #607): the first
 *     PUT /me/onboarding/consultation carries P0 alone, with this build's
 *     copy version and the sha256 of the text shown; nothing else is sent
 *     before it. 409 consent_missing on that P0-only PUT means the server no
 *     longer accepts this copy version: the box is cleared and the client is
 *     asked to update the app. On any later save it sends the client back to
 *     P0, unticked.
 *   - Box 2, when ticked, is recorded after the P0 save by
 *     POST /me/ai-consent/roman (R2a). Non-blocking: it never holds the
 *     flow, is retried once, is skipped silently while the ledger is not
 *     deployed (404 / 503), and is otherwise left for Settings > Privacy.
 *     It is never required for completion.
 *   - A stored P0 is honoured only when it matches this build's copy
 *     version; stale or malformed records send the client back to P0 with
 *     both boxes unticked. The app never ticks a box on its own.
 *
 * Saving (Sol B-02):
 *   - every answer is written to the encrypted local draft;
 *   - chapter ends and Pause enqueue a save; saves are serialized and
 *     coalesced (one in flight, the latest snapshot next), so an older
 *     request can never land after a newer one from this device;
 *   - "Prepare my plan" re-checks consent, drains the queue with a final
 *     save, closes the queue, then calls POST /me/onboarding/complete.
 *
 * Identity (Sol C-02): every async continuation is bound to the load
 * generation and the draft handle of the user it started for.
 *
 * There is no skip-to-finish path: the only way out is the plan reveal,
 * which is reached only through a successful complete call.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import {
  consultationApi,
  CompleteOnboardingResponse,
  CompleteOutcome,
  conflictCodeOf,
  httpStatusOf,
} from '../../api/consultationApi';
import { aiConsentApi } from '../../api/aiConsentApi';
import { grantRomanWithRetry } from '../../lib/consultation/aiConsent';
import { CONSULTATION_VERSION, screenById } from '../../lib/consultation/definitions';
import {
  answersForSave,
  chapterProgress,
  CopyContext,
  defaultAnswerFor,
  endsChapter,
  firstIncompleteScreenId,
  firstScreenOfChapter,
  hasAnswersBeyondConsent,
  isConsentAnswerCurrent,
  isSatisfied,
  lastScreenOfChapter,
  nextScreenId,
  previousScreenId,
  resumeScreenId,
} from '../../lib/consultation/engine';
import { DraftHandle, openDraft, purgeConsultationDraft, readLocalState, SyncedMarker, writeDraft } from '../../lib/consultation/storage';
import { reconcileResume } from '../../lib/consultation/resume';
import type { AnswerValue, Answers, ChapterId } from '../../lib/consultation/types';
import { logger } from '../../utils/logger';
import { startClientTutorial } from '../../tutorial/tutorialStore';
import QuestionScreen from './QuestionScreen';
import { AnalyticsExcluded, palette, STEP_MS } from './components';
import {
  CompleteProblem,
  CompleteProblemScreen,
  MacroRevealScreen,
  PausedScreen,
  PlanRevealScreen,
  SummaryScreen,
} from './RevealScreens';

export type ConsultationApi = Pick<typeof consultationApi, 'save' | 'getState' | 'complete'> & {
  /** Box 2: POST /me/ai-consent/roman (R2a). */
  grantRomanConsent: typeof aiConsentApi.grantRoman;
  /** Box 2 unticked again on a later visit to P0: DELETE /me/ai-consent/roman. */
  withdrawRomanConsent: typeof aiConsentApi.withdrawRoman;
};

const defaultApi: ConsultationApi = {
  save: consultationApi.save,
  getState: consultationApi.getState,
  complete: consultationApi.complete,
  grantRomanConsent: aiConsentApi.grantRoman,
  withdrawRomanConsent: aiConsentApi.withdrawRoman,
};

export interface ConsultationFlowProps {
  userId: string | null;
  firstName?: string | null;
  coachName?: string | null;
  /** Called after "Show me around" on the plan reveal. */
  onFinished: (result: CompleteOnboardingResponse) => void;
  api?: ConsultationApi;
  now?: () => Date;
  autoAdvanceMs?: number;
  /** Minimum time the preparing state stays up, so it never flashes. */
  prepMinMs?: number;
}

type Phase = 'loading' | 'question' | 'summary' | 'preparing' | 'macro' | 'plan' | 'paused' | 'problem';

export type ConsentError = 'version_mismatch' | null;

/**
 * Save outcomes. 'consent': the agreement is missing or was rejected (back
 * to P0). 'version': the P0-only PUT was rejected, so the server does not
 * accept this copy version (update the app). 'busy': 409
 * completion_in_progress. 'invalid': 400 invalid_answers. 'error': network
 * or anything else.
 */
type SaveOutcome = 'ok' | 'consent' | 'version' | 'busy' | 'invalid' | 'error';

interface SaveQueue {
  tail: Promise<SaveOutcome>;
  waiting: Promise<SaveOutcome> | null;
  pending: Answers | null;
  closed: boolean;
}

function newQueue(): SaveQueue {
  return { tail: Promise.resolve<SaveOutcome>('ok'), waiting: null, pending: null, closed: false };
}

export default function ConsultationFlow({
  userId,
  firstName,
  coachName,
  onFinished,
  api = defaultApi,
  now: nowFn = () => new Date(),
  autoAdvanceMs = STEP_MS,
  prepMinMs = 900,
}: ConsultationFlowProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [screenId, setScreenId] = useState<string>('W1');
  const [answers, setAnswersState] = useState<Answers>({});
  const [result, setResult] = useState<CompleteOnboardingResponse | null>(null);
  const [problem, setProblem] = useState<CompleteProblem>('unknown');
  const [consentError, setConsentError] = useState<ConsentError>(null);
  const [consentNonce, setConsentNonce] = useState(0);
  const answersRef = useRef<Answers>({});
  const screenRef = useRef<string>('W1');
  const phaseRef = useRef<Phase>('loading');
  const editChapterRef = useRef<ChapterId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const draft = useRef<DraftHandle>(openDraft(userId));
  const dirty = useRef(false);
  const editedAt = useRef<string>(new Date(0).toISOString());
  const synced = useRef<SyncedMarker | null>(null);
  const queue = useRef<SaveQueue>(newQueue());
  /**
   * Whether the server already holds this session's P0. Backend #607 is
   * consent-first: until it does, the only PUT it accepts is P0 on its own,
   * so the queue sends that first and only then the rest of the answers.
   */
  const consentOnServer = useRef(false);
  /**
   * Box 2 for this session: what the client last chose on P0, and a chain
   * that keeps the grant / withdraw requests in order (one per change).
   */
  const aiChoice = useRef(false);
  const [aiChoiceShown, setAiChoiceShown] = useState(false);
  const aiChain = useRef<Promise<void>>(Promise.resolve());
  /** P0 Continue is handled once per visit to P0 (Opus C-1 double tap). */
  const p0Handled = useRef(false);
  const now = nowFn();
  const ctx: CopyContext = { firstName, coachName: result?.coach?.display_name ?? coachName, now };

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const persistLocal = useCallback(
    (ans: Answers, id: string) => {
      void writeDraft(draft.current, {
        answers: ans,
        screenId: id,
        editedAt: editedAt.current,
        dirty: dirty.current,
        synced: synced.current,
      });
    },
    [],
  );

  /** Set answers; `edited` marks a real answer change (dirty, timestamped). */
  const setAnswers = useCallback((next: Answers, edited = true) => {
    answersRef.current = next;
    if (edited) {
      dirty.current = true;
      editedAt.current = new Date().toISOString();
    }
    setAnswersState(next);
  }, []);

  const showScreen = useCallback(
    (id: string, ans: Answers = answersRef.current) => {
      const def = screenById(id);
      let a = ans;
      if (def && a[def.id] === undefined) {
        const dflt = defaultAnswerFor(def, nowFn());
        if (dflt !== undefined) {
          a = { ...a, [def.id]: dflt };
          setAnswers(a);
        }
      }
      if (id === 'P0' && screenRef.current !== 'P0') p0Handled.current = false;
      screenRef.current = id;
      setScreenId(id);
      setPhaseBoth('question');
      persistLocal(a, id);
    },
    [nowFn, persistLocal, setAnswers, setPhaseBoth],
  );

  /** Remove the stored P0 and show the agreement unticked. */
  const dropConsent = useCallback(
    (error: ConsentError = null) => {
      consentOnServer.current = false;
      p0Handled.current = false;
      const next = { ...answersRef.current };
      delete next.P0;
      setAnswers(next);
      setConsentError(error);
      setConsentNonce((n) => n + 1);
      return next;
    },
    [setAnswers],
  );

  /** The upload gate: only a current, affirmative P0 (box 1) allows a server save. */
  const consentCurrent = useCallback(() => isConsentAnswerCurrent(answersRef.current.P0), []);

  /**
   * Enqueue a save of `ans`. Serialized and coalesced. Resolves 'ok' on a 2xx,
   * 'consent' / 'version' when the agreement is missing, stale or rejected
   * by the server (the client is taken back to P0, unticked), and 'busy',
   * 'invalid' or 'error' otherwise (see SaveOutcome).
   */
  const enqueueSave = useCallback(
    (ans: Answers): Promise<SaveOutcome> => {
      const q = queue.current;
      const gen = generation.current;
      if (q.closed) return Promise.resolve('error');
      q.pending = ans;
      if (q.waiting) return q.waiting;
      const backToAgreement = (error: ConsentError = null): SaveOutcome => {
        const next = dropConsent(error);
        if (phaseRef.current === 'question' || phaseRef.current === 'paused') showScreen('P0', next);
        return error === 'version_mismatch' ? 'version' : 'consent';
      };
      const put = async (answers: Answers) => {
        const res = await api.save({ version: CONSULTATION_VERSION, answers });
        synced.current = {
          saved_at: res?.saved_at ?? new Date().toISOString(),
          revision: typeof res?.revision === 'number' ? res.revision : synced.current?.revision ?? null,
        };
      };
      const run = q.tail.then(async (): Promise<SaveOutcome> => {
        q.waiting = null;
        const snapshot = q.pending;
        q.pending = null;
        if (!snapshot || q.closed || gen !== generation.current) return 'error';
        if (!isConsentAnswerCurrent(snapshot.P0) || !consentCurrent()) {
          // Stale or never recorded: nothing goes up, and the client is
          // taken back to the agreement with the boxes unticked.
          logger.warn('ConsultationFlow', 'save held: no current agreement');
          return backToAgreement(null);
        }
        let p0Only = false;
        try {
          const body = answersForSave(snapshot);
          const hadServerConsent = consentOnServer.current;
          if (!hadServerConsent) {
            // Consent first: P0 alone, then (separately) everything else.
            p0Only = true;
            await put({ P0: body.P0 });
            p0Only = false;
            if (gen !== generation.current) return 'error';
            consentOnServer.current = true;
          }
          // Clears (null) matter only once the server may hold answers.
          if (hasAnswersBeyondConsent(body) || hadServerConsent) {
            await put(body);
            if (gen !== generation.current) return 'error';
          }
          if (answersRef.current === snapshot) dirty.current = false;
          persistLocal(answersRef.current, screenRef.current);
          return 'ok';
        } catch (err) {
          if (gen !== generation.current) return 'error';
          const status = httpStatusOf(err);
          if (status === 409 && conflictCodeOf(err) === 'consent_missing') {
            // P0 alone was rejected: backend #607 does that only when it does
            // not accept this copy version, so ask for an update. Otherwise
            // the server has no current agreement on file: back to P0.
            logger.warn('ConsultationFlow', 'save rejected: consent_missing; back to the agreement');
            return backToAgreement(p0Only ? 'version_mismatch' : null);
          }
          if (status === 409 && conflictCodeOf(err) === 'completion_in_progress') return 'busy';
          if (status === 400) {
            logger.warn('ConsultationFlow', 'save rejected: invalid answers; kept on this device');
            return 'invalid';
          }
          logger.warn('ConsultationFlow', 'save failed; kept on this device', err);
          return 'error';
        }
      });
      q.waiting = run;
      q.tail = run.catch((): SaveOutcome => 'error');
      return run;
    },
    [api, consentCurrent, dropConsent, persistLocal, showScreen],
  );

  // ── Load and resume ────────────────────────────────────────────────────
  useEffect(() => {
    const gen = ++generation.current;
    queue.current.closed = true;
    queue.current = newQueue();
    draft.current = openDraft(userId);
    consentOnServer.current = false;
    aiChoice.current = false;
    setAiChoiceShown(false);
    aiChain.current = Promise.resolve();
    const live = () => gen === generation.current;
    (async () => {
      const local = await readLocalState(userId, nowFn());
      let server = null;
      try {
        server = await api.getState();
      } catch (err) {
        logger.warn('ConsultationFlow', 'GET /me/onboarding failed; using local state', err);
      }
      if (!live()) return;
      if (server?.completed && server.result) {
        setAnswers((server.answers ?? local?.answers ?? {}) as Answers, false);
        setResult(server.result);
        setPhaseBoth('macro');
        return;
      }
      // The server already holds a current agreement: no P0-only PUT needed.
      consentOnServer.current =
        isConsentAnswerCurrent((server?.answers as Answers | null | undefined)?.P0) && server?.consent_recorded !== false;
      const decision = reconcileResume(local, server);
      let ans = decision.answers;
      dirty.current = decision.dirty;
      synced.current = decision.synced;
      editedAt.current = local?.editedAt ?? new Date(0).toISOString();

      // A stored P0 counts only when it matches this build's copy version
      // (Sol A-03); a stale or malformed one shows P0 again, unticked.
      if (ans.P0 !== undefined && !isConsentAnswerCurrent(ans.P0)) {
        ans = { ...ans };
        delete ans.P0;
        consentOnServer.current = false;
      }
      setAnswers(ans, false);
      setConsentError(null);
      const id = resumeScreenId(decision.screenId, ans, nowFn());
      if (id === 'SUM') {
        persistLocal(ans, 'SUM');
        setPhaseBoth('summary');
      } else {
        showScreen(id, ans);
      }
    })();
    return () => {
      generation.current += 1;
      queue.current.closed = true;
      clearTimer();
    };
    // Load once per user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Consent (P0) ───────────────────────────────────────────────────────
  /**
   * Box 2 (optional): after the P0 save settles, record the Roman and AI
   * choice. Never awaited by the flow. Only a change is sent: ticking it
   * grants (POST, one retry), unticking it again on a later visit to P0
   * withdraws (DELETE). 404 / 503 are skipped silently; anything else is
   * left for Settings > Privacy > Roman and AI.
   */
  const recordAiChoice = useCallback(
    (p0Saved: Promise<SaveOutcome>, allow: boolean) => {
      if (allow === aiChoice.current) return;
      aiChoice.current = allow;
      setAiChoiceShown(allow);
      const gen = generation.current;
      aiChain.current = aiChain.current.then(async () => {
        const saved = await p0Saved;
        if (gen !== generation.current) return;
        if (allow && (saved === 'consent' || saved === 'version')) {
          // Box 1 was rejected: the client is back on P0 and chooses again.
          aiChoice.current = false;
          setAiChoiceShown(false);
          return;
        }
        if (allow) {
          const result = await grantRomanWithRetry(api.grantRomanConsent);
          if (result !== 'granted' && result !== 'unavailable') {
            logger.warn('ConsultationFlow', `optional AI choice not recorded (${result}); left for Settings`);
          }
          return;
        }
        const out = await api.withdrawRomanConsent().catch(() => ({ kind: 'error' as const, status: null }));
        if (out.kind !== 'ok' && out.kind !== 'unavailable') {
          logger.warn('ConsultationFlow', 'optional AI withdrawal not recorded; left for Settings');
        }
      }).catch(() => undefined);
    },
    [api],
  );

  // ── Navigation ─────────────────────────────────────────────────────────
  const goNext = useCallback(
    (fromId: string, ans: Answers) => {
      clearTimer();
      if (fromId !== screenRef.current || phaseRef.current !== 'question') return; // stale
      const def = screenById(fromId);
      // Never leave a screen whose current answers do not validate (Sol B-01):
      // this also covers a timer that fires after the answer changed.
      if (def && def.template !== 'intro' && def.template !== 'message' && !isSatisfied(def, ans, nowFn())) return;
      if (def && def.chapter > 0 && endsChapter(fromId, ans)) void enqueueSave(ans);

      const editing = editChapterRef.current;
      if (editing !== null && def && lastScreenOfChapter(editing, ans) === fromId) {
        editChapterRef.current = null;
        persistLocal(ans, 'SUM');
        setPhaseBoth('summary');
        return;
      }
      const next = nextScreenId(fromId, ans);
      if (!next) {
        persistLocal(ans, 'SUM');
        setPhaseBoth('summary');
        return;
      }
      showScreen(next, ans);
    },
    [clearTimer, enqueueSave, nowFn, persistLocal, setPhaseBoth, showScreen],
  );

  const onAnswer = useCallback(
    (key: string, value: AnswerValue | undefined, opts?: { advance?: boolean }) => {
      // Any answer change cancels a pending auto-advance (Sol B-01).
      clearTimer();
      const next = { ...answersRef.current, [key]: value };
      if (value === undefined) delete next[key];
      setAnswers(next);
      persistLocal(next, screenRef.current);
      if (opts?.advance) {
        const from = screenRef.current;
        if (autoAdvanceMs <= 0) goNext(from, next);
        else timer.current = setTimeout(() => goNext(from, answersRef.current), autoAdvanceMs);
      }
    },
    [autoAdvanceMs, clearTimer, goNext, persistLocal, setAnswers],
  );

  const onNext = useCallback(
    (patch?: Answers, aiAllowed = false) => {
      clearTimer();
      const from = screenRef.current;
      if (from === 'P0') {
        // Handled once per visit (Opus C-1): a double tap records once.
        if (p0Handled.current) return;
        const record = patch?.P0 ?? answersRef.current.P0;
        if (!isConsentAnswerCurrent(record)) return;
        p0Handled.current = true;
        const ans = { ...answersRef.current, P0: record as AnswerValue };
        setAnswers(ans);
        setConsentError(null);
        persistLocal(ans, 'P0');
        // Box 1: the intake starts with the agreement (P0 alone first).
        const saved = enqueueSave(ans);
        // Box 2: optional, recorded after the P0 save, never blocking.
        recordAiChoice(saved, aiAllowed);
        goNext('P0', ans);
        return;
      }
      if (patch && 'P0' in patch) return; // stale tap from an unmounting P0
      let ans = answersRef.current;
      if (patch) {
        ans = { ...ans, ...patch };
        setAnswers(ans);
      }
      goNext(from, ans);
    },
    [clearTimer, enqueueSave, goNext, persistLocal, recordAiChoice, setAnswers],
  );

  const onBack = useCallback(() => {
    clearTimer();
    if (phase === 'summary' || phase === 'problem') {
      const ans = answersRef.current;
      const last = lastScreenOfChapter(8, ans) ?? 'C1';
      showScreen(last, ans);
      return true;
    }
    if (phase === 'plan') {
      setPhaseBoth('macro');
      return true;
    }
    if (phase === 'question') {
      const prev = previousScreenId(screenRef.current, answersRef.current);
      if (prev) {
        showScreen(prev);
        return true;
      }
    }
    return phase !== 'macro';
  }, [clearTimer, phase, setPhaseBoth, showScreen]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => onBack());
    return () => sub.remove();
  }, [onBack]);

  const onFinishLater = useCallback(() => {
    clearTimer();
    const ans = answersRef.current;
    persistLocal(ans, screenRef.current);
    void enqueueSave(ans);
    setPhaseBoth('paused');
  }, [clearTimer, enqueueSave, persistLocal, setPhaseBoth]);

  // ── Completion ─────────────────────────────────────────────────────────
  const prepare = useCallback(async () => {
    const gen = generation.current;
    const live = () => gen === generation.current;
    const started = Date.now();
    setPhaseBoth('preparing');
    const hold = async () => {
      const left = prepMinMs - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    };
    const fail = async (p: CompleteProblem) => {
      await hold();
      if (!live()) return;
      queue.current.closed = false;
      setProblem(p);
      setPhaseBoth('problem');
    };
    const savedFailure = (out: SaveOutcome) => {
      if (out === 'consent') return fail('consent_missing');
      if (out === 'version') return fail('consent_version_mismatch');
      if (out === 'busy') return fail('completion_in_progress');
      if (out === 'invalid') return fail('invalid_answers');
      return fail('network');
    };

    // 1. Box 1 must be on file (box 2 is never required).
    if (!consentCurrent()) {
      dropConsent(null);
      return fail('consent_missing');
    }

    // 2. Drain the save queue with the final snapshot, then close it.
    const saveFinal = async () => {
      queue.current.closed = false;
      const out = await enqueueSave(answersRef.current);
      queue.current.closed = true;
      return out;
    };
    const saved = await saveFinal();
    if (!live()) return;
    if (saved !== 'ok') return savedFailure(saved);

    // 3. Complete. consent_missing: the saved P0 did not reach the server, so
    // send this session's P0 alone once more and retry once. Never ticks a box.
    let outcome: CompleteOutcome = await api.complete();
    if (!live()) return;
    if (outcome.kind === 'conflict' && outcome.code === 'consent_missing') {
      if (!consentCurrent()) {
        dropConsent(null);
        return fail('consent_missing');
      }
      consentOnServer.current = false; // resend P0 on its own first
      const resaved = await saveFinal();
      if (!live()) return;
      if (resaved !== 'ok') return savedFailure(resaved);
      outcome = await api.complete();
      if (!live()) return;
      if (outcome.kind === 'conflict' && outcome.code === 'consent_missing') {
        dropConsent(null);
        return fail('consent_missing');
      }
    }
    if (outcome.kind === 'conflict' && outcome.code === 'consent_version_mismatch') {
      dropConsent('version_mismatch');
      return fail('consent_version_mismatch');
    }
    await hold();
    if (!live()) return;
    if (outcome.kind === 'ok') {
      setResult(outcome.data);
      setPhaseBoth('macro');
      return;
    }
    if (outcome.kind === 'conflict') return fail(outcome.code === 'unknown' ? 'unknown' : outcome.code);
    return fail(outcome.status === null ? 'network' : 'unknown');
  }, [api, consentCurrent, dropConsent, enqueueSave, prepMinMs, setPhaseBoth]);

  const onProblemAction = useCallback(() => {
    const ans = answersRef.current;
    if (problem === 'consent_missing' || problem === 'consent_version_mismatch') {
      showScreen('P0', ans);
      return;
    }
    if (problem === 'invalid_answers') {
      setPhaseBoth('summary');
      return;
    }
    if (problem === 'consultation_incomplete') {
      showScreen(firstIncompleteScreenId(ans, nowFn()) ?? 'G1', ans);
      return;
    }
    void prepare();
  }, [nowFn, prepare, problem, setPhaseBoth, showScreen]);

  const finish = useCallback(() => {
    if (!result) return;
    void purgeConsultationDraft(userId);
    // Start Roman's client tutorial (#309) with the POST /me/onboarding/complete
    // body (completeResponse.data). Idempotent; returns false and does nothing
    // when featureFlags.clientTutorial is off. A tutorial fault never blocks
    // finishing the consultation.
    try {
      startClientTutorial(result);
    } catch (err) {
      logger.warn('ConsultationFlow', 'startClientTutorial failed', err);
    }
    onFinished(result);
  }, [onFinished, result, userId]);

  // ── Render ─────────────────────────────────────────────────────────────
  return <AnalyticsExcluded>{renderPhase()}</AnalyticsExcluded>;

  function renderPhase() {
    if (phase === 'loading') {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg }} testID="consult-loading">
          <ActivityIndicator color={palette.accent} accessibilityLabel="Loading your consultation" />
        </View>
      );
    }
    if (phase === 'summary' || phase === 'preparing') {
      return (
        <SummaryScreen
          answers={answers}
          ctx={ctx}
          now={now}
          preparing={phase === 'preparing'}
          onBack={() => onBack()}
          onPrepare={() => void prepare()}
          onEdit={(ch) => {
            editChapterRef.current = ch;
            showScreen(firstScreenOfChapter(ch, answersRef.current) ?? 'W1');
          }}
        />
      );
    }
    if (phase === 'problem') {
      return <CompleteProblemScreen problem={problem} onAction={onProblemAction} onBack={() => setPhaseBoth('summary')} />;
    }
    if (phase === 'paused') {
      return <PausedScreen ctx={ctx} onResume={() => showScreen(screenRef.current)} />;
    }
    if (phase === 'macro' && result) {
      return <MacroRevealScreen result={result} answers={answers} ctx={ctx} onNext={() => setPhaseBoth('plan')} />;
    }
    if (phase === 'plan' && result) {
      return <PlanRevealScreen result={result} answers={answers} ctx={ctx} now={now} onBack={() => setPhaseBoth('macro')} onFinish={finish} />;
    }

    const screen = screenById(screenId) ?? screenById('W1')!;
    const progress = screen.chapter === 0 ? null : chapterProgress(screen.id, answers);
    const prev = previousScreenId(screen.id, answers);
    return (
      <QuestionScreen
        key={`${screen.id}:${consentNonce}`}
        screen={screen}
        answers={answers}
        progress={progress}
        ctx={ctx}
        now={now}
        onAnswer={onAnswer}
        onNext={onNext}
        onBack={prev ? () => void onBack() : null}
        onFinishLater={screen.chapter === 0 ? null : onFinishLater}
        consent={{ error: consentError, aiAllowed: aiChoiceShown }}
      />
    );
  }
}
