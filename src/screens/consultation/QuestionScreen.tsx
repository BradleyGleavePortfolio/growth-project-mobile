/**
 * QuestionScreen renders one consultation screen from its data definition.
 * The template id picks the body; copy, options and validation all come
 * from `lib/consultation/definitions.ts`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import * as Localization from 'expo-localization';
import { PRIVACY_POLICY_URL } from '../../config/env';
import { featureFlags } from '../../config/featureFlags';
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
  AI_CHOICE_UNKNOWN_LINE,
  AI_WITHDRAW_UNCONFIRMED_LINE,
  consentScreenCopy,
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
  /** AGEGATE16 age step (FIXAGE R4): its ways out, under B2 and on its stop screen. */
  escape?: (stopped: boolean) => React.ReactNode;
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
   * default); the P0 record then names consult-consent-v6 (or v6-coach-free).
   */
  consent?: {
    error: 'version_mismatch' | null;
    aiAllowed?: boolean;
    aiReady?: boolean;
    aiUnconfirmed?: boolean;
    aiUnknown?: boolean;
    aiMemory?: AiConsentUpgradeCopy | null;
    /** CRISIS-APP-COPY: the server answered with client-ai-v8 / v9, so P0 shows v8 and records v9 / v10. */
    aiCrisis?: boolean;
    /** CONSENT-M: the server answered with the Health-notes copies (b#1117), so P0 shows and records them. */
    aiHealth?: boolean;
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

/**
 * Owner pick MOCK-ONBQ option A, path op 1: the Quiet Tiles look on the
 * consultation questions that match onboarding questions 2 to 6. Behind
 * featureFlags.consultTilesV2 (off); answers, order, skips and saves are
 * unchanged either way.
 */
export const TILE_SCREENS: ReadonlySet<string> = new Set(['T1', 'B1', 'B2', 'B3', 'B4', 'N1', 'N2']);
export const tilesOn = (id: string): boolean => featureFlags.consultTilesV2 && TILE_SCREENS.has(id);

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
  const tiles = tilesOn(screen.id);

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
        <View accessibilityRole="radiogroup" style={{ gap: tiles ? 12 : 8 }}>
          {options.map((o) => (
            <OptionRow
              key={o.value}
              option={o}
              selected={value === o.value}
              tall={screen.template === 'yesno'}
              tiles={tiles}
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
                tiles={tiles}
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
  const tiles = tilesOn(screen.id);
  const parsed = parseIso(answers.B2);
  // FIXAGE2 R6: "only a date the client actually chose is ever saved as
  // their date of birth." No wheel starts chosen (a saved answer excepted);
  // there is no date, and Continue stays off, until all three are picked.
  const [y, setY] = useState<number | null>(parsed?.y ?? null);
  const [m, setM] = useState<number | null>(parsed?.m ?? null);
  const [d, setD] = useState<number | null>(parsed?.d ?? null);
  const isoOf = (ny: number | null, nm: number | null, nd: number | null) =>
    ny && nm && nd ? `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}` : undefined;
  const iso = isoOf(y, m, d);
  const draft = { ...answers, B2: iso };
  const v = validateScreen(screen, draft, now);
  // Prototype 45: an age under 16 leads to a calm, final stop screen (no
  // form, nothing saved) whose only action returns to the wheels.
  const minAge = screen.validation?.ageRange?.min ?? 16;
  const age = iso ? ageOn(iso, now) : NaN;
  const under = !Number.isNaN(age) && age < minAge;
  const [stopped, setStopped] = useState(false);
  if (stopped) {
    return (
      <Frame
        // FIXAGE2 R9: no top-bar Back; "Change my date of birth" is the same
        // action, so the stop screen shows five actions (training 6.2).
        onBack={null}
        onFinishLater={null}
        footer={<PrimaryButton label="Change my date of birth" onPress={() => setStopped(false)} testID="consult-under-age-change" />}
        testID="consult-screen-UNDER_AGE"
      >
        <View style={{ paddingTop: 96 }}>
          <Text style={s.eyebrow}>{screen.eyebrow}</Text>
          <Headline style={{ marginTop: 16 }}>{`TGP Fitness is for ages ${minAge} and up.`}</Headline>
          <Text style={[s.mutedSmall, { marginTop: 12 }]}>If the date was entered by mistake, go back and change it.</Text>
          {props.escape?.(true)}
        </View>
      </Frame>
    );
  }
  const commit = (ny: number | null, nm: number | null, nd: number | null) => {
    const next = isoOf(ny, nm, nd);
    if (next) onAnswer('B2', next);
  };
  return (
    <BodyFrame
      props={props}
      header={header}
      footer={
        <PrimaryButton
          label="Continue"
          disabled={!iso || (!v.valid && !under)}
          onPress={() => {
            if (!iso) return;
            if (under) setStopped(true);
            else onNext({ B2: iso });
          }}
          testID="consult-continue"
        />
      }
    >
      {/* Quiet Tiles: the three wheels sit in one cream card. */}
      <View style={[s.wheels, tiles && s.wheelCard]} testID={tiles ? 'consult-card-dob' : undefined}>
        <View style={[s.wheelCol, { flex: 1.6 }]}>
          <Wheel label="Birth month" values={MONTHS} value={m ? MONTHS[m - 1] : null} anchor={MONTHS[now.getMonth()]} onChange={(x) => { const nm = MONTHS.indexOf(x) + 1; setM(nm); commit(y, nm, d); }} testID="wheel-dob-month" />
        </View>
        <View style={[s.wheelCol, { flex: 0.8 }]}>
          <Wheel label="Birth day" values={range(1, 31)} value={d} anchor={Math.min(28, now.getDate())} onChange={(x) => { setD(x); commit(y, m, x); }} testID="wheel-dob-day" />
        </View>
        <View style={s.wheelCol}>
          <Wheel label="Birth year" values={range(now.getFullYear() - 100, now.getFullYear() - 10)} value={y} anchor={now.getFullYear() - 30} onChange={(x) => { setY(x); commit(x, m, d); }} testID="wheel-dob-year" />
        </View>
      </View>
      {iso && v.message && !under ? <Text style={s.errorNote} accessibilityLiveRegion="polite" testID="consult-validation">{v.message}</Text> : null}
      {props.escape?.(false)}
    </BodyFrame>
  );
}

function MeasureBody(props: BodyProps) {
  const { answers, onAnswer, onNext, header } = props;
  const tiles = tilesOn(props.screen.id);
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
      <UnitTabs unit={unit} tiles={tiles} onChange={(u) => { setUnit(u); commit({ unit: u }); }} />
      <View style={s.wheels}>
        <View style={[s.wheelCol, tiles && s.wheelCard]} testID={tiles ? 'consult-card-height' : undefined}>
          <Text style={[s.eyebrow, tiles && s.wheelCardLabel]}>Height</Text>
          {unit === 'imperial' ? (
            <Wheel label="Height" values={range(48, 90)} value={Math.min(90, Math.max(48, inches))} format={ftIn}
              onChange={(x) => { const cm = Math.round(x * 2.54 * 10) / 10; setHeightCm(cm); commit({ height_cm: cm }); }} testID="wheel-height" />
          ) : (
            <Wheel label="Height" values={range(122, 229)} value={Math.min(229, Math.max(122, Math.round(heightCm)))} format={(x) => `${x} cm`}
              onChange={(x) => { setHeightCm(x); commit({ height_cm: x }); }} testID="wheel-height" />
          )}
        </View>
        <View style={[s.wheelCol, tiles && s.wheelCard]} testID={tiles ? 'consult-card-weight' : undefined}>
          <Text style={[s.eyebrow, tiles && s.wheelCardLabel]}>Weight</Text>
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
  const tiles = tilesOn(screen.id);
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
      <View style={{ alignItems: tiles ? 'stretch' : 'center' }}>
        <View style={tiles ? s.wheelCard : { width: 220 }} testID={tiles ? 'consult-card-goal' : undefined}>
          <Text style={[s.eyebrow, tiles && s.wheelCardLabel]}>Goal weight</Text>
          {unit === 'imperial' ? (
            <Wheel label="Goal weight" values={range(70, 600)} value={Math.min(600, Math.max(70, lbs))} format={(x) => `${x} lb`} onChange={(x) => { setLbs(x); onAnswer('B4', x); }} testID="wheel-goal" />
          ) : (
            <Wheel label="Goal weight" values={range(32, 272)} value={Math.min(272, Math.max(32, kg))} format={(x) => `${x} kg`} onChange={(x) => { const lb = Math.round(x / 0.453592); setLbs(lb); onAnswer('B4', lb); }} testID="wheel-goal" />
          )}
        </View>
      </View>
      <Text style={s.softNote} accessibilityLiveRegion="polite" testID="goal-weight-note">{note}</Text>
    </BodyFrame>
  );
}

// Opus C-3: no "Nothing has been sent" here; chapter saves may already have
// landed when the server moves to a newer agreement.
/** Shown next to a disabled P0 Continue (box 1 may be below the fold). */
export const CONSENT_TICK_HINT = 'Tick the first box above to continue.';

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
  const { answers, onNext, header, consent: state, ctx } = props;
  // Owner 62: a client with no coach sees (and records) the coach-free text.
  const copy = consentScreenCopy(!!ctx?.coachless, !!state?.aiCrisis, !!state?.aiHealth);
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
      copy_version: aiMemory ? copy.memoryVersion : copy.version,
      agreed_at: new Date().toISOString(),
      text_sha256: aiMemory ? copy.memorySha256 : copy.sha256,
    }),
    // agreed_at is taken when box 1 is ticked; the version follows the box 2 text shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checked, aiMemory, copy.version, copy.memoryVersion],
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
          {/* SHOTS-134B 6: on a 360x800 phone box 1 sits below the fold, so a
              disabled Continue says why. Not part of the consent text or its hash. */}
          {!checked && !blocked ? (
            <Text style={[s.mutedSmall, { marginBottom: 12 }]} accessibilityLiveRegion="polite" testID="consent-tick-hint">
              {CONSENT_TICK_HINT}
            </Text>
          ) : null}
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
      {copy.paragraphs.map((p) => (
        <Text key={p} style={[s.small, { marginBottom: 12 }]}>{p}</Text>
      ))}
      <Checkbox
        checked={checked}
        onToggle={() => setChecked((c) => !c)}
        label={copy.box1Label}
        testID="consent-checkbox"
      />
      {/* W-CONSENT: a client with no coach is asked too, with why Roman waits for a coach. */}
      {copy.romanTitle ? (
        <>
          <Headline level="h2" style={{ marginTop: 28 }} testID="consent-roman-title">
            {copy.romanTitle}
          </Headline>
          <Text style={[s.body, { marginTop: 8 }]} testID="consent-roman-lead">{copy.romanLead}</Text>
        </>
      ) : null}
      <Text style={[s.small, { marginTop: copy.romanTitle ? 12 : 20, marginBottom: 12 }]} testID="consent-ai-paragraph">
        {aiMemory ? aiMemory.paragraph.text : copy.aiParagraph}
      </Text>
      <Checkbox
        checked={aiChecked}
        onToggle={() => {
          aiTouched.current = true;
          setAiChecked((c) => !c);
        }}
        label={copy.box2Label}
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
      <Text style={[s.mutedSmall, { marginTop: 16 }]} testID="consent-footer">{copy.footer}</Text>
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
