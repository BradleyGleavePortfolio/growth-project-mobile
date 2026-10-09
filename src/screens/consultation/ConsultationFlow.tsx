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
 *     deployed (404 / 503), and is otherwise left for Settings > Privacy
 *     with a calm notice. It is never required for completion.
 *   - Box 2 follows the client's LATEST explicit choice (Sol / Opus
 *     B-310-3): every choice made on P0 is kept (also in the draft) and
 *     carried out through one serialized chain that decides each request
 *     only after the earlier ones settled, so an untick made while a grant
 *     is in flight, or before GET /me/ai-consent answers, always ends with
 *     the grant withdrawn.
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
import { ActivityIndicator, Alert, BackHandler, View } from 'react-native';
import {
  consultationApi,
  CompleteOnboardingResponse,
  CompleteOutcome,
  conflictCodeOf,
  httpStatusOf,
} from '../../api/consultationApi';
import { aiConsentApi, type AiConsentUpgradeCopy } from '../../api/aiConsentApi';
import {
  clearAiWithdrawalPending,
  isLiveRomanGrant,
  runAiMarkerStep,
  grantRomanWithRetry,
  markAiWithdrawalPending,
  readAiWithdrawalPending,
  romanBox2MemoryCopyOf,
  romanGrantBody,
  runAiLedgerWrite,
  withdrawRomanWithRetry,
} from '../../lib/consultation/aiConsent';
import { AI_GRANT_NOTICE, AI_GRANT_UNCONFIRMED_NOTICE, AI_WITHDRAW_NOTICE, welcomeBackLine } from '../../lib/consultation/copy';
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
import {
  aiAttemptedOf,
  aiRomanOf,
  aiWantOf,
  DraftHandle,
  openDraft,
  purgeConsultationDraft,
  readLocalState,
  SyncedMarker,
  writeDraft,
} from '../../lib/consultation/storage';
import { readUserCacheSync } from '../../lib/userCache';
import {
  acceptFirstSignInCoachSharing,
  readFirstSignInCoachSharing,
  type FirstSignInSharing,
} from '../../lib/coachSharingFirstSignIn';
import { reconcileResume } from '../../lib/consultation/resume';
import type { AnswerValue, Answers, ChapterId } from '../../lib/consultation/types';
import { logger } from '../../utils/logger';
import { shortReference, supportReferenceOf } from '../../utils/correlation';
import { reportUnexpected, UnexpectedFailure } from '../../lib/consultation/report';
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
  /** Box 2 on P0 shows the ledger's state: GET /me/ai-consent (R2a). */
  getRomanConsent: typeof aiConsentApi.getStatus;
  /** Box 2: POST /me/ai-consent/roman (R2a). */
  grantRomanConsent: typeof aiConsentApi.grantRoman;
  /** Box 2 unticked again on a later visit to P0: DELETE /me/ai-consent/roman. */
  withdrawRomanConsent: typeof aiConsentApi.withdrawRoman;
  /**
   * The signed-in user right now. Box 2 requests still queued when the
   * client finishes go out only while this is still the same user.
   */
  sessionUserId?: () => string | null;
  /**
   * B-SHARE-GUEST-127: the coach-sharing sentence P0 prints above Continue
   * for an account linked outside the app (GET /consent/coach-sharing-notice),
   * and the record sent on that Continue (POST). Absent: nothing shown.
   */
  getCoachSharingNotice?: () => Promise<FirstSignInSharing | null>;
  acceptCoachSharingNotice?: (version: string) => Promise<boolean>;
};

const defaultApi: ConsultationApi = {
  save: consultationApi.save,
  getState: consultationApi.getState,
  complete: consultationApi.complete,
  getRomanConsent: aiConsentApi.getStatus,
  grantRomanConsent: aiConsentApi.grantRoman,
  withdrawRomanConsent: aiConsentApi.withdrawRoman,
  sessionUserId: () => readUserCacheSync()?.id ?? null,
  getCoachSharingNotice: readFirstSignInCoachSharing,
  acceptCoachSharingNotice: acceptFirstSignInCoachSharing,
};

/**
 * How long box 2 waits for GET /me/ai-consent before it becomes tappable
 * when this device knows nothing yet (Opus C-310-7). Bounded so a slow read
 * never holds the optional box for the whole API timeout; a later answer is
 * still reconciled with whatever the client chose.
 */
export const AI_STATUS_WAIT_MS = 3000;

export interface ConsultationFlowProps {
  userId: string | null;
  firstName?: string | null;
  coachName?: string | null;
  /** The client has no coach (no coach_id): copy that names a coach uses its coachless version. */
  coachless?: boolean;
  /** Called after "Show me around" on the plan reveal. */
  onFinished: (result: CompleteOnboardingResponse) => void;
  api?: ConsultationApi;
  now?: () => Date;
  autoAdvanceMs?: number;
  /** Minimum time the preparing state stays up, so it never flashes. */
  prepMinMs?: number;
  /** Sign out from the problem and paused screens (operator C-310-3). Hidden when absent. */
  onSignOut?: () => void;
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

/** The machine `code` of a failed request's body, when it has one. */
function machineCodeOf(err: unknown): string | null {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  const code = data && typeof data === 'object' ? (data as Record<string, unknown>).code : undefined;
  return typeof code === 'string' ? code : null;
}

function newQueue(): SaveQueue {
  return { tail: Promise.resolve<SaveOutcome>('ok'), waiting: null, pending: null, closed: false };
}

export default function ConsultationFlow({
  userId,
  firstName,
  coachName,
  coachless = false,
  onFinished,
  api = defaultApi,
  now: nowFn = () => new Date(),
  autoAdvanceMs = STEP_MS,
  prepMinMs = 900,
  onSignOut,
}: ConsultationFlowProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [screenId, setScreenId] = useState<string>('W1');
  const [answers, setAnswersState] = useState<Answers>({});
  const [result, setResult] = useState<CompleteOnboardingResponse | null>(null);
  const [problem, setProblem] = useState<CompleteProblem>('unknown');
  /** Short support reference shown with an unexpected failure (owner rule 13:34). */
  const [problemRef, setProblemRef] = useState<string | null>(null);
  /** The last failed intake save: status, machine code and support reference. */
  const lastSaveFailure = useRef<UnexpectedFailure>({ status: null });
  const [consentError, setConsentError] = useState<ConsentError>(null);
  /** B-SHARE-GUEST-127: the coach-sharing sentence on P0 (null: none), sent once on P0 Continue. */
  const [coachSharing, setCoachSharing] = useState<FirstSignInSharing | null>(null);
  const coachSharingRef = useRef<FirstSignInSharing | null>(null);
  const coachSharingSent = useRef(false);
  const [consentNonce, setConsentNonce] = useState(0);
  /** Prototype 42: the screen a resume landed on; Roman greets the client back there. */
  const [welcomeBackId, setWelcomeBackId] = useState<string | null>(null);
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
   * Box 2 (Opus B-310-1 / B-310-2, Sol / Opus B-310-3).
   *   - `aiConfirmed`: the ledger state as last CONFIRMED (a grant or
   *     withdrawal that returned ok, or GET /me/ai-consent); null when
   *     unknown. Persisted in the draft (`aiRoman`).
   *   - `aiWant`: the client's latest explicit choice on P0 that the ledger
   *     has not confirmed yet; null when there is none. Persisted in the
   *     draft (`aiWant`), so it survives a restart.
   *   - `aiHeld`: a wanted grant waits for an intake save that landed box 1
   *     (B-310-1). Withdrawals never wait.
   *   - `aiChain`: one request at a time; each step decides what to send
   *     only when it runs, from the latest `aiWant` and `aiConfirmed`.
   *   - `aiAttempted` (Sol B-310-5): a grant was sent and its answer does
   *     not prove it was not written (lost response, timeout, server error).
   *     It counts as possibly on file: a later "no" is withdrawn with an
   *     idempotent DELETE even though no grant was ever confirmed.
   *     Persisted in the draft (`aiAttempted`).
   *   - A wanted withdrawal stays wanted until a DELETE is confirmed: in the
   *     draft, and under its own per-user key that outlives the draft
   *     (finish, restart), drained by the client app and Settings.
   * P0 shows `aiWant` when there is one, otherwise `aiConfirmed`.
   */
  const aiConfirmed = useRef<boolean | null>(null);
  /** Whether `aiConfirmed` came from the server on this load (not only the draft). */
  const aiFresh = useRef(false);
  const aiWant = useRef<boolean | null>(null);
  const aiAttempted = useRef(false);
  /** The pending-withdrawal marker this flow wrote (cleared only by its own confirmation). */
  const aiPendingStamp = useRef<string | null>(null);
  /** The one in-flight marker write, shared by the toggle and the queued step (C-310-11). */
  const aiPendingMarking = useRef<Promise<string | null> | null>(null);
  /** The explicit box 2 choice that in-flight marker write is for (B-310-8). */
  const aiPendingMarkingSeq = useRef(0);
  /** Counts the client's explicit box 2 choices; a marker step acts only for the latest (B-310-8). */
  const aiChoiceSeq = useRef(0);
  /** Counts loads (and user switches): a step from an earlier load never adopts into this one. */
  const aiLoadEpoch = useRef(0);
  const [aiShown, setAiShown] = useState(false);
  /** R11-C2B: the server's client-ai-v5 copy box 2 shows and grants, or null for the pinned v4 text. */
  const [aiMemory, setAiMemory] = useState<AiConsentUpgradeCopy | null>(null);
  const aiMemoryRef = useRef<AiConsentUpgradeCopy | null>(null);
  /** A wanted withdrawal is not confirmed yet: P0 says so under box 2. */
  const [aiUnconfirmed, setAiUnconfirmed] = useState(false);
  /** Each box 2 notice is shown once per load, however often a retry fails. */
  const aiNoticed = useRef<Set<string>>(new Set());
  /** A withdrawal attempt (with its one retry) ended unconfirmed: the next save that lands tries again. */
  const aiWithdrawRetryDue = useRef(false);
  /** False while nothing is known on this device and GET has not answered (C-310-7). */
  const [aiReady, setAiReady] = useState(false);
  /** C-310-9: the wait for the saved choice ran out with nothing known; P0 says so. */
  const [aiUnknown, setAiUnknown] = useState(false);
  const aiReadyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiHeld = useRef(false);
  const aiRequests = useRef(0);
  const aiChain = useRef<Promise<void>>(Promise.resolve());
  /** The load generation handed off at finish; its queued box 2 steps may still run. */
  const handedOff = useRef<number | null>(null);
  const onSaveOk = useRef<() => void>(() => undefined);
  const lastPersistedId = useRef<string>('W1');
  /** One "Prepare my plan" at a time (Opus C-310-1). */
  const preparing = useRef(false);
  /** P0 Continue is handled once per visit to P0 (Opus C-1 double tap). */
  const p0Handled = useRef(false);
  const now = nowFn();
  // The coach's name: the server's result, else the host's, else the name the
  // coach-sharing notice carries (prototype 03 "Before Bradley builds ...").
  const ctx: CopyContext = {
    firstName,
    coachName: coachless ? null : result?.coach?.display_name ?? coachName ?? coachSharing?.coachName ?? null,
    coachless,
    now,
  };

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
      lastPersistedId.current = id;
      void writeDraft(draft.current, {
        answers: ans,
        screenId: id,
        editedAt: editedAt.current,
        dirty: dirty.current,
        synced: synced.current,
        ...(aiConfirmed.current === null ? {} : { aiRoman: aiConfirmed.current }),
        ...(aiWant.current === null ? {} : { aiWant: aiWant.current }),
        ...(aiAttempted.current ? { aiAttempted: true } : {}),
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
      setWelcomeBackId(null);
      screenRef.current = id;
      setScreenId(id);
      setPhaseBoth('question');
      persistLocal(a, id);
    },
    [nowFn, persistLocal, setAnswers, setPhaseBoth],
  );

  /**
   * Remove the stored P0 and show the agreement unticked. A box 2 grant
   * still waiting on that agreement is dropped with it (the client chooses
   * again); a wanted withdrawal stays, because withdrawing is always allowed.
   */
  const dropConsent = useCallback(
    (error: ConsentError = null) => {
      consentOnServer.current = false;
      p0Handled.current = false;
      if (aiWant.current === true) {
        aiHeld.current = false;
        setAiWant(null);
      }
      const next = { ...answersRef.current };
      delete next.P0;
      setAnswers(next);
      setConsentError(error);
      setConsentNonce((n) => n + 1);
      return next;
    },
    // setAiWant reads refs and setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const run: Promise<SaveOutcome> = q.tail.then(async (): Promise<SaveOutcome> => {
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
          lastSaveFailure.current = {
            status,
            code: machineCodeOf(err),
            requestId: status === null ? null : supportReferenceOf(err),
          };
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
      // B-310-1: a box 2 grant held back by a failed P0 save goes now.
      void run.then((out) => {
        if (out === 'ok' && gen === generation.current) onSaveOk.current();
      }, () => undefined);
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
    aiConfirmed.current = null;
    aiFresh.current = false;
    aiWant.current = null;
    aiAttempted.current = false;
    aiPendingStamp.current = null;
    aiPendingMarking.current = null;
    aiLoadEpoch.current += 1;
    aiNoticed.current = new Set();
    aiWithdrawRetryDue.current = false;
    setAiShown(false);
    setAiUnconfirmed(false);
    setAiReady(false);
    setAiUnknown(false);
    aiHeld.current = false;
    aiRequests.current = 0;
    aiChain.current = Promise.resolve();
    handedOff.current = null;
    preparing.current = false;
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
      // B-310-2 / B-310-3: box 2 starts from the last confirmed ledger state
      // and the client's last unconfirmed choice on this device, then from
      // the ledger itself when it answers.
      aiConfirmed.current = aiRomanOf(local);
      aiWant.current = aiWantOf(local);
      aiAttempted.current = aiAttemptedOf(local);
      // A withdrawal that outlived the draft (or its last write) is still
      // wanted, unless the draft holds a newer choice (Sol B-310-5).
      // Read in marker order: a write or clear still in flight from an earlier
      // screen of this app lands first (B-310-8).
      const pending = await runAiMarkerStep(() => readAiWithdrawalPending(userId));
      if (!live()) return;
      if (pending && aiWant.current === null) {
        aiWant.current = false;
        aiAttempted.current = true;
      }
      if (pending && aiWant.current === false) aiPendingStamp.current = pending;
      // The draft's newer yes supersedes an older pending no.
      if (pending && aiWant.current === true) {
        const seq = aiChoiceSeq.current;
        const epoch = aiLoadEpoch.current;
        void runAiMarkerStep(async () => {
          // Only while that yes is still the latest choice of this load.
          if (aiLoadEpoch.current === epoch && aiChoiceSeq.current === seq && aiWant.current === true) {
            await clearAiWithdrawalPending(userId);
          }
        });
      }
      // A wanted grant waits for a save that lands box 1, except after
      // completion, which the server grants only with box 1 on file.
      const completed = !!(server?.completed && server.result);
      aiHeld.current = aiWant.current === true && !completed;
      showAi();
      // Box 2 is tappable at once when this device knows something (C-310-7).
      if (aiConfirmed.current !== null || aiWant.current !== null) markAiReady();
      else
        aiReadyTimer.current = setTimeout(() => {
          markAiReady();
          // C-310-9: still nothing known (no draft value, no ledger answer):
          // disclose it rather than imply an unticked box is the saved state.
          if (aiConfirmed.current === null && aiWant.current === null) setAiUnknown(true);
        }, AI_STATUS_WAIT_MS);
      if (aiWant.current !== null) reconcileAi(gen);
      void refreshAiFromLedger(gen);
      if (completed && server?.result) {
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
        if (id !== 'W1' && id !== 'P0' && hasAnswersBeyondConsent(ans)) setWelcomeBackId(id);
      }
    })();
    return () => {
      generation.current += 1;
      queue.current.closed = true;
      clearTimer();
      if (aiReadyTimer.current) clearTimeout(aiReadyTimer.current);
      aiReadyTimer.current = null;
    };
    // Load once per user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Consent (P0) ───────────────────────────────────────────────────────
  /** Box 2 on P0: the latest unconfirmed choice, else the confirmed state. */
  function showAi() {
    setAiShown(aiWant.current ?? aiConfirmed.current === true);
    if (aiConfirmed.current !== null || aiWant.current !== null) setAiUnknown(false);
    setAiUnconfirmed(aiWant.current === false && (aiConfirmed.current === true || aiAttempted.current));
  }

  function noticeOnce(key: string, notice: { title: string; body: string }) {
    if (aiNoticed.current.has(key)) return;
    aiNoticed.current.add(key);
    Alert.alert(notice.title, notice.body);
  }

  function markAiReady() {
    if (aiReadyTimer.current) clearTimeout(aiReadyTimer.current);
    aiReadyTimer.current = null;
    setAiReady(true);
  }

  /** Keep box 2 in the draft while there is one (never after completion). */
  function persistAi() {
    const p = phaseRef.current;
    if (p !== 'loading' && p !== 'macro' && p !== 'plan') persistLocal(answersRef.current, lastPersistedId.current);
  }

  /**
   * Record a confirmed ledger state (B-310-2); a choice it satisfies is done.
   * A read never settles a wanted withdrawal while a grant was attempted
   * without an answer: only a confirmed DELETE does (B-310-5).
   */
  function setAiConfirmed(v: boolean, fromRead = false) {
    aiConfirmed.current = v;
    aiFresh.current = true;
    if (aiWant.current === v && !(fromRead && v === false && aiAttempted.current)) aiWant.current = null;
    showAi();
    persistAi();
  }

  function setAiWant(v: boolean | null) {
    aiWant.current = v;
    showAi();
    persistAi();
  }

  /**
   * Box 2 steps run for the load they started in. After the hand-off at
   * finish the flow unmounts, but steps already queued still run while the
   * same user is signed in, so a choice made just before finishing is not
   * lost; a different or signed-out user stops them.
   */
  function aiLive(gen: number): boolean {
    if (gen === generation.current) return true;
    if (handedOff.current !== gen || !userId) return false;
    return api.sessionUserId?.() === userId;
  }

  /**
   * GET /me/ai-consent once per load, never blocking. Applied only while no
   * grant or withdrawal has been sent this session, so a slow read can never
   * overwrite a newer confirmed result; then reconciled with the client's
   * latest choice (a late grant against an unticked choice is withdrawn,
   * B-310-3). 404 / 503 / errors keep the draft value.
   */
  async function refreshAiFromLedger(gen: number) {
    try {
      const out = await api.getRomanConsent();
      if (!aiLive(gen)) return;
      if (aiRequests.current === 0 && out.kind === 'ok' && out.status) {
        aiMemoryRef.current = romanBox2MemoryCopyOf(out.status);
        setAiMemory(aiMemoryRef.current);
        setAiConfirmed(isLiveRomanGrant(out.status), true);
        reconcileAi(gen);
      }
    } catch {
      // Unknown: keep the draft value.
    } finally {
      if (gen === generation.current) markAiReady();
    }
  }

  /**
   * Queue one reconcile step (B-310-3, B-310-5). The step decides when it
   * runs, after every earlier request settled:
   *   - yes, not confirmed granted, box 1 landed: grant. The retry goes out
   *     only while yes is still the latest choice. A grant whose answer is
   *     ambiguous counts as possibly on file (`aiAttempted`).
   *   - no, and the ledger is confirmed granted OR a grant was attempted
   *     without a confirmed answer: withdraw (idempotent DELETE). The
   *     withdrawal stays wanted until a DELETE is confirmed (draft plus a
   *     per-user marker that outlives finish and restarts).
   *   - otherwise nothing.
   * A grant the ledger refused is dropped, so box 2 falls back to the
   * confirmed state, with a calm notice (B-310-2, C-310-6). A grant with an
   * ambiguous answer stays chosen (box 2 ticked) with a "not confirmed"
   * notice, because it may be on file.
   */
  function reconcileAi(gen: number) {
    aiChain.current = aiChain.current
      .then(async () => {
        if (!aiLive(gen)) return;
        const want = aiWant.current;
        const have = aiConfirmed.current;
        if (want === null) return;
        if (want === have && !(want === false && aiAttempted.current)) {
          // Matches what the server said on this load: done. Matches only
          // the draft: kept until the server answers, so a grant made
          // elsewhere that a slow GET reports is still withdrawn (B-310-3).
          if (aiFresh.current) setAiWant(null);
          return;
        }
        if (want) {
          if (aiHeld.current) return; // sent by onSaveOk once box 1 lands
          aiRequests.current += 1;
          // Possibly on file from the moment it is sent (B-310-5).
          aiAttempted.current = true;
          persistAi();
          // Each attempt, the retry included, needs the same signed-in user
          // and yes still being the latest choice (B-310-5).
          const result = await runAiLedgerWrite(() =>
            grantRomanWithRetry(
              api.grantRomanConsent,
              () => aiLive(gen) && aiWant.current === true,
              () => romanGrantBody(aiMemoryRef.current),
            ),
          );
          if (!aiLive(gen)) return;
          if (result === 'granted') {
            aiAttempted.current = false;
            setAiConfirmed(true);
            return;
          }
          if (result !== 'unconfirmed') aiAttempted.current = false;
          if (aiWant.current !== true) {
            // A newer "no" is queued behind this step; it withdraws whatever this grant left.
            showAi();
            persistAi();
            return;
          }
          if (result === 'unconfirmed') {
            // May be on file: box 2 keeps showing the client's yes (never an
            // unticked box over a live grant), the next launch tries again,
            // and a later untick withdraws it.
            showAi();
            persistAi();
            logger.warn('ConsultationFlow', 'optional AI choice not confirmed; kept as chosen');
            noticeOnce('grant-unconfirmed', AI_GRANT_UNCONFIRMED_NOTICE);
            return;
          }
          setAiWant(null);
          if (result === 'unavailable') return; // ledger off: skipped silently
          logger.warn('ConsultationFlow', `optional AI choice not recorded (${result}); left for Settings`);
          noticeOnce('grant', AI_GRANT_NOTICE);
          return;
        }
        // No: nothing can be on file (no confirmed grant, no grant attempted
        // without an answer). The choice stays, so a grant that a later GET
        // reports is still withdrawn.
        if (have !== true && !aiAttempted.current) return;
        aiRequests.current += 1;
        await markAiPendingOnce();
        if (!aiLive(gen)) return;
        aiWithdrawRetryDue.current = false;
        const result = await runAiLedgerWrite(() =>
          withdrawRomanWithRetry(api.withdrawRomanConsent, () => aiLive(gen) && aiWant.current === false),
        );
        if (!aiLive(gen)) return;
        if (result === 'withdrawn') {
          aiAttempted.current = false;
          const stamp = aiPendingStamp.current;
          aiPendingStamp.current = null;
          // Compare-and-clear in marker order: a newer marker is never removed.
          await runAiMarkerStep(() => clearAiWithdrawalPending(userId, stamp));
          setAiConfirmed(false);
          return;
        }
        if (aiWant.current !== false) return; // a newer "yes" took over
        // Not confirmed: the withdrawal stays wanted (draft and marker) and
        // is retried on the next save, the next launch, and in Settings.
        aiWithdrawRetryDue.current = true;
        showAi();
        persistAi();
        logger.warn('ConsultationFlow', 'optional AI withdrawal not confirmed; kept pending');
        noticeOnce('withdraw', AI_WITHDRAW_NOTICE);
      })
      .catch(() => undefined);
  }

  // A held grant goes after the next save that lands the agreement (B-310-1).
  // A withdrawal that is still not confirmed is retried after each save that
  // lands, when the connection is evidently back (B-310-5).
  onSaveOk.current = () => {
    if (aiHeld.current) {
      aiHeld.current = false;
      reconcileAi(generation.current);
      return;
    }
    // Only after an attempt ended unconfirmed, so a save that lands while
    // the first attempt is still out never doubles it.
    if (aiWithdrawRetryDue.current && aiWant.current === false) {
      aiWithdrawRetryDue.current = false;
      reconcileAi(generation.current);
    }
  };

  /**
   * Box 2 at P0 Continue. Never awaited by the flow, never required.
   * `choice` is the client's explicit choice on this visit (null: box 2 left
   * as shown, nothing new).
   *   - yes: kept as the latest choice; the grant waits for an intake save
   *     that lands box 1 (B-310-1). A rejected agreement (back to P0) drops
   *     it in dropConsent: the client chooses again.
   *   - no: kept as the latest choice and reconciled at once; if a grant is
   *     in flight or a GET is still out, the withdrawal follows it (B-310-3).
   * Called after the P0 save is queued, so a rejection of that save always
   * comes after this.
   */
  /**
   * Write this user's pending-withdrawal marker once (C-310-11): the toggle
   * handler and the queued step share one in-flight write, so there is never
   * a second stamp that the stamp-scoped clear would leave behind.
   */
  function markAiPendingOnce(): Promise<string | null> {
    if (aiPendingStamp.current) return Promise.resolve(aiPendingStamp.current);
    const seq = aiChoiceSeq.current;
    const epoch = aiLoadEpoch.current;
    if (aiPendingMarking.current && aiPendingMarkingSeq.current === seq) return aiPendingMarking.current;
    const uid = userId;
    const marking: Promise<string | null> = runAiMarkerStep(async () => {
      const sameLoad = aiLoadEpoch.current === epoch;
      // B-310-8: a newer yes of this load took over; its clear follows in
      // marker order, so writing now would only be removed again.
      if (sameLoad && aiChoiceSeq.current !== seq && aiWant.current !== false) return null;
      // A marker for the latest no is already on disk.
      if (sameLoad && aiPendingStamp.current) return aiPendingStamp.current;
      const stamp = await markAiWithdrawalPending(uid);
      if (stamp && aiLoadEpoch.current === epoch && aiWant.current === false && !aiPendingStamp.current) {
        aiPendingStamp.current = stamp;
      }
      return aiLoadEpoch.current === epoch ? aiPendingStamp.current : stamp;
    }).finally(() => {
      if (aiPendingMarking.current === marking) aiPendingMarking.current = null;
    });
    aiPendingMarking.current = marking;
    aiPendingMarkingSeq.current = seq;
    return marking;
  }

  const recordAiChoice = useCallback(
    (choice: boolean | null) => {
      if (choice === null) return;
      aiHeld.current = choice;
      const seq = ++aiChoiceSeq.current;
      if (choice) {
        // A newer yes supersedes any withdrawal still pending from earlier.
        // The clear runs in marker order, after any write still in flight,
        // and only while this yes is still the latest choice (B-310-8): a
        // newer no keeps its durable marker until its DELETE is confirmed.
        aiPendingStamp.current = null;
        const epoch = aiLoadEpoch.current;
        const uid = userId;
        void runAiMarkerStep(async () => {
          if (aiLoadEpoch.current === epoch && aiChoiceSeq.current !== seq) return;
          await clearAiWithdrawalPending(uid);
        });
      } else if (aiConfirmed.current === true || aiAttempted.current) {
        // Something may be on file: keep the "no" beyond this draft at once,
        // so finishing or closing the app before the DELETE runs cannot lose it.
        void markAiPendingOnce();
      }
      setAiWant(choice);
      if (!choice) reconcileAi(generation.current);
    },
    // The helpers it calls read refs and these props only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, userId],
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
    (patch?: Answers, aiChoice: boolean | null = null) => {
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
        void enqueueSave(ans);
        // Box 2: optional, recorded after the P0 save, never blocking.
        recordAiChoice(aiChoice);
        // Coach sharing: P0 printed the sentence above this Continue.
        const sharing = coachSharingRef.current;
        if (sharing && !coachSharingSent.current && api.acceptCoachSharingNotice) {
          coachSharingSent.current = true;
          void api.acceptCoachSharingNotice(sharing.version);
        }
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
    [api, clearTimer, enqueueSave, goNext, persistLocal, recordAiChoice, setAnswers],
  );

  // B-SHARE-GUEST-127: one read per mount; a failed read shows nothing.
  useEffect(() => {
    const read = api.getCoachSharingNotice;
    if (!read) return undefined;
    let live = true;
    void read().then((n) => {
      if (!live) return;
      coachSharingRef.current = n;
      setCoachSharing(n);
    });
    return () => {
      live = false;
    };
  }, [api]);

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
  const prepareOnce = useCallback(async () => {
    const gen = generation.current;
    const live = () => gen === generation.current;
    const started = Date.now();
    setPhaseBoth('preparing');
    const hold = async () => {
      const left = prepMinMs - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    };
    const fail = async (p: CompleteProblem, unexpected?: { where: string } & UnexpectedFailure) => {
      // Owner rule 13:34: an unexpected failure is reported and shows a short reference.
      if (unexpected) reportUnexpected(unexpected.where, unexpected);
      await hold();
      if (!live()) return;
      queue.current.closed = false;
      setProblemRef(shortReference(unexpected?.requestId));
      setProblem(p);
      setPhaseBoth('problem');
    };
    const savedFailure = (out: SaveOutcome) => {
      if (out === 'consent') return fail('consent_missing');
      if (out === 'version') return fail('consent_version_mismatch');
      if (out === 'busy') return fail('completion_in_progress');
      const f = lastSaveFailure.current;
      if (out === 'invalid') return fail('invalid_answers', { where: 'PUT /me/onboarding/consultation', ...f });
      // No response at all: the connection. A response we do not expect: our side.
      if (f.status === null) return fail('network');
      return fail('unknown', { where: 'PUT /me/onboarding/consultation', ...f });
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
    if (outcome.kind === 'conflict') {
      // B14 (owner decision 28): every client finishes the consultation, with
      // or without a coach. Only a server from before that rule answers
      // not_attached / clinic_not_configured; that is the server's problem,
      // not the client's, so it gets the calm server state (prototype 44:
      // answers safe, Try again, support) and is reported, never the old
      // "a coach link is needed" dead end.
      if (outcome.code === 'not_attached' || outcome.code === 'clinic_not_configured') {
        return fail('unknown', { where: 'POST /me/onboarding/complete', status: 409, code: outcome.code, requestId: outcome.requestId });
      }
      if (outcome.code !== 'unknown') return fail(outcome.code);
      return fail('unknown', { where: 'POST /me/onboarding/complete', status: 409, code: 'unknown', requestId: outcome.requestId });
    }
    if (outcome.status === null) return fail('network');
    return fail('unknown', { where: 'POST /me/onboarding/complete', status: outcome.status, requestId: outcome.requestId });
  }, [api, consentCurrent, dropConsent, enqueueSave, prepMinMs, setPhaseBoth]);

  const prepare = useCallback(async () => {
    if (preparing.current) return; // C-310-1: a second tap never completes twice
    preparing.current = true;
    try {
      await prepareOnce();
    } finally {
      preparing.current = false;
    }
  }, [prepareOnce]);

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
    // Box 2 steps already queued still run after the flow unmounts (same user only).
    handedOff.current = generation.current;
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
      return (
        <CompleteProblemScreen
          problem={problem}
          reference={problemRef}
          onAction={onProblemAction}
          onBack={() => setPhaseBoth('summary')}
          onSignOut={onSignOut}
        />
      );
    }
    if (phase === 'paused') {
      return (
        <PausedScreen
          ctx={ctx}
          onResume={() => {
            const id = screenRef.current;
            showScreen(id);
            if (id !== 'W1' && id !== 'P0') setWelcomeBackId(id);
          }}
          onSignOut={onSignOut}
        />
      );
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
        romanOverride={welcomeBackId === screen.id ? welcomeBackLine(screen.chapter) : null}
        consent={{ error: consentError, aiAllowed: aiShown, aiReady, aiUnconfirmed, aiUnknown, aiMemory, coachSharing }}
      />
    );
  }
}
