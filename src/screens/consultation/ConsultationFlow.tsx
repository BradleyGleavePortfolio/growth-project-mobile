/**
 * ConsultationFlow: the config-driven consultation onboarding.
 *
 * One component owns the flow state (answers, current screen, phase) and
 * renders each screen from its data definition. Navigation, validation and
 * resume rules live in the pure engine (`lib/consultation/engine.ts`).
 *
 * Persistence:
 *   - every answer is written to local storage (resume on the same screen);
 *   - every chapter end saves the full answer set with
 *     PUT /me/onboarding/consultation (idempotent);
 *   - ticking the P0 box records the combined consent;
 *   - "Prepare my plan" saves once more, then POST /me/onboarding/complete.
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
  lastScreenOfChapter,
  nextScreenId,
  previousScreenId,
  resumeScreenId,
} from '../../lib/consultation/engine';
import { consentCopyText, ROMAN_AI_CONSENT_VERSION } from '../../lib/consultation/copy';
import { readLocalState, writeLocalState, clearLocalState } from '../../lib/consultation/storage';
import type { AnswerValue, Answers, ChapterId } from '../../lib/consultation/types';
import { logger } from '../../utils/logger';
import QuestionScreen from './QuestionScreen';
import { palette, STEP_MS } from './components';
import {
  CompleteProblem,
  CompleteProblemScreen,
  MacroRevealScreen,
  PausedScreen,
  PlanRevealScreen,
  SummaryScreen,
} from './RevealScreens';

export type ConsultationApi = Pick<typeof defaultApi, 'save' | 'getState' | 'complete' | 'grantConsent'>;

export interface ConsultationFlowProps {
  userId: string | null;
  firstName?: string | null;
  coachName?: string | null;
  /** Called after "Show me around" on the plan reveal. */
  onFinished: (result: CompleteOnboardingResponse) => void;
  api?: ConsultationApi;
  /** Send the P0 grant to the consent record endpoint. */
  recordConsent?: boolean;
  now?: () => Date;
  autoAdvanceMs?: number;
  /** Minimum time the preparing state stays up, so it never flashes. */
  prepMinMs?: number;
}

type Phase = 'loading' | 'question' | 'summary' | 'preparing' | 'macro' | 'plan' | 'paused' | 'problem';

export default function ConsultationFlow({
  userId,
  firstName,
  coachName,
  onFinished,
  api = defaultApi,
  recordConsent = true,
  now: nowFn = () => new Date(),
  autoAdvanceMs = STEP_MS,
  prepMinMs = 900,
}: ConsultationFlowProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [screenId, setScreenId] = useState<string>('W1');
  const [answers, setAnswersState] = useState<Answers>({});
  const [result, setResult] = useState<CompleteOnboardingResponse | null>(null);
  const [problem, setProblem] = useState<CompleteProblem>('unknown');
  const [editChapter, setEditChapter] = useState<ChapterId | null>(null);
  const answersRef = useRef<Answers>({});
  const screenRef = useRef<string>('W1');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const now = nowFn();
  const ctx: CopyContext = { firstName, coachName: result?.coach?.display_name ?? coachName, now };

  const persistLocal = useCallback(
    (ans: Answers, id: string) => {
      void writeLocalState(userId, { answers: ans, screenId: id });
    },
    [userId],
  );

  const setAnswers = useCallback((next: Answers) => {
    answersRef.current = next;
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
      setPhase('question');
      persistLocal(a, id);
    },
    [nowFn, persistLocal, setAnswers],
  );

  const saveToServer = useCallback(
    async (ans: Answers): Promise<boolean> => {
      try {
        await api.save({ version: CONSULTATION_VERSION, answers: answersForSave(ans) });
        return true;
      } catch (err) {
        logger.warn('ConsultationFlow', 'chapter save failed; kept locally', err);
        return false;
      }
    },
    [api],
  );

  const grantConsent = useCallback(async (): Promise<boolean> => {
    try {
      const sha = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, consentCopyText());
      await api.grantConsent({
        version: ROMAN_AI_CONSENT_VERSION,
        copy_sha256: /^[a-f0-9]{64}$/i.test(sha) ? sha : undefined,
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      });
      return true;
    } catch (err) {
      logger.warn('ConsultationFlow', 'consent record failed; will retry at completion', err);
      return false;
    }
  }, [api]);

  // ── Load and resume ────────────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    (async () => {
      const local = await readLocalState(userId);
      let server = null;
      try {
        server = await api.getState();
      } catch (err) {
        logger.warn('ConsultationFlow', 'GET /me/onboarding failed; using local state', err);
      }
      if (!mounted.current) return;
      if (server?.completed && server.result) {
        const ans = (server.answers ?? local?.answers ?? {}) as Answers;
        setAnswers(ans);
        setResult(server.result);
        setPhase('macro');
        return;
      }
      const ans = (local?.answers && Object.keys(local.answers).length ? local.answers : server?.answers ?? {}) as Answers;
      setAnswers(ans);
      const id = resumeScreenId(local?.screenId, ans, nowFn());
      if (id === 'SUM') {
        setPhase('summary');
      } else {
        showScreen(id, ans);
      }
    })();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // Load once per user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Navigation ─────────────────────────────────────────────────────────
  const goNext = useCallback(
    (fromId: string, ans: Answers) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (fromId !== screenRef.current) return; // a stale auto-advance
      if (fromId === 'P0' && recordConsent) void grantConsent();
      const def = screenById(fromId);
      if (def && def.chapter > 0 && endsChapter(fromId, ans)) void saveToServer(ans);

      if (editChapter !== null && def && lastScreenOfChapter(editChapter, ans) === fromId) {
        setEditChapter(null);
        persistLocal(ans, 'SUM');
        setPhase('summary');
        return;
      }
      const next = nextScreenId(fromId, ans);
      if (!next) {
        persistLocal(ans, 'SUM');
        setPhase('summary');
        return;
      }
      showScreen(next, ans);
    },
    [editChapter, grantConsent, persistLocal, recordConsent, saveToServer, showScreen],
  );

  const onAnswer = useCallback(
    (key: string, value: AnswerValue | undefined, opts?: { advance?: boolean }) => {
      const next = { ...answersRef.current, [key]: value };
      if (value === undefined) delete next[key];
      setAnswers(next);
      persistLocal(next, screenRef.current);
      if (opts?.advance) {
        const from = screenRef.current;
        if (timer.current) clearTimeout(timer.current);
        if (autoAdvanceMs <= 0) goNext(from, next);
        else timer.current = setTimeout(() => goNext(from, answersRef.current), autoAdvanceMs);
      }
    },
    [autoAdvanceMs, goNext, persistLocal, setAnswers],
  );

  const onNext = useCallback(
    (patch?: Answers) => {
      let ans = answersRef.current;
      if (patch) {
        ans = { ...ans, ...patch };
        setAnswers(ans);
      }
      goNext(screenRef.current, ans);
    },
    [goNext, setAnswers],
  );

  const onBack = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (phase === 'summary' || phase === 'problem') {
      const ans = answersRef.current;
      const last = lastScreenOfChapter(8, ans) ?? 'C1';
      showScreen(last, ans);
      return true;
    }
    if (phase === 'plan') {
      setPhase('macro');
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
  }, [phase, showScreen]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => onBack());
    return () => sub.remove();
  }, [onBack]);

  const onFinishLater = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const ans = answersRef.current;
    persistLocal(ans, screenRef.current);
    void saveToServer(ans);
    setPhase('paused');
  }, [persistLocal, saveToServer]);

  // ── Completion ─────────────────────────────────────────────────────────
  const prepare = useCallback(async () => {
    const started = Date.now();
    setPhase('preparing');
    const ans = answersRef.current;
    const hold = async () => {
      const left = prepMinMs - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    };

    const saved = await saveToServer(ans);
    if (!saved) {
      await hold();
      if (!mounted.current) return;
      setProblem('network');
      setPhase('problem');
      return;
    }
    let outcome = await api.complete();
    if (outcome.kind === 'conflict' && outcome.code === 'consent_missing' && ans.P0) {
      // The P0 grant may not have reached the server yet: record it and retry once.
      if (await grantConsent()) outcome = await api.complete();
    }
    await hold();
    if (!mounted.current) return;
    if (outcome.kind === 'ok') {
      setResult(outcome.data);
      setPhase('macro');
      return;
    }
    if (outcome.kind === 'conflict') {
      setProblem(outcome.code === 'unknown' ? 'unknown' : outcome.code);
    } else {
      setProblem(outcome.status === null ? 'network' : 'unknown');
    }
    setPhase('problem');
  }, [api, grantConsent, prepMinMs, saveToServer]);

  const onProblemAction = useCallback(() => {
    const ans = answersRef.current;
    if (problem === 'consent_missing') {
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
    void clearLocalState(userId);
    onFinished(result);
  }, [onFinished, result, userId]);

  // ── Render ─────────────────────────────────────────────────────────────
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
          setEditChapter(ch);
          showScreen(firstScreenOfChapter(ch, answersRef.current) ?? 'W1');
        }}
      />
    );
  }
  if (phase === 'problem') {
    return <CompleteProblemScreen problem={problem} onAction={onProblemAction} onBack={() => setPhase('summary')} />;
  }
  if (phase === 'paused') {
    return <PausedScreen ctx={ctx} onResume={() => showScreen(screenRef.current)} />;
  }
  if (phase === 'macro' && result) {
    return <MacroRevealScreen result={result} answers={answers} ctx={ctx} onNext={() => setPhase('plan')} />;
  }
  if (phase === 'plan' && result) {
    return <PlanRevealScreen result={result} answers={answers} ctx={ctx} now={now} onBack={() => setPhase('macro')} onFinish={finish} />;
  }

  const screen = screenById(screenId) ?? screenById('W1')!;
  const progress = screen.chapter === 0 ? null : chapterProgress(screen.id, answers);
  const prev = previousScreenId(screen.id, answers);
  return (
    <QuestionScreen
      key={screen.id}
      screen={screen}
      answers={answers}
      progress={progress}
      ctx={ctx}
      now={now}
      onAnswer={onAnswer}
      onNext={onNext}
      onBack={prev ? () => void onBack() : null}
      onFinishLater={screen.chapter === 0 ? null : onFinishLater}
    />
  );
}
