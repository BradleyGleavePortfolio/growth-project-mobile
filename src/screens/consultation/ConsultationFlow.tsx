/**
 * ConsultationFlow: the config-driven consultation onboarding.
 *
 * One component owns the flow state (answers, current screen, phase) and
 * renders each screen from its data definition. Navigation, validation and
 * resume rules live in the pure engine (`lib/consultation/engine.ts`), resume
 * reconciliation in `lib/consultation/resume.ts`.
 *
 * Consent first (Sol A-02, A-03; operator decision 2026-09-30):
 *   - P0, the single "I agree" box, comes straight after W1. Ticking it and
 *     pressing Continue records POST /me/ai-consent/onboarding with the
 *     versions the displayed copy is bound to (CONSENT_BINDING). Only a 2xx
 *     counts; nothing is sent to PUT /me/onboarding/consultation before it.
 *   - 409 CONSENT_VERSION_MISMATCH fails closed: the box is cleared, nothing
 *     is uploaded, and the client is asked to update the app.
 *   - A stored P0 is honoured only when it matches this build's copy version
 *     AND the server record (GET /me/ai-consent) is a live grant of the bound
 *     versions. Stale, malformed or revoked records send the client back to P0
 *     with the box unticked. The app never re-grants on its own: a grant is
 *     only ever sent from an explicit tick.
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
import { ActivityIndicator, BackHandler, Platform, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  consultationApi as defaultApi,
  CompleteOnboardingResponse,
  CompleteOutcome,
  ConsentStatusResponse,
  conflictCodeOf,
  httpStatusOf,
} from '../../api/consultationApi';
import { CONSULTATION_VERSION, screenById } from '../../lib/consultation/definitions';
import {
  answersForSave,
  chapterProgress,
  CopyContext,
  defaultAnswerFor,
  endsChapter,
  firstIncompleteScreenId,
  firstScreenOfChapter,
  isConsentAnswerCurrent,
  isSatisfied,
  lastScreenOfChapter,
  nextScreenId,
  previousScreenId,
  resumeScreenId,
} from '../../lib/consultation/engine';
import { CONSENT_BINDING, consentCopyText } from '../../lib/consultation/copy';
import { DraftHandle, openDraft, purgeConsultationDraft, readLocalState, SyncedMarker, writeDraft } from '../../lib/consultation/storage';
import { reconcileResume } from '../../lib/consultation/resume';
import type { AnswerValue, Answers, ChapterId } from '../../lib/consultation/types';
import { logger } from '../../utils/logger';
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

export type ConsultationApi = Pick<
  typeof defaultApi,
  'save' | 'getState' | 'complete' | 'grantOnboardingConsent' | 'getConsentStatus'
>;

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

/** Consent state for this session. Only 'verified' allows a server save. */
type ConsentState = 'none' | 'unverified' | 'verified';
type ConsentCheck = 'ok' | 'invalid' | 'mismatch' | 'unreachable';
export type ConsentError = 'network' | 'version_mismatch' | null;

/** Does a server consent record grant exactly what this build's P0 copy covers? */
export function checkConsentStatus(status: ConsentStatusResponse | null | undefined): Exclude<ConsentCheck, 'unreachable'> {
  const r = status?.roman;
  if (!r) return 'invalid';
  if (
    r.current_version !== CONSENT_BINDING.ai_consent_version ||
    (r.waiver_current_version != null && r.waiver_current_version !== CONSENT_BINDING.waiver_version)
  ) {
    return 'mismatch';
  }
  const live = r.granted === true && !!r.granted_at && (!r.revoked_at || Date.parse(r.revoked_at) < Date.parse(r.granted_at));
  if (!live || r.needs_reconsent) return 'invalid';
  if (r.version !== CONSENT_BINDING.ai_consent_version) return 'invalid';
  if (r.waiver_version !== CONSENT_BINDING.waiver_version) return 'invalid';
  return 'ok';
}

type SaveOutcome = 'ok' | 'consent' | 'error';

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
  const [consentBusy, setConsentBusy] = useState(false);
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
  const consent = useRef<ConsentState>('none');
  const queue = useRef<SaveQueue>(newQueue());
  /**
   * Whether the server already holds this session's P0. Backend #607 is
   * consent-first: until it does, the only PUT it accepts is P0 on its own,
   * so the queue sends that first and only then the rest of the answers.
   */
  const consentOnServer = useRef(false);
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
      consent.current = 'none';
      consentOnServer.current = false;
      const next = { ...answersRef.current };
      delete next.P0;
      setAnswers(next);
      setConsentError(error);
      setConsentNonce((n) => n + 1);
      return next;
    },
    [setAnswers],
  );

  const fetchConsentCheck = useCallback(async (): Promise<ConsentCheck> => {
    try {
      return checkConsentStatus(await api.getConsentStatus());
    } catch (err) {
      logger.warn('ConsultationFlow', 'consent status unavailable; uploads held', err);
      return 'unreachable';
    }
  }, [api]);

  /**
   * The upload gate. True only when this session has a recorded or verified
   * agreement matching the displayed copy. `fresh` re-reads the server record
   * (used before completion, to honour a revocation made elsewhere).
   */
  const ensureConsent = useCallback(
    async (gen: number, fresh = false): Promise<ConsentCheck> => {
      if (!isConsentAnswerCurrent(answersRef.current.P0)) return 'invalid';
      if (consent.current === 'verified' && !fresh) return 'ok';
      if (consent.current === 'none') return 'invalid';
      const check = await fetchConsentCheck();
      if (gen !== generation.current) return 'unreachable';
      if (check === 'ok') consent.current = 'verified';
      return check;
    },
    [fetchConsentCheck],
  );

  /**
   * Enqueue a save of `ans`. Serialized and coalesced. Resolves 'ok' on a 2xx,
   * 'consent' when the agreement is missing, stale or rejected by the server
   * (the client is taken back to P0, unticked), 'error' otherwise.
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
        return 'consent';
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
        const gate = await ensureConsent(gen);
        if (gen !== generation.current || q.closed) return 'error';
        if (gate !== 'ok') {
          if (gate === 'invalid' || gate === 'mismatch') {
            // Revoked, stale or never recorded: nothing goes up, and the
            // client is taken back to the agreement with the box unticked.
            logger.warn('ConsultationFlow', `save held: consent ${gate}`);
            return backToAgreement(gate === 'mismatch' ? 'version_mismatch' : null);
          }
          return 'error';
        }
        try {
          const body = answersForSave(snapshot);
          if (!consentOnServer.current) {
            // Consent first: P0 alone, then (separately) everything else.
            await put({ P0: body.P0 });
            if (gen !== generation.current) return 'error';
            consentOnServer.current = true;
          }
          if (Object.keys(body).some((k) => k !== 'P0')) {
            await put(body);
            if (gen !== generation.current) return 'error';
          }
          if (answersRef.current === snapshot) dirty.current = false;
          persistLocal(answersRef.current, screenRef.current);
          return 'ok';
        } catch (err) {
          if (gen !== generation.current) return 'error';
          if (httpStatusOf(err) === 409 && conflictCodeOf(err) === 'consent_missing') {
            // The server has no current agreement on file (outdated copy,
            // revoked, or never stored). Fail closed back to P0.
            logger.warn('ConsultationFlow', 'save rejected: consent_missing; back to the agreement');
            return backToAgreement(null);
          }
          logger.warn('ConsultationFlow', 'save failed; kept on this device', err);
          return 'error';
        }
      });
      q.waiting = run;
      q.tail = run.catch((): SaveOutcome => 'error');
      return run;
    },
    [api, dropConsent, ensureConsent, persistLocal, showScreen],
  );

  // ── Load and resume ────────────────────────────────────────────────────
  useEffect(() => {
    const gen = ++generation.current;
    queue.current.closed = true;
    queue.current = newQueue();
    draft.current = openDraft(userId);
    consent.current = 'none';
    consentOnServer.current = false;
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

      let resumeConsentError: ConsentError = null;
      if (ans.P0 !== undefined) {
        if (!isConsentAnswerCurrent(ans.P0)) {
          ans = { ...ans };
          delete ans.P0;
        } else {
          const check = await fetchConsentCheck();
          if (!live()) return;
          if (check === 'ok') consent.current = 'verified';
          else if (check === 'unreachable') consent.current = 'unverified';
          else {
            ans = { ...ans };
            delete ans.P0;
            if (check === 'mismatch') resumeConsentError = 'version_mismatch';
          }
        }
      }
      setAnswers(ans, false);
      setConsentError(resumeConsentError);
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
  const recordConsent = useCallback(
    async (record: Answers['P0']): Promise<boolean> => {
      const gen = generation.current;
      setConsentBusy(true);
      setConsentError(null);
      let sha: string | undefined;
      try {
        const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, consentCopyText());
        sha = /^[a-f0-9]{64}$/i.test(digest) ? digest : undefined;
      } catch {
        sha = undefined;
      }
      const outcome = await api.grantOnboardingConsent({
        ai_consent_version: CONSENT_BINDING.ai_consent_version,
        waiver_version: CONSENT_BINDING.waiver_version,
        copy_sha256: sha,
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      });
      if (gen !== generation.current) return false;
      setConsentBusy(false);
      if (outcome.kind === 'ok') {
        consent.current = 'verified';
        const next = { ...answersRef.current, P0: record as AnswerValue };
        setAnswers(next);
        return true;
      }
      if (outcome.kind === 'version_mismatch') {
        logger.warn('ConsultationFlow', 'consent copy version rejected by the server; failing closed');
        dropConsent('version_mismatch');
        return false;
      }
      setConsentError('network');
      return false;
    },
    [api, dropConsent, setAnswers],
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
    (patch?: Answers) => {
      clearTimer();
      const from = screenRef.current;
      if (from === 'P0') {
        if (consentBusy) return;
        const record = patch?.P0 ?? answersRef.current.P0;
        if (!isConsentAnswerCurrent(record)) return;
        void (async () => {
          if (consent.current === 'verified' && isConsentAnswerCurrent(answersRef.current.P0)) {
            goNext('P0', answersRef.current);
            return;
          }
          if (await recordConsent(record)) {
            const ans = answersRef.current;
            persistLocal(ans, 'P0');
            // The server copy starts with the recorded agreement (backend #607 reads P0).
            void enqueueSave(ans);
            goNext('P0', ans);
          }
        })();
        return;
      }
      let ans = answersRef.current;
      if (patch) {
        ans = { ...ans, ...patch };
        setAnswers(ans);
      }
      goNext(from, ans);
    },
    [clearTimer, consentBusy, enqueueSave, goNext, persistLocal, recordConsent, setAnswers],
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
    const consentFailure = async (check: ConsentCheck) => {
      if (check === 'unreachable') return fail('network');
      dropConsent(check === 'mismatch' ? 'version_mismatch' : null);
      return fail(check === 'mismatch' ? 'consent_version_mismatch' : 'consent_missing');
    };

    // 1. The agreement must still be live on the server (a revocation wins).
    const gate = await ensureConsent(gen, true);
    if (!live()) return;
    if (gate !== 'ok') return consentFailure(gate);

    // 2. Drain the save queue with the final snapshot, then close it.
    const saveFinal = async () => {
      queue.current.closed = false;
      const out = await enqueueSave(answersRef.current);
      queue.current.closed = true;
      return out;
    };
    const saved = await saveFinal();
    if (!live()) return;
    if (saved === 'consent') return fail('consent_missing');
    if (saved !== 'ok') return fail('network');

    // 3. Complete. consent_missing: re-read the record; if it is live the
    // saved P0 was missing, so save once more and retry once. Never re-grant.
    let outcome: CompleteOutcome = await api.complete();
    if (!live()) return;
    if (outcome.kind === 'conflict' && outcome.code === 'consent_missing') {
      const again = await ensureConsent(gen, true);
      if (!live()) return;
      if (again !== 'ok') return consentFailure(again);
      consentOnServer.current = false; // resend P0 on its own first
      const resaved = await saveFinal();
      if (!live()) return;
      if (resaved === 'consent') return fail('consent_missing');
      if (resaved !== 'ok') return fail('network');
      outcome = await api.complete();
      if (!live()) return;
    }
    if (outcome.kind === 'conflict' && outcome.code === 'consent_version_mismatch') {
      return consentFailure('mismatch');
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
  }, [api, dropConsent, enqueueSave, ensureConsent, prepMinMs, setPhaseBoth]);

  const onProblemAction = useCallback(() => {
    const ans = answersRef.current;
    if (problem === 'consent_missing' || problem === 'consent_version_mismatch') {
      showScreen('P0', ans);
      return;
    }
    if (problem === 'consultation_incomplete') {
      showScreen(firstIncompleteScreenId(ans, nowFn()) ?? 'G1', ans);
      return;
    }
    void prepare();
  }, [nowFn, prepare, problem, showScreen]);

  const finish = useCallback(() => {
    if (!result) return;
    void purgeConsultationDraft(userId);
    // INTEGRATION NOTE (#309, client tutorial, not yet on main): once #309 is
    // merged, call `startClientTutorial(result)` from 'src/tutorial/tutorialStore'
    // here, before onFinished. `result` is the POST /me/onboarding/complete
    // body (completeResponse.data). It is idempotent and returns false when
    // featureFlags.clientTutorial is off, so no extra flag check is needed.
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
        consent={{ busy: consentBusy, error: consentError }}
      />
    );
  }
}
