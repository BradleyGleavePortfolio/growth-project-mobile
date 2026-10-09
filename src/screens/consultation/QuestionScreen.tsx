/**
 * QuestionScreen renders one consultation screen from its data definition.
 * The template id picks the body; copy, options and validation all come
 * from `lib/consultation/definitions.ts`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import * as Localization from 'expo-localization';
import { PRIVACY_POLICY_URL } from '../../config/env';
import type { AiConsentUpgradeCopy } from '../../api/aiConsentApi';
import CoachSharingNotice from '../../components/coachSharing/CoachSharingNotice';
import type {
  AnswerValue,
  Answers,
  ChapterProgress,
  ConsentAnswer,
  MeasureAnswer,
  ScreenDef,
} from '../../lib/consultation/types';
import {
  ageOn,
  answerKeyOf,
  CopyContext,
  defaultMeasureUnit,
  detailShown,
  fillCopy,
  isConsentAnswerCurrent,
  optionsFor,
  toggleSelection,
  validateScreen,
} from '../../lib/consultation/engine';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_PARAGRAPH,
  AI_CHOICE_UNKNOWN_LINE,
  AI_WITHDRAW_UNCONFIRMED_LINE,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_COPY_SHA256,
  CONSENT_FOOTER,
  CONSENT_MEMORY_COPY_SHA256,
  CONSENT_PARAGRAPHS,
  CONSULT_CONSENT_COPY_VERSION,
  CONSULT_CONSENT_MEMORY_COPY_VERSION,
  P8_COPY,
} from '../../lib/consultation/copy';
import {
  Checkbox,
  Chip,
  FadeIn,
  Frame,
  LabeledInput,
  OptionRow,
  PrimaryButton,
  QuestionHeader,
  RomanLine,
  TextLink,
  UnitTabs,
  Wheel,
  s,
} from './components';
import { Headline } from '../../ui';

export interface QuestionScreenProps {
  screen: ScreenDef;
  answers: Answers;
  progress: ChapterProgress | null;
  ctx: CopyContext;
  now: Date;
  /** Set an answer. `advance` asks the flow to move on (auto-advance). */
  onAnswer: (key: string, value: AnswerValue | undefined, opts?: { advance?: boolean }) => void;
  /** Continue / Skip: move to the next screen. */
  /**
   * `aiChoice` is box 2 of P0 (optional Roman and AI): true / false when the
   * client tapped box 2 on this visit (their explicit latest choice), null
   * when they left it as shown. Other screens omit it.
   */
  onNext: (patch?: Answers, aiChoice?: boolean | null) => void;
  onBack: (() => void) | null;
  onFinishLater: (() => void) | null;
  /** Prototype 42: Roman's welcome-back line replaces the chapter line on the first screen after a resume. */
  romanOverride?: string | null;
  /** P0 only: recording in progress, or why the last attempt failed. */
  /**
   * `aiAllowed`: what box 2 shows (the client's latest choice while the
   * ledger is catching up, else the confirmed ledger state). `aiReady`:
   * false while the saved choice is still being read and nothing is known
   * on this device yet (Opus C-310-7), so an untouched box is never mistaken
   * for a choice. `aiUnconfirmed`: the client said no to box 2 and the
   * ledger has not confirmed the withdrawal yet (Sol B-310-5), so P0 says
   * it is not confirmed rather than that it is off. `aiUnknown`: the saved
   * choice could not be read in time (C-310-9): P0 says so and where to
   * check it; box 2 stays optional and untouched sends nothing.
   * `aiMemory` (R11-C2B): the server's client-ai-v5 copy box 2 shows instead
   * of the pinned v4 paragraph (same label, same tick, still unticked by
   * default); the P0 record then names consult-consent-v4.
   */
  consent?: {
    error: 'version_mismatch' | null;
    aiAllowed?: boolean;
    aiReady?: boolean;
    aiUnconfirmed?: boolean;
    aiUnknown?: boolean;
    aiMemory?: AiConsentUpgradeCopy | null;
    /** B-SHARE-GUEST-127: the coach-sharing sentence printed above P0 Continue (null: none). */
    coachSharing?: { version: string; coachName: string | null } | null;
  };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function range(a: number, b: number): number[] {
  const r: number[] = [];
  for (let x = a; x <= b; x += 1) r.push(x);
  return r;
}
const ftIn = (v: number) => `${Math.floor(v / 12)} ft ${v % 12} in`;

function phoneRegion(): string | null {
  try {
    return Localization.getLocales()[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}

export default function QuestionScreen(props: QuestionScreenProps) {
  const { screen, answers, progress, ctx, now, onAnswer, onNext, onBack, onFinishLater } = props;
  const f = (t?: string) => (t ? fillCopy(t, ctx) : undefined);
  const key = answerKeyOf(screen);
  const value = answers[key];
  const validation = validateScreen(screen, answers, now);
  const options = optionsFor(screen, now);

  const header = (
    <QuestionHeader
      eyebrow={screen.eyebrow}
      timeLeft={screen.timeLeft}
      sub={f(screen.sub)}
      roman={f(props.romanOverride ?? screen.roman)}
      question={f(screen.question) ?? ''}
      long={screen.longQuestion}
      why={f(screen.why)}
    />
  );

  const frame = (body: React.ReactNode, footer: React.ReactNode) => (
    <Frame
      progress={progress}
      onBack={onBack}
      onFinishLater={onFinishLater}
      pauseLabel={screen.pause}
      footer={footer}
      testID={`consult-screen-${screen.id}`}
    >
      {header}
      <View style={s.answers}>{body}</View>
    </Frame>
  );

  const skipLink = screen.skippable ? (
    <TextLink label={screen.skipLabel ?? 'Skip'} onPress={() => onNext()} testID="consult-skip" />
  ) : null;

  const continueBtn = (enabled: boolean, onPress: () => void = () => onNext()) => (
    <PrimaryButton label={screen.cta ?? 'Continue'} onPress={onPress} disabled={!enabled} testID="consult-continue" />
  );

  const detail = screen.detail && detailShown(screen, answers) ? (
    <FadeIn style={{ marginTop: 16 }}>
      {screen.detail.chipsKey && screen.detail.chipsOptions ? (
        <View>
          <Text style={[s.h3, { marginBottom: 12 }]}>{screen.detail.chipsLabel}</Text>
          <View style={s.chips}>
            {screen.detail.chipsOptions.map((o) => {
              const cur = Array.isArray(answers[screen.detail!.chipsKey!]) ? (answers[screen.detail!.chipsKey!] as string[]) : [];
              return (
                <Chip
                  key={o.value}
                  option={o}
                  selected={cur.includes(o.value)}
                  onPress={() => onAnswer(screen.detail!.chipsKey!, toggleSelection(cur, o.value))}
                  testID={`consult-detail-chip-${o.value}`}
                />
              );
            })}
          </View>
        </View>
      ) : null}
      {screen.detail.textKey ? (
        <LabeledInput
          label={f(screen.detail.textLabel) ?? ''}
          value={typeof answers[screen.detail.textKey] === 'string' ? (answers[screen.detail.textKey] as string) : ''}
          onChange={(t) => onAnswer(screen.detail!.textKey!, t)}
          maxLength={screen.detail.textMaxLength}
          multiline={screen.detail.textMultiline}
          testID={`consult-detail-text-${screen.id}`}
        />
      ) : null}
    </FadeIn>
  ) : null;

  const message = validation.message && !validation.valid && screen.template !== 'consent' ? (
    <Text style={s.errorNote} accessibilityLiveRegion="polite" testID="consult-validation">
      {validation.message}
    </Text>
  ) : null;

  switch (screen.template) {
    case 'rows':
    case 'yesno': {
      const showCta = screen.template === 'yesno' ? detailShown(screen, answers) : false;
      return frame(
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          {options.map((o) => (
            <OptionRow
              key={o.value}
              option={o}
              selected={value === o.value}
              tall={screen.template === 'yesno'}
              onPress={() => onAnswer(key, o.value, { advance: !!screen.autoAdvance && !o.noAutoAdvance })}
              testID={`consult-option-${o.value}`}
            />
          ))}
          {detail}
          {message}
        </View>,
        showCta || skipLink ? (
          <>
            {skipLink}
            {showCta ? continueBtn(validation.valid) : null}
          </>
        ) : null,
      );
    }

    case 'chips': {
      const multi = !screen.single;
      const cur = Array.isArray(value) ? (value as string[]) : [];
      const max = screen.validation?.maxSelections;
      const capped = multi && !!max && cur.length >= max;
      const showCta = !!screen.cta && (multi || !screen.autoAdvance);
      return frame(
        <View>
          <View style={screen.big ? s.chipsBig : s.chips} accessibilityRole={multi ? undefined : 'radiogroup'} testID={screen.big ? 'consult-chips-big' : undefined}>
            {options.map((o) => (
              <Chip
                key={o.value}
                option={o}
                single={!multi}
                big={screen.big}
                selected={multi ? cur.includes(o.value) : value === o.value}
                capped={capped}
                onPress={() =>
                  multi
                    ? onAnswer(key, toggleSelection(cur, o.value, { exclusive: screen.exclusive, max }))
                    : onAnswer(key, o.value, { advance: !!screen.autoAdvance })
                }
                testID={`consult-chip-${o.value}`}
              />
            ))}
          </View>
          {capped ? <Text style={s.capNote} accessibilityLiveRegion="polite">Up to three.</Text> : null}
          {detail}
          {message}
        </View>,
        showCta || skipLink ? (
          <>
            {skipLink}
            {showCta ? continueBtn(validation.valid && (multi ? cur.length > 0 : value != null)) : null}
          </>
        ) : null,
      );
    }

    case 'dob':
      return <DobBody {...props} header={header} />;
    case 'measure':
      return <MeasureBody {...props} header={header} />;
    case 'goalWeight':
      return <GoalWeightBody {...props} header={header} />;

    case 'consent':
      return <ConsentBody {...props} header={header} />;

    case 'message':
      return frame(
        <View>
          <Text style={s.small}>{P8_COPY.intro}</Text>
          <Text style={[s.eyebrow, { marginTop: 20, marginBottom: 4 }]}>{P8_COPY.guidanceTitle}</Text>
          {P8_COPY.guidance.map((t) => fillCopy(t, ctx)).filter(Boolean).map((t) => (
            <Text key={t} style={s.listItem}>{t}</Text>
          ))}
          <Text style={[s.eyebrow, { marginTop: 20, marginBottom: 4 }]}>{P8_COPY.nextTitle}</Text>
          {P8_COPY.next.map((t) => fillCopy(t, ctx)).filter(Boolean).map((t) => (
            <Text key={t} style={s.listItem}>{t}</Text>
          ))}
          <Text style={[s.small, { marginTop: 20 }]} testID="p8-physician-line">{P8_COPY.physician}</Text>
          <Text style={[s.mutedSmall, { marginTop: 12 }]}>{P8_COPY.emergency}</Text>
          <Text style={[s.mutedSmall, { marginTop: 12 }]}>{P8_COPY.disclaimer}</Text>
        </View>,
        continueBtn(true),
      );

    case 'intro':
    default:
      return (
        <Frame onBack={null} onFinishLater={null} footer={continueBtn(true)} testID={`consult-screen-${screen.id}`}>
          <View style={{ paddingTop: 48 }}>
            <FadeIn><Text style={s.eyebrow}>{screen.eyebrow}</Text></FadeIn>
            <FadeIn delayIndex={1}>
              <Headline level="display" style={{ marginTop: 16 }}>{f(screen.question)}</Headline>
            </FadeIn>
            {screen.roman ? (
              <FadeIn delayIndex={2} style={{ marginTop: 12 }}>
                <RomanLine text={f(screen.roman) ?? ''} size={40} />
              </FadeIn>
            ) : null}
            <FadeIn delayIndex={3}>
              <View style={s.hair} />
              <Text style={s.body}>{f(screen.sub)}</Text>
              <Text style={[s.mutedSmall, { marginTop: 20 }]}>{screen.timeLeft}</Text>
            </FadeIn>
          </View>
        </Frame>
      );
  }
}

type BodyProps = QuestionScreenProps & { header: React.ReactNode };

function BodyFrame({ props, header, children, footer }: { props: QuestionScreenProps; header: React.ReactNode; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Frame
      progress={props.progress}
      onBack={props.onBack}
      onFinishLater={props.onFinishLater}
      pauseLabel={props.screen.pause}
      footer={footer}
      testID={`consult-screen-${props.screen.id}`}
    >
      {header}
      <View style={s.answers}>{children}</View>
    </Frame>
  );
}

function parseIso(v: unknown): { y: number; m: number; d: number } | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

function DobBody(props: BodyProps) {
  const { screen, answers, now, onAnswer, onNext, header } = props;
  const parsed = parseIso(answers.B2);
  const [y, setY] = useState(parsed?.y ?? now.getFullYear() - 30);
  const [m, setM] = useState(parsed?.m ?? now.getMonth() + 1);
  const [d, setD] = useState(parsed?.d ?? Math.min(28, now.getDate()));
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const draft = { ...answers, B2: iso };
  const v = validateScreen(screen, draft, now);
  // Prototype 45: an age under 16 leads to a calm, final stop screen (no
  // form, nothing saved) whose only action returns to the wheels.
  const minAge = screen.validation?.ageRange?.min ?? 16;
  const age = ageOn(iso, now);
  const under = !Number.isNaN(age) && age < minAge;
  const [stopped, setStopped] = useState(false);
  if (stopped) {
    return (
      <Frame
        onBack={() => setStopped(false)}
        onFinishLater={null}
        footer={<PrimaryButton label="Change my date of birth" onPress={() => setStopped(false)} testID="consult-under-age-change" />}
        testID="consult-screen-UNDER_AGE"
      >
        <View style={{ paddingTop: 96 }}>
          <Text style={s.eyebrow}>{screen.eyebrow}</Text>
          <Headline style={{ marginTop: 16 }}>{`The Growth Project is for ages ${minAge} and up.`}</Headline>
          <Text style={[s.mutedSmall, { marginTop: 12 }]}>If the date was entered by mistake, go back and change it.</Text>
        </View>
      </Frame>
    );
  }
  const commit = (ny = y, nm = m, nd = d) =>
    onAnswer('B2', `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`);
  return (
    <BodyFrame
      props={props}
      header={header}
      footer={
        <PrimaryButton
          label="Continue"
          disabled={!v.valid && !under}
          onPress={() => (under ? setStopped(true) : onNext({ B2: iso }))}
          testID="consult-continue"
        />
      }
    >
      <View style={s.wheels}>
        <View style={[s.wheelCol, { flex: 1.6 }]}>
          <Wheel label="Birth month" values={MONTHS} value={MONTHS[m - 1]} onChange={(x) => { const nm = MONTHS.indexOf(x) + 1; setM(nm); commit(y, nm, d); }} testID="wheel-dob-month" />
        </View>
        <View style={[s.wheelCol, { flex: 0.8 }]}>
          <Wheel label="Birth day" values={range(1, 31)} value={d} onChange={(x) => { setD(x); commit(y, m, x); }} testID="wheel-dob-day" />
        </View>
        <View style={s.wheelCol}>
          <Wheel label="Birth year" values={range(now.getFullYear() - 100, now.getFullYear() - 10)} value={y} onChange={(x) => { setY(x); commit(x, m, d); }} testID="wheel-dob-year" />
        </View>
      </View>
      {v.message && !under ? <Text style={s.errorNote} accessibilityLiveRegion="polite" testID="consult-validation">{v.message}</Text> : null}
    </BodyFrame>
  );
}

function MeasureBody(props: BodyProps) {
  const { answers, onAnswer, onNext, header } = props;
  const existing = answers.B3 as MeasureAnswer | undefined;
  // Prototype B3: the unit tabs default from the phone's region (US, Liberia
  // and Myanmar imperial, everywhere else metric); a saved answer keeps its unit.
  const [unit, setUnit] = useState<'imperial' | 'metric'>(() => existing?.unit ?? defaultMeasureUnit(phoneRegion()));
  const [heightCm, setHeightCm] = useState(existing?.height_cm ?? 167.6);
  const [weightLbs, setWeightLbs] = useState(existing?.weight_lbs ?? 172);
  const value: MeasureAnswer = { height_cm: heightCm, weight_lbs: weightLbs, unit };
  const commit = (patch: Partial<MeasureAnswer>) => onAnswer('B3', { ...value, ...patch });
  const inches = Math.round(heightCm / 2.54);
  const kg = Math.round(weightLbs * 0.453592);
  return (
    <BodyFrame props={props} header={header} footer={<PrimaryButton label="Continue" onPress={() => onNext({ B3: value })} testID="consult-continue" />}>
      <UnitTabs unit={unit} onChange={(u) => { setUnit(u); commit({ unit: u }); }} />
      <View style={s.wheels}>
        <View style={s.wheelCol}>
          <Text style={s.eyebrow}>Height</Text>
          {unit === 'imperial' ? (
            <Wheel label="Height" values={range(48, 90)} value={Math.min(90, Math.max(48, inches))} format={ftIn}
              onChange={(x) => { const cm = Math.round(x * 2.54 * 10) / 10; setHeightCm(cm); commit({ height_cm: cm }); }} testID="wheel-height" />
          ) : (
            <Wheel label="Height" values={range(122, 229)} value={Math.min(229, Math.max(122, Math.round(heightCm)))} format={(x) => `${x} cm`}
              onChange={(x) => { setHeightCm(x); commit({ height_cm: x }); }} testID="wheel-height" />
          )}
        </View>
        <View style={s.wheelCol}>
          <Text style={s.eyebrow}>Weight</Text>
          {unit === 'imperial' ? (
            <Wheel label="Weight" values={range(70, 600)} value={Math.min(600, Math.max(70, Math.round(weightLbs)))} format={(x) => `${x} lb`}
              onChange={(x) => { setWeightLbs(x); commit({ weight_lbs: x }); }} testID="wheel-weight" />
          ) : (
            <Wheel label="Weight" values={range(32, 272)} value={Math.min(272, Math.max(32, kg))} format={(x) => `${x} kg`}
              onChange={(x) => { const lb = Math.round(x / 0.453592); setWeightLbs(lb); commit({ weight_lbs: lb }); }} testID="wheel-weight" />
          )}
        </View>
      </View>
    </BodyFrame>
  );
}

export function goalWeightNote(goalLbs: number, currentLbs: number, goal: unknown): string {
  if (goal !== 'muscle_gain' && goal !== 'performance' && goalLbs > currentLbs) {
    return "That's above your current weight. Is that right?";
  }
  if (currentLbs > 0 && Math.abs(goalLbs - currentLbs) / currentLbs > 0.3) {
    return "That's a long road. {Coach} will set milestones with you.";
  }
  return '';
}

function GoalWeightBody(props: BodyProps) {
  const { answers, onNext, onAnswer, header, screen, ctx } = props;
  const m = answers.B3 as MeasureAnswer | undefined;
  const current = m?.weight_lbs ?? 172;
  const unit = m?.unit ?? 'imperial';
  const [lbs, setLbs] = useState<number>(typeof answers.B4 === 'number' ? answers.B4 : Math.round(current));
  // fillCopy swaps in the coachless version (COACHLESS_COPY) for a client with no coach.
  const note = fillCopy(goalWeightNote(lbs, current, answers.G1), ctx);
  const kg = Math.round(lbs * 0.453592);
  return (
    <BodyFrame
      props={props}
      header={header}
      footer={
        <>
          <TextLink label={screen.skipLabel ?? 'Skip'} onPress={() => { onAnswer('B4', null); onNext({ B4: null }); }} testID="consult-skip" />
          <PrimaryButton label="Continue" onPress={() => onNext({ B4: lbs })} testID="consult-continue" />
        </>
      }
    >
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 220 }}>
          <Text style={s.eyebrow}>Goal weight</Text>
          {unit === 'imperial' ? (
            <Wheel label="Goal weight" values={range(70, 600)} value={Math.min(600, Math.max(70, lbs))} format={(x) => `${x} lb`} onChange={(x) => setLbs(x)} testID="wheel-goal" />
          ) : (
            <Wheel label="Goal weight" values={range(32, 272)} value={Math.min(272, Math.max(32, kg))} format={(x) => `${x} kg`} onChange={(x) => setLbs(Math.round(x / 0.453592))} testID="wheel-goal" />
          )}
        </View>
      </View>
      <Text style={s.softNote} accessibilityLiveRegion="polite" testID="goal-weight-note">{note}</Text>
    </BodyFrame>
  );
}

// Opus C-3: no "Nothing has been sent" here; chapter saves may already have
// landed when the server moves to a newer agreement.
const CONSENT_ERROR_COPY = {
  version_mismatch:
    'The agreement has been updated since this version of the app. Please update the app to read the current agreement before you continue.',
} as const;

/** Open the public Privacy Policy (same page the Trust Center links to). */
export function openPrivacyPolicy(): void {
  Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
    Alert.alert(
      'Privacy Policy',
      `This phone could not open the link. You can read the Privacy Policy in any web browser at ${PRIVACY_POLICY_URL.replace(/^https:\/\//, '')}.`,
    );
  });
}

function ConsentBody(props: BodyProps) {
  const { answers, onNext, header, consent: state } = props;
  // Only a record matching this build's copy version counts (Sol A-03):
  // stale or malformed records render box 1 unticked.
  const already = isConsentAnswerCurrent(answers.P0);
  const [checked, setChecked] = useState(already);
  // Box 2 is optional and unticked by default (D2). It shows the client's
  // latest choice while the ledger is catching up, otherwise the confirmed
  // ledger state (Opus B-310-2, B-310-3): a confirmed result from earlier,
  // the draft after a restart, or GET /me/ai-consent when it answers. A late
  // answer never overrides what the client has just tapped, and only a tap
  // on this visit counts as a new choice: an untouched box keeps what it
  // showed.
  const aiShown = !!state?.aiAllowed;
  const aiReady = state?.aiReady !== false;
  const [aiChecked, setAiChecked] = useState(aiShown);
  const aiTouched = useRef(false);
  useEffect(() => {
    if (!aiTouched.current) setAiChecked(aiShown);
  }, [aiShown]);
  const error = state?.error ?? null;
  const aiMemory = state?.aiMemory ?? null;
  const consent = useMemo<ConsentAnswer>(
    () => ({
      agreed: true,
      copy_version: aiMemory ? CONSULT_CONSENT_MEMORY_COPY_VERSION : CONSULT_CONSENT_COPY_VERSION,
      agreed_at: new Date().toISOString(),
      text_sha256: aiMemory ? CONSENT_MEMORY_COPY_SHA256 : CONSENT_COPY_SHA256,
    }),
    // agreed_at is taken when box 1 is ticked; the version follows the box 2 text shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checked, aiMemory],
  );
  const blocked = error === 'version_mismatch';
  return (
    <BodyFrame
      props={props}
      header={header}
      footer={
        <>
          <CoachSharingNotice
            version={state?.coachSharing?.version ?? null}
            coachName={state?.coachSharing?.coachName}
            style={[s.mutedSmall, { marginBottom: 12 }]}
            testID="consent-coach-sharing"
          />
          <PrimaryButton
            label={props.screen.cta ?? 'Continue'}
            disabled={!checked || blocked}
            accessibilityHint={checked ? undefined : 'Tick the first box to continue'}
            onPress={() => onNext({ P0: already ? answers.P0 : consent }, aiTouched.current ? aiChecked : null)}
            testID="consult-continue"
          />
        </>
      }
    >
      {CONSENT_PARAGRAPHS.map((p) => (
        <Text key={p} style={[s.small, { marginBottom: 12 }]}>{p}</Text>
      ))}
      <Checkbox
        checked={checked}
        onToggle={() => setChecked((c) => !c)}
        label={CONSENT_CHECKBOX_LABEL}
        testID="consent-checkbox"
      />
      <Text style={[s.small, { marginTop: 20, marginBottom: 12 }]} testID="consent-ai-paragraph">
        {aiMemory ? aiMemory.paragraph.text : AI_CONSENT_PARAGRAPH}
      </Text>
      <Checkbox
        checked={aiChecked}
        onToggle={() => {
          aiTouched.current = true;
          setAiChecked((c) => !c);
        }}
        label={AI_CONSENT_CHECKBOX_LABEL}
        disabled={!aiReady}
        hint={aiReady ? undefined : 'Checking your saved choice'}
        testID="consent-ai-checkbox"
      />
      {state?.aiUnknown && !aiTouched.current ? (
        <Text style={[s.mutedSmall, { marginTop: 8 }]} accessibilityLiveRegion="polite" testID="consent-ai-unknown">
          {AI_CHOICE_UNKNOWN_LINE}
        </Text>
      ) : null}
      {state?.aiUnconfirmed && !aiChecked ? (
        <Text style={[s.mutedSmall, { marginTop: 8 }]} accessibilityLiveRegion="polite" testID="consent-ai-unconfirmed">
          {AI_WITHDRAW_UNCONFIRMED_LINE}
        </Text>
      ) : null}
      <Text style={[s.mutedSmall, { marginTop: 16 }]} testID="consent-footer">{CONSENT_FOOTER}</Text>
      {/* C-8 (operator 2026-10-01): the Privacy Policy, below the two boxes.
          Not part of the consent text or its hash; opening it sends nothing. */}
      <TextLink label="Privacy Policy" onPress={openPrivacyPolicy} testID="consent-privacy-link" role="link" />
      {error ? (
        <Text style={s.errorNote} accessibilityLiveRegion="polite" testID="consent-error">
          {CONSENT_ERROR_COPY[error]}
        </Text>
      ) : null}
    </BodyFrame>
  );
}
