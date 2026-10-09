/**
 * The coach consultation (prototype 77-86): the ONLY onboarding for a new
 * coach. Owns order (lib/coachConsultation/flow), the local draft and server
 * draft, Finish later, and completion; each step renders from the registry.
 * Money (Get paid, first package, invite) is never asked here: those stay as
 * optional next steps on the Overview checklist after the coach lands (B02).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, StyleSheet, View } from 'react-native';
import { Screen } from '../../../ui/layout/Screen';
import { PrimaryButton, TextLink } from '../../../ui/buttons/PrimaryButton';
import { Headline, Lede } from '../../../ui/text/Headline';
import { useTheme } from '../../../theme/ThemeProvider';
import { spacing } from '../../../theme/tokens';
import { RomanLine } from '../../consultation/components';
import { describeError, type FriendlyError } from '../../../lib/coachSetup/errors';
import { eyebrowFor, firstNameOf, isStepVisible, missingRequired, nextStep, previousStep } from '../../../lib/coachConsultation/flow';
import { progressFor, resumeStep, stepForMissing, type FlowContext } from '../../../lib/coachConsultation/flow';
import { purgeDraft, readDraft, writeDraft } from '../../../lib/coachConsultation/draft';
import { coachConsultApi, type CoachConsultApi } from '../../../lib/coachConsultation/api';
import type { CoachConsultAnswers, CoachStepId } from '../../../lib/coachConsultation/types';
import { STEP_COMPONENTS, type StepRegistry } from './registry';

export interface CoachConsultationFlowProps {
  userId: string;
  user: { firstName?: string; name?: string } | null;
  /** Called once the server has the consultation and the coach app gate reads complete. */
  onComplete: () => void;
  onSignOut?: () => void;
  api?: CoachConsultApi;
  steps?: StepRegistry;
  importOn?: boolean;
}

type Phase = 'loading' | 'step' | 'paused' | 'saving' | 'problem';
type SaveJob = { a: CoachConsultAnswers; s: CoachStepId; r: number };

const DRAFT_DEBOUNCE_MS = 300;

export default function CoachConsultationFlow(props: CoachConsultationFlowProps) {
  const { userId, user, onComplete, onSignOut, api = coachConsultApi, steps = STEP_COMPONENTS, importOn = false } = props;
  const { semanticColors: sc } = useTheme();
  const ctx: FlowContext = useMemo(() => ({ built: new Set(Object.keys(steps) as CoachStepId[]), importOn }), [steps, importOn]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [step, setStep] = useState<CoachStepId>('K0');
  const [answers, setAnswersState] = useState<CoachConsultAnswers>({});
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [completing, setCompleting] = useState(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const busy = useRef(false);
  const done = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  // Draft sync (B-621-B2-1): `rev` counts local changes, `acked` is the newest one
  // the server stored. Saves go one at a time, latest last, so an older snapshot
  // never lands after a newer one; an unsynced phone draft always wins on resume.
  const rev = useRef(0);
  const acked = useRef(-1);
  const sync = useRef<{ busy: boolean; next: SaveJob | null }>({ busy: false, next: null });

  // Resume: an unsynced phone draft, else the server draft, else the synced phone
  // draft; a fresh start is prefilled from the server (sign-up name) or the cached user.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [local, server] = await Promise.all([readDraft(userId), api.load()]);
      if (!alive) return;
      const serverDraft = server && server.status !== 'not_started' ? server : null;
      const winner = local && (!local.synced || !serverDraft) ? local : serverDraft;
      const a: CoachConsultAnswers = { ...(winner?.answers ?? server?.answers ?? {}) };
      if (a.display_name === undefined && user?.name) a.display_name = user.name.trim();
      acked.current = winner && (winner === serverDraft || local?.synced) ? 0 : -1;
      setAnswersState(a);
      setStep(resumeStep(winner?.step ?? null, a, ctx));
      setPhase('step');
    })();
    return () => {
      alive = false;
    };
    // Load once per user; later answer edits must not re-run the resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const saveLocal = useCallback(() => {
    if (!done.current) void writeDraft(userId, answersRef.current, stepRef.current, acked.current === rev.current);
  }, [userId]);

  const pushDraft = useCallback(
    async (s: CoachStepId) => {
      sync.current.next = { a: answersRef.current, s, r: rev.current };
      if (sync.current.busy) return;
      sync.current.busy = true;
      for (let job: SaveJob | null = sync.current.next; job; job = sync.current.next) {
        sync.current.next = null;
        if ((await api.saveDraft(job.a, job.s)) === 'saved') acked.current = Math.max(acked.current, job.r);
      }
      sync.current.busy = false;
      saveLocal();
    },
    [api, saveLocal],
  );

  // Local draft on every answer or step change (debounced).
  useEffect(() => {
    if (phase === 'loading' || done.current) return;
    const t = setTimeout(saveLocal, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [answers, step, phase, saveLocal]);

  // The ref updates at once so a step that sets an answer and moves on in one
  // tap (Skip) completes with that answer.
  const setAnswers = useCallback((patch: Partial<CoachConsultAnswers>) => {
    rev.current += 1;
    answersRef.current = { ...answersRef.current, ...patch };
    setAnswersState(answersRef.current);
  }, []);

  const goTo = useCallback(
    (id: CoachStepId) => {
      rev.current += 1;
      setStep(id);
      setPhase('step');
      void pushDraft(id);
    },
    [pushDraft],
  );

  const complete = useCallback(async () => {
    if (busy.current) return;
    const a = answersRef.current;
    const missing = missingRequired(a);
    if (missing.length) {
      // Ask the missing answer where it lives (only a step this build renders).
      const target = stepForMissing(missing[0]);
      if (isStepVisible(target, a, ctx)) goTo(target);
      return;
    }
    busy.current = true;
    setCompleting(true);
    setProblem(null);
    if (step !== 'K8') setPhase('saving');
    try {
      await api.complete(a);
      done.current = true;
      await purgeDraft(userId);
      onComplete();
    } catch (err) {
      setProblem(describeError(err, 'save your practice'));
      setPhase('problem');
    } finally {
      busy.current = false;
      setCompleting(false);
    }
  }, [api, ctx, goTo, onComplete, step, userId]);

  const onNext = useCallback(() => {
    const next = nextStep(step, answersRef.current, ctx);
    if (next) goTo(next);
    else void complete();
  }, [complete, ctx, goTo, step]);

  const prev = previousStep(step, answers, ctx);
  const onBack = useMemo(() => (prev ? () => goTo(prev) : null), [goTo, prev]);
  // Android back steps back (like the client consultation); on K0 the system takes it (B-621-1).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'paused' || phase === 'problem') setPhase('step');
      else if (phase === 'step' && onBack) onBack();
      else return phase === 'saving';
      return true;
    });
    return () => sub.remove();
  }, [onBack, phase]);

  const onFinishLater = useCallback(() => {
    saveLocal();
    void pushDraft(step);
    setPhase('paused');
  }, [pushDraft, saveLocal, step]);

  if (phase === 'loading' || phase === 'saving') {
    return (
      <View style={[styles.center, { backgroundColor: sc.bgPrimary }]} testID={`coach-consult-${phase}`}>
        <ActivityIndicator color={sc.accent} accessibilityLabel={phase === 'loading' ? 'Loading your practice setup' : 'Saving your practice'} />
      </View>
    );
  }

  if (phase === 'paused') {
    const confirmSignOut = () =>
      Alert.alert('Sign out?', 'Your answers stay on this phone for when you sign back in.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: onSignOut },
      ]);
    return (
      <Rest id="paused" title="Your place is kept." action="Continue setting up" onAction={() => setPhase('step')}
        link={onSignOut ? { label: 'Sign out', onPress: confirmSignOut } : undefined}>
        <RomanLine text="Whenever you're ready, pick up exactly where you left off. It takes about two minutes." />
      </Rest>
    );
  }

  if (phase === 'problem' && problem) {
    return (
      <Rest id="problem" title={problem.title} action="Try again" onAction={() => void complete()}
        link={{ label: 'Back', onPress: () => setPhase('step') }}>
        <Lede style={styles.lede}>{`${problem.body} Your answers are kept on this phone.`}</Lede>
      </Rest>
    );
  }

  const Step = steps[step];
  if (!Step) return null;
  const progress = progressFor(step, answers, ctx);
  return (
    <Step
      answers={answers}
      setAnswers={setAnswers}
      onNext={onNext}
      onBack={onBack}
      onFinishLater={onFinishLater}
      progress={progress}
      eyebrow={eyebrowFor(progress)}
      firstName={firstNameOf(user)}
      completing={completing}
    />
  );
}

/** Paused and problem screens: serif title, a line, one forest button, one quiet link. */
type RestProps = { id: 'paused' | 'problem'; title: string; action: string; onAction: () => void; children: React.ReactNode };
function Rest(props: RestProps & { link?: { label: string; onPress: () => void } }) {
  const { id, title, action, onAction, link, children } = props;
  const footer = (
    <>
      <PrimaryButton label={action} onPress={onAction} testID={id === 'paused' ? 'coach-consult-resume' : 'coach-consult-retry'} />
      {link ? <TextLink label={link.label} onPress={link.onPress} testID={`coach-consult-${id}-link`} /> : null}
    </>
  );
  return (
    <Screen testID={`coach-consult-${id}`} footer={footer}>
      <Headline level="h1" style={styles.top}>
        {title}
      </Headline>
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { marginTop: spacing['3xl'] },
  lede: { marginTop: spacing.lg },
});
