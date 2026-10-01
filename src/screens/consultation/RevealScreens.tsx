/**
 * Consultation end states: summary, preparing, macro reveal, plan reveal,
 * paused, and the calm completion-problem state. Numbers and the program
 * come only from the server (POST /me/onboarding/complete); nothing here
 * computes macros on the device.
 */
import React, { useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Answers } from '../../lib/consultation/types';
import type { CompleteOnboardingResponse } from '../../api/consultationApi';
import { anyScreeningYes, CopyContext, fillCopy } from '../../lib/consultation/engine';
import {
  buildSummary,
  firstSessionLine,
  macroRomanLine,
  proteinExample,
  trainingDayPattern,
  weeksEyebrow,
} from '../../lib/consultation/copy';
import { FadeIn, Frame, palette, PrimaryButton, RomanLine, s, TextLink } from './components';
import { SUPPORT_EMAIL } from '../../lib/consultation/copy';

function Disclosure({ label, children, testID }: { label: string; children: React.ReactNode; testID?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginTop: 20 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        testID={testID}
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.border }}
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
  const sections = buildSummary(answers, now);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const forName = ctx.firstName?.trim() ? `Prepared for ${ctx.firstName.trim()} · ` : '';
  return (
    <Frame
      onBack={preparing ? null : onBack}
      testID={preparing ? 'consult-screen-PREP' : 'consult-screen-SUM'}
      footer={<PrimaryButton label="Prepare my plan" onPress={onPrepare} disabled={preparing} testID="consult-prepare" />}
    >
      <View style={{ opacity: preparing ? 0.3 : 1 }}>
        <Text style={s.eyebrow}>{`${forName}${now.getDate()} ${months[now.getMonth()]}`}</Text>
        <Text style={[s.h1, { marginTop: 12 }]} accessibilityRole="header">Your consultation</Text>
        {sections.map((sec) => (
          <View key={sec.title} style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: palette.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={s.eyebrow}>{sec.title}</Text>
              {sec.editChapter && !preparing ? (
                <Pressable
                  onPress={() => onEdit(sec.editChapter as 1 | 2 | 3 | 4 | 6)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${sec.title.toLowerCase()}`}
                  hitSlop={10}
                  testID={`summary-edit-${sec.editChapter}`}
                >
                  <Text style={[s.linkText, s.linkAccent]}>Edit</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={[s.h3, { marginTop: 6 }]}>{sec.body}</Text>
          </View>
        ))}
        {!preparing ? (
          <View style={{ marginTop: 8 }}>
            <RomanLine text="That's everything I need. Shall I prepare your numbers and your plan?" />
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
    head: 'Your coach link is still being set up.',
    body: 'Your answers are saved. Once your account is linked to your coach, I can prepare your numbers and your plan. Please try again in a moment.',
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
    head: 'Your coach is still setting things up.',
    body: 'Your answers are saved. Your plan will be ready to prepare shortly. Please try again in a little while.',
    cta: 'Try again',
  },
  completion_in_progress: {
    head: 'Your plan is already being prepared.',
    body: 'Give it a moment, then try again.',
    cta: 'Try again',
  },
  invalid_answers: {
    head: 'A few answers need another look.',
    body: 'Some of your answers could not be saved as they are. They are kept on this phone. Please look over the summary, change anything that looks wrong, and try again.',
    cta: 'Review my answers',
  },
  network: {
    head: "I couldn't reach the server.",
    body: 'Your answers are saved on this phone. When you are back online, I can prepare everything.',
    cta: 'Try again',
  },
  unknown: {
    head: 'Something went wrong on our side.',
    body: 'Your answers are saved. Please try again in a moment.',
    cta: 'Try again',
  },
};

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
  supportUnavailable: 'Email is not set up on this phone. You can write to ' + SUPPORT_EMAIL + '.',
} as const;

export function supportMailto(): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Help with my consultation')}`;
}

function EscapeRow({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <View style={{ marginTop: 24 }} testID="consult-escape">
      <TextLink
        label={ESCAPE_COPY.support}
        role="link"
        testID="consult-support"
        onPress={() => {
          Linking.openURL(supportMailto()).catch(() => Alert.alert(ESCAPE_COPY.support, ESCAPE_COPY.supportUnavailable));
        }}
      />
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
}: {
  problem: CompleteProblem;
  onAction: () => void;
  onBack: () => void;
  onSignOut?: () => void;
}) {
  const c = PROBLEM_COPY[problem];
  return (
    <Frame onBack={onBack} testID={`consult-problem-${problem}`} footer={<PrimaryButton label={c.cta} onPress={onAction} testID="consult-problem-action" />}>
      <Text style={[s.h2, { marginTop: 24 }]} accessibilityRole="header">{c.head}</Text>
      <Text style={[s.body, { marginTop: 12 }]}>{c.body}</Text>
      <EscapeRow onSignOut={onSignOut} />
    </Frame>
  );
}

// ─── Paused ─────────────────────────────────────────────────────────────────

export function PausedScreen({ ctx, onResume, onSignOut }: { ctx: CopyContext; onResume: () => void; onSignOut?: () => void }) {
  return (
    <Frame testID="consult-paused" footer={<PrimaryButton label="Continue my consultation" onPress={onResume} testID="consult-resume" />}>
      <Text style={[s.h1, { marginTop: 48 }]} accessibilityRole="header">Your place is kept.</Text>
      <RomanLine text={fillCopy("Whenever you're ready, we'll pick up exactly where you left off. {Coach} will see your answers once you finish.", ctx)} />
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
  const m = result.macros;
  const coach = result.coach?.display_name || ctx.coachName || null;
  const c2 = { ...ctx, coachName: coach };
  // Opus C-4 / contract item 8: never-trackers see calories and protein only
  // in week one. The full targets are still set on the server.
  const simple = result.macro_display_mode === 'simple';
  const rows = (simple
    ? [['Protein', m.protein_g]]
    : [['Protein', m.protein_g], ['Carbs', m.carbs_g], ['Fat', m.fat_g]]) as ReadonlyArray<readonly [string, number]>;
  return (
    <Frame testID="consult-screen-MACRO" footer={<PrimaryButton label="Next: your plan" onPress={onNext} testID="consult-macro-next" />}>
      <FadeIn><Text style={s.eyebrow}>Your daily targets</Text></FadeIn>
      <FadeIn delayIndex={1} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 16 }}>
        <Text style={[s.display, { fontSize: 64, lineHeight: 68 }]} accessibilityLabel={`${fmt(m.calories)} calories a day`} testID="macro-calories">
          {fmt(m.calories)}
        </Text>
        <Text style={s.mutedSmall}>kcal</Text>
      </FadeIn>
      <FadeIn delayIndex={1}><Text style={s.mutedSmall}>calories a day</Text></FadeIn>
      <FadeIn delayIndex={2} style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: palette.border }}>
        {rows.map(([l, v]) => (
          <View key={l} accessible accessibilityLabel={`${l} ${fmt(v)} grams`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.border }}>
            <Text style={s.h3}>{l}</Text>
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
            {'For your first week, two numbers are enough: calories and protein. Carbs and fat join them after that, once logging feels easy.'}
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
        <Text style={s.small}>{fillCopy('Questions about your numbers? Message {coach} any time from Messages. Your coach can adjust these targets for you.', c2)}</Text>
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
  const p = result.program;
  const coach = result.coach?.display_name || ctx.coachName || null;
  const c2 = { ...ctx, coachName: coach };
  const days = trainingDayPattern(p.days_per_week);
  const screened = anyScreeningYes(answers);
  const first = firstSessionLine(answers.C1, now);
  const why = p.why.filter(Boolean).join(' ');
  return (
    <Frame onBack={onBack} testID="consult-screen-PLAN" footer={<PrimaryButton label="Show me around" onPress={onFinish} testID="consult-finish" />}>
      <FadeIn><Text style={s.eyebrow}>{weeksEyebrow(p.weeks)}</Text></FadeIn>
      <FadeIn delayIndex={1}>
        <Text style={[s.display, { marginTop: 14 }]} accessibilityRole="header" testID="plan-name">{p.name}</Text>
        {screened ? (
          <Text style={[s.mutedSmall, { marginTop: 10 }]} testID="plan-physician-line">
            {fillCopy('Start once your physician gives you the OK. {Coach} has been told.', c2)}
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
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between' }}
          accessible
          accessibilityLabel={`Training days this week: ${days.map((d) => DAY_NAMES[d]).join(', ')}`}
          testID="plan-week-strip"
        >
          {DAY_LETTERS.map((l, i) => (
            <View key={i} style={{ alignItems: 'center', gap: 8 }}>
              <Text style={s.mutedSmall}>{l}</Text>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: days.includes(i) ? palette.accent : palette.border }} />
            </View>
          ))}
        </View>
        {first ? <Text style={[s.h3, { marginTop: 22 }]}>{first}</Text> : null}
        <Text style={[s.mutedSmall, { marginTop: 4 }]}>{`${p.days_per_week} ${p.days_per_week === 1 ? 'day' : 'days'} a week.`}</Text>
      </FadeIn>
      <Disclosure label="Why this plan" testID="plan-why">
        {p.why.map((w) => (
          <Text key={w} style={s.listItem}>{w}</Text>
        ))}
        <Text style={s.small}>{fillCopy('Your first day is already scheduled in Train. Does something feel off? Message {coach}. Your coach can adjust anything in this plan.', c2)}</Text>
      </Disclosure>
    </Frame>
  );
}
