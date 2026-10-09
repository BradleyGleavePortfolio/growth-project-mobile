/**
 * Consultation end states: summary, preparing, macro reveal, plan reveal,
 * paused, and the calm completion-problem state. Numbers and the program
 * come only from the server (POST /me/onboarding/complete); nothing here
 * computes macros on the device.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HapticService } from '../../ui/haptics/haptics.service';
import RomanAvatar from '../../components/roman/RomanAvatar';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { radius, SERIF_MIN_LINE_RATIO } from '../../theme/tokens';
import { Headline } from '../../ui';
import type { Answers } from '../../lib/consultation/types';
import type { CompleteOnboardingResponse } from '../../api/consultationApi';
import { anyScreeningYes, CopyContext, fillCopy } from '../../lib/consultation/engine';
import {
  buildSummary,
  firstSessionLine,
  firstSessionWeekday,
  macroRomanLine,
  proteinExample,
  REVEAL_COPY,
  sessionLengthLine,
  trainingDayPattern,
  weeksEyebrow,
} from '../../lib/consultation/copy';
import { FadeIn, Frame, PrimaryButton, RomanLine, TextLink, useConsultationStyles } from './components';
import { SUPPORT_EMAIL } from '../../constants/support';
import { SupportEmailFallback, useSupportEmail } from '../../components/support/SupportEmailFallback';

function Disclosure({ label, children, testID }: { label: string; children: React.ReactNode; testID?: string }) {
  const { s, palette } = useConsultationStyles();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginTop: 20 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        testID={testID}
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border }}
      >
        <Text style={s.rowLabel}>{label}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={palette.charcoal} />
      </Pressable>
      {open ? <FadeIn style={{ paddingTop: 12, gap: 10 }}>{children}</FadeIn> : null}
    </View>
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export function SummaryScreen({
  answers,
  ctx,
  now,
  onEdit,
  onBack,
  onPrepare,
  preparing,
}: {
  answers: Answers;
  ctx: CopyContext;
  now: Date;
  onEdit: (chapter: 1 | 2 | 3 | 4 | 6) => void;
  onBack: () => void;
  onPrepare: () => void;
  preparing?: boolean;
}) {
  const { s, palette } = useConsultationStyles();
  // Prototype 43: every chapter works offline; only Prepare needs the network.
  // The app-wide OfflineBanner already shows above the flow.
  const net = useNetworkStatus();
  const offline = !net.isOnline || net.isInternetReachable === false;
  const sections = buildSummary(answers, now);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const forName = ctx.firstName?.trim() ? `Prepared for ${ctx.firstName.trim()} · ` : '';
  return (
    <Frame
      onBack={preparing ? null : onBack}
      testID={preparing ? 'consult-screen-PREP' : 'consult-screen-SUM'}
      footer={
        <PrimaryButton
          label={offline && !preparing ? REVEAL_COPY.offlineCta : 'Prepare my plan'}
          onPress={onPrepare}
          disabled={preparing || offline}
          testID="consult-prepare"
        />
      }
    >
      <View style={{ opacity: preparing ? 0.3 : 1 }}>
        <Text style={s.eyebrow}>{`${forName}${now.getDate()} ${months[now.getMonth()]}`}</Text>
        <Headline style={{ marginTop: 12 }}>Your consultation</Headline>
        {sections.map((sec) => (
          <View key={sec.title} style={{ paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={s.eyebrow}>{sec.title}</Text>
              {sec.editChapter && !preparing ? (
                <Pressable
                  onPress={() => onEdit(sec.editChapter as 1 | 2 | 3 | 4 | 6)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${sec.title.toLowerCase()}`}
                  hitSlop={10}
                  testID={`summary-edit-${sec.editChapter}`}
                  style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }}
                >
                  <Text style={[s.linkText, s.linkAccent]}>Edit</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={[s.body, { marginTop: 6 }]}>{sec.body}</Text>
          </View>
        ))}
        {!preparing ? (
          <View style={{ marginTop: 8 }}>
            <RomanLine text={offline ? REVEAL_COPY.offlineRoman : "That's everything I need. Shall I prepare your numbers and your plan?"} />
          </View>
        ) : null}
      </View>
      {preparing ? (
        <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityLabel="Preparing your plan" testID="consult-preparing" style={{ position: 'absolute', left: 24, right: 24, top: 160, alignItems: 'center' }}>
          <Text style={[s.romanText, { textAlign: 'center', flex: 0 }]}>{"One moment. I'm working through your numbers."}</Text>
          <View style={{ marginTop: 16, height: 2, width: 120, backgroundColor: palette.accent }} />
        </View>
      ) : null}
    </Frame>
  );
}

// ─── Completion problem (409 / network) ──────────────────────────────────────

export type CompleteProblem =
  | 'not_attached'
  | 'consultation_incomplete'
  | 'consent_missing'
  | 'consent_version_mismatch'
  | 'clinic_not_configured'
  | 'completion_in_progress'
  | 'invalid_answers'
  | 'network'
  | 'unknown';

const PROBLEM_COPY: Record<CompleteProblem, { head: string; body: string; cta: string }> = {
  not_attached: {
    head: 'A coach link is needed.',
    body: 'Your answers are saved. A coach must be linked before your numbers and plan can be prepared. Contact support for help with the link, or try again.',
    cta: 'Try again',
  },
  consultation_incomplete: {
    head: 'A few answers are still needed.',
    body: "Your answers are saved. I'll take you to the first one that still needs an answer.",
    cta: 'Take me there',
  },
  consent_missing: {
    head: 'One box still needs your agreement.',
    body: "Before I can prepare your plan, I'll need the first box at the start of the consultation, the training waiver and agreement to coach you. Nothing more is sent until it is ticked.",
    cta: 'Take me there',
  },
  consent_version_mismatch: {
    head: 'The agreement has been updated.',
    body: 'Please update the app to read the current agreement, then tick the first box again.',
    cta: 'Review the agreement',
  },
  clinic_not_configured: {
    head: 'Your plan could not be prepared.',
    body: 'Your answers are saved. The required coach setup is incomplete. Contact support for help, or try again.',
    cta: 'Try again',
  },
  completion_in_progress: {
    head: 'Your plan is already being prepared.',
    body: 'Give it a moment, then try again.',
    cta: 'Try again',
  },
  invalid_answers: {
    head: 'A few answers need another look.',
    body: `Some of your answers could not be saved as they are. They are kept on this phone. Please look over the summary, change anything that looks wrong, and try again. If it happens again, write to ${SUPPORT_EMAIL}.`,
    cta: 'Review my answers',
  },
  network: {
    head: "I couldn't reach the server.",
    body: 'Your answers are saved on this phone. When you are back online, I can prepare everything.',
    cta: 'Try again',
  },
  unknown: {
    head: 'I could not prepare your plan just now.',
    body: `The server ran into a problem. Your answers are kept on this phone, so nothing is lost. Tap Try again. If it happens again, write to ${SUPPORT_EMAIL}.`,
    cta: 'Try again',
  },
};

/**
 * The support line for an unexpected failure (owner rule 2026-10-01 13:34):
 * the short reference of the failed request, to quote to support.
 */
export function referenceLine(reference: string | null | undefined): string | null {
  return reference ? `Reference: ${reference}. Mention it if you write to support.` : null;
}

/**
 * Operator C-310-3: a minimal way out of the problem and paused screens.
 * "Try again" (or Continue) stays the primary action; below it, contact
 * support by email and, when the host provides it, sign out.
 */
export const ESCAPE_COPY = {
  support: 'Contact support',
  signOut: 'Sign out',
  signOutTitle: 'Sign out?',
  signOutBody: 'Answers that have not reached the server yet are removed from this phone. You can sign in again at any time.',
  cancel: 'Cancel',
} as const;

export const CONSULT_SUPPORT_SUBJECT = 'Help with my consultation';

function EscapeRow({ onSignOut }: { onSignOut?: () => void }) {
  const { s, palette } = useConsultationStyles();
  // Sol B-324-1: if no email app opens, the address (selectable), Copy and
  // Try again show in place, not in a dismissible alert.
  const supportEmail = useSupportEmail(CONSULT_SUPPORT_SUBJECT);
  return (
    <View style={{ marginTop: 24 }} testID="consult-escape">
      <TextLink
        label={ESCAPE_COPY.support}
        role="link"
        testID="consult-support"
        onPress={() => {
          void supportEmail.open();
        }}
      />
      <SupportEmailFallback handle={supportEmail} textStyle={s.body} linkColor={palette.accentText} testID="consult-support-fallback" />
      {onSignOut ? (
        <TextLink
          label={ESCAPE_COPY.signOut}
          testID="consult-sign-out"
          onPress={() =>
            Alert.alert(ESCAPE_COPY.signOutTitle, ESCAPE_COPY.signOutBody, [
              { text: ESCAPE_COPY.cancel, style: 'cancel' },
              { text: ESCAPE_COPY.signOut, style: 'destructive', onPress: onSignOut },
            ])
          }
        />
      ) : null}
    </View>
  );
}

export function CompleteProblemScreen({
  problem,
  onAction,
  onBack,
  onSignOut,
  reference,
}: {
  problem: CompleteProblem;
  onAction: () => void;
  onBack: () => void;
  onSignOut?: () => void;
  /** Short support reference of the failed request (unknown and invalid answers only). */
  reference?: string | null;
}) {
  const { s } = useConsultationStyles();
  const c = PROBLEM_COPY[problem];
  const ref = problem === 'unknown' || problem === 'invalid_answers' ? referenceLine(reference) : null;
  return (
    <Frame onBack={onBack} testID={`consult-problem-${problem}`} footer={<PrimaryButton label={c.cta} onPress={onAction} testID="consult-problem-action" />}>
      {/* Prototype 44 CalmError: Roman's face, a serif sentence, no red, no error haptic. */}
      <View style={{ marginTop: 48 }} testID="consult-problem-roman">
        <RomanAvatar crop="neutral" size={32} />
      </View>
      <Headline level="h2" style={{ marginTop: 16 }}>{c.head}</Headline>
      <Text style={[s.body, { marginTop: 12 }]}>{c.body}</Text>
      {ref ? (
        <Text style={[s.body, { marginTop: 12 }]} selectable testID="consult-problem-reference">
          {ref}
        </Text>
      ) : null}
      <EscapeRow onSignOut={onSignOut} />
    </Frame>
  );
}

// ─── Paused ─────────────────────────────────────────────────────────────────

export function PausedScreen({ ctx, onResume, onSignOut }: { ctx: CopyContext; onResume: () => void; onSignOut?: () => void }) {
  const { s } = useConsultationStyles();
  return (
    <Frame testID="consult-paused" footer={<PrimaryButton label="Continue my consultation" onPress={onResume} testID="consult-resume" />}>
      <Headline style={{ marginTop: 48 }}>Your place is kept.</Headline>
      <RomanLine text={fillCopy(REVEAL_COPY.paused, ctx)} />
      <EscapeRow onSignOut={onSignOut} />
    </Frame>
  );
}

// ─── Macro reveal ────────────────────────────────────────────────────────────

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function MacroRevealScreen({
  result,
  answers,
  ctx,
  onNext,
}: {
  result: CompleteOnboardingResponse;
  answers: Answers;
  ctx: CopyContext;
  onNext: () => void;
}) {
  const { s, palette } = useConsultationStyles();
  const m = result.macros;
  const coach = result.coach?.display_name || ctx.coachName || null;
  const c2 = { ...ctx, coachName: coach };
  // Opus C-4 / contract item 8: never-trackers see calories and protein only
  // in week one. The full targets are still set on the server.
  const simple = result.macro_display_mode === 'simple';
  // Prototype 39: the numbers arrive with one success haptic (the Settings
  // switch is honoured; no engine means nothing happens), no count-up.
  useEffect(() => {
    void HapticService.success();
  }, []);
  const questionsLine = fillCopy(REVEAL_COPY.macroQuestions, c2);
  const rows = (simple
    ? [['Protein', m.protein_g]]
    : [['Protein', m.protein_g], ['Carbs', m.carbs_g], ['Fat', m.fat_g]]) as ReadonlyArray<readonly [string, number]>;
  return (
    <Frame testID="consult-screen-MACRO" footer={<PrimaryButton label="Next: your plan" onPress={onNext} testID="consult-macro-next" />}>
      <FadeIn><Text style={s.eyebrow}>Your daily targets</Text></FadeIn>
      <FadeIn delayIndex={1} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 16 }}>
        <Text style={[s.display, { fontSize: 64, lineHeight: Math.round(64 * SERIF_MIN_LINE_RATIO) }]} accessibilityLabel={`${fmt(m.calories)} calories a day`} testID="macro-calories">
          {fmt(m.calories)}
        </Text>
        <Text style={s.mutedSmall}>kcal</Text>
      </FadeIn>
      <FadeIn delayIndex={1}><Text style={s.mutedSmall}>calories a day</Text></FadeIn>
      <FadeIn delayIndex={2} style={{ marginTop: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }}>
        {rows.map(([l, v]) => (
          <View key={l} accessible accessibilityLabel={`${l} ${fmt(v)} grams`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border }}>
            <Text style={s.body}>{l}</Text>
            <Text style={s.h2} testID={`macro-${l.toLowerCase()}`}>{`${fmt(v)} g`}</Text>
          </View>
        ))}
      </FadeIn>
      <FadeIn delayIndex={3} style={{ marginTop: 8 }}>
        <RomanLine text={macroRomanLine(answers.G1, ctx.firstName, m.floor_applied)} />
      </FadeIn>
      <Disclosure label="Why these numbers" testID="macro-why">
        <Text style={s.small}>Calories are your overall energy budget for the day, set from your height, weight, age, activity and goal.</Text>
        <Text style={s.small}>{`Protein helps you keep and build muscle, and keeps you fuller for longer. ${proteinExample(answers.N1, Math.round(m.protein_g))}`}</Text>
        {simple ? (
          <Text style={s.small} testID="macro-simple-note">
            {'Calories and protein are shown here. Carbs and fat targets are also set.'}
          </Text>
        ) : (
          <>
            <Text style={s.small}>{`Carbs are your body's main fuel for workouts and daily activity. Your target is ${fmt(m.carbs_g)} g.`}</Text>
            <Text style={s.small}>{`Fat supports your hormones and helps you absorb some vitamins. Your target is ${fmt(m.fat_g)} g.`}</Text>
          </>
        )}
        <Text style={s.small}>{'How to use these numbers: log what you eat, and aim to land close to each target by the end of the day. A little over or under is normal.'}</Text>
        <Text style={s.small}>{"If you're hungry, add vegetables, protein or water before more carbs or fat. If you're tired, check your carbs first, then your sleep and water."}</Text>
        <Text style={s.mutedSmall}>{`Method: ${m.method}.`}</Text>
        {questionsLine ? <Text style={s.small}>{questionsLine}</Text> : null}
      </Disclosure>
    </Frame>
  );
}

// ─── Plan reveal ─────────────────────────────────────────────────────────────

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function PlanRevealScreen({
  result,
  answers,
  ctx,
  now,
  onBack,
  onFinish,
}: {
  result: CompleteOnboardingResponse;
  answers: Answers;
  ctx: CopyContext;
  now: Date;
  onBack: () => void;
  onFinish: () => void;
}) {
  const { s, palette } = useConsultationStyles();
  const p = result.program;
  const coach = result.coach?.display_name || ctx.coachName || null;
  const c2 = { ...ctx, coachName: coach };
  const days = trainingDayPattern(p.days_per_week);
  const screened = anyScreeningYes(answers);
  const first = firstSessionLine(answers.C1, now);
  const firstDay = firstSessionWeekday(answers.C1);
  const length = sessionLengthLine(answers.T4);
  const why = p.why.filter(Boolean).join(' ');
  return (
    <Frame onBack={onBack} testID="consult-screen-PLAN" footer={<PrimaryButton label="Show me around" onPress={onFinish} testID="consult-finish" />}>
      <FadeIn><Text style={s.eyebrow}>{weeksEyebrow(p.weeks)}</Text></FadeIn>
      <FadeIn delayIndex={1}>
        <Headline level="display" style={{ marginTop: 14 }} testID="plan-name">{p.name}</Headline>
        {screened ? (
          <Text style={[s.mutedSmall, { marginTop: 10 }]} testID="plan-physician-line">
            {fillCopy(REVEAL_COPY.physicianStart, c2)}
          </Text>
        ) : null}
      </FadeIn>
      {why ? (
        <FadeIn delayIndex={2} style={{ marginTop: 8 }}>
          <RomanLine text={why} />
        </FadeIn>
      ) : null}
      <View style={s.hair} />
      <FadeIn delayIndex={3}>
        <Text style={[s.eyebrow, { marginBottom: 16 }]}>Suggested training days</Text>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between' }}
          accessible
          accessibilityLabel={`Suggested training days: ${days.map((d) => DAY_NAMES[d]).join(', ')}${firstDay !== null ? `. First session: ${DAY_NAMES[firstDay]}` : ''}`}
          testID="plan-week-strip"
        >
          {DAY_LETTERS.map((l, i) => (
            <View key={i} style={{ alignItems: 'center', gap: 8 }}>
              <Text style={s.mutedSmall}>{l}</Text>
              {/* Prototype 40: training days carry an accent dot; the first day is ring-highlighted. */}
              <View
                testID={i === firstDay ? 'plan-first-day-ring' : undefined}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: radius.chip,
                  borderWidth: i === firstDay ? 1 : 0,
                  borderColor: palette.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View style={{ width: 6, height: 6, borderRadius: radius.chip, backgroundColor: days.includes(i) || i === firstDay ? palette.accent : palette.border }} />
              </View>
            </View>
          ))}
        </View>
        {first ? <Text style={[s.h3, { marginTop: 22 }]}>{first}</Text> : null}
        <Text style={[s.mutedSmall, { marginTop: 4 }]} testID="plan-week-line">
          {`${p.days_per_week} ${p.days_per_week === 1 ? 'day' : 'days'} a week.${length ? ` ${length}` : ''}`}
        </Text>
      </FadeIn>
      <Disclosure label="Why this plan" testID="plan-why">
        {p.why.map((w) => (
          <Text key={w} style={s.listItem}>{w}</Text>
        ))}
        <Text style={s.small}>{fillCopy(REVEAL_COPY.planAdjust, c2)}</Text>
      </Disclosure>
    </Frame>
  );
}
