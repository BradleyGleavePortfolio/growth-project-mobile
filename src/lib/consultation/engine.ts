/**
 * Consultation engine: pure functions over the screen definitions.
 *
 * Nothing here touches React, storage or the network, so every rule
 * (conditions, validation, navigation order, chapter progress, resume) is
 * unit-tested directly in `__tests__/consultationEngine.test.ts`.
 */
import { SCREENS, SCREENING_KEYS, TOTAL_CHAPTERS } from './definitions';
import { CONSULT_CONSENT_COPY_VERSION } from './consentVersion';
import type {
  AnswerValue,
  Answers,
  ChapterId,
  ChapterProgress,
  Condition,
  OptionDef,
  ScreenDef,
  ValidationResult,
} from './types';

export function answerKeyOf(screen: ScreenDef): string {
  return screen.answerKey ?? screen.id;
}

export function hasValue(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

export function evaluateCondition(cond: Condition, answers: Answers): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, answers));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, answers));
  const v = answers[cond.key];
  if ('equals' in cond) return v === cond.equals;
  if ('notEquals' in cond) return v !== cond.notEquals;
  if ('includes' in cond) return Array.isArray(v) && v.includes(cond.includes);
  return false;
}

export function isVisible(screen: ScreenDef, answers: Answers): boolean {
  return !screen.showWhen || evaluateCondition(screen.showWhen, answers);
}

export function visibleScreens(answers: Answers, screens: readonly ScreenDef[] = SCREENS): ScreenDef[] {
  return screens.filter((s) => isVisible(s, answers));
}

export function detailShown(screen: ScreenDef, answers: Answers): boolean {
  return !!screen.detail && evaluateCondition(screen.detail.when, answers);
}

export function anyScreeningYes(answers: Answers): boolean {
  return SCREENING_KEYS.some((k) => answers[k] === 'yes');
}

/** Whole years between an ISO date (YYYY-MM-DD) and `now`. NaN when invalid. */
export function ageOn(dobIso: string, now: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobIso);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return NaN;
  }
  let age = now.getFullYear() - y;
  const beforeBirthday =
    now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Multi-select toggle honouring the exclusive option and the cap. */
export function toggleSelection(
  current: readonly string[],
  value: string,
  opts: { exclusive?: string; max?: number } = {},
): string[] {
  if (current.includes(value)) return current.filter((v) => v !== value);
  if (opts.exclusive && value === opts.exclusive) return [value];
  const base = opts.exclusive ? current.filter((v) => v !== opts.exclusive) : [...current];
  if (opts.max && base.length >= opts.max) return base;
  return [...base, value];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function weekdayName(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

/** C1 options: today, tomorrow, and the two days after, as ISO dates. */
export function firstSessionOptions(now: Date): OptionDef[] {
  return [0, 1, 2, 3].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const label =
      offset === 0 ? 'Today' : offset === 1 ? `Tomorrow, ${weekdayName(d)}` : weekdayName(d);
    return { value: isoDate(d), label };
  });
}

export function optionsFor(screen: ScreenDef, now: Date): OptionDef[] {
  if (screen.dynamicOptions === 'firstSessionDays') return firstSessionOptions(now);
  return screen.options ?? [];
}

/** Default answer applied the first time a screen is shown (C1: tomorrow). */
export function defaultAnswerFor(screen: ScreenDef, now: Date): AnswerValue | undefined {
  if (screen.defaultValue === 'tomorrow') return firstSessionOptions(now)[1].value;
  return undefined;
}

/** Validate the current screen. `valid: true` means Continue may be pressed. */
export function validateScreen(screen: ScreenDef, answers: Answers, now: Date = new Date()): ValidationResult {
  const rule = screen.validation ?? {};
  const key = answerKeyOf(screen);
  const v = answers[key];

  if (screen.template === 'intro' || screen.template === 'message') return { valid: true };

  if (screen.template === 'consent') {
    return isConsentAnswerCurrent(answers.P0)
      ? { valid: true }
      : { valid: false, message: 'Tick the box to continue.' };
  }

  if (rule.required && !hasValue(v)) return { valid: false };

  // Cached or server answers must be one of the screen's options (Sol C-01):
  // a corrupted or outdated value sends the client back to the screen rather
  // than turning into a server 400.
  if (hasValue(v) && (screen.template === 'rows' || screen.template === 'yesno' || screen.template === 'chips')) {
    const allowed = new Set(optionsFor(screen, now).map((o) => o.value));
    const values = Array.isArray(v) ? v : [v];
    if (screen.template !== 'chips' || screen.single) {
      if (Array.isArray(v) || typeof v !== 'string' || !allowed.has(v)) return { valid: false };
    } else if (!Array.isArray(v) || !values.every((x) => typeof x === 'string' && allowed.has(x))) {
      return { valid: false };
    }
  }

  if (screen.template === 'dob' && hasValue(v)) {
    const age = ageOn(String(v), now);
    if (Number.isNaN(age)) return { valid: false, message: 'Choose a real date.' };
    if (rule.ageRange && age < rule.ageRange.min) {
      return { valid: false, message: `This consultation is for ages ${rule.ageRange.min} and over.` };
    }
    if (rule.ageRange && age > rule.ageRange.max) {
      return { valid: false, message: 'Check the year you were born.' };
    }
  }

  if (screen.template === 'measure' && hasValue(v)) {
    const m = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as { height_cm?: unknown; weight_lbs?: unknown };
    const h = m.height_cm;
    const w = m.weight_lbs;
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 120 || h > 230) return { valid: false };
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 70 || w > 600) return { valid: false };
  }

  if (Array.isArray(v)) {
    if (rule.minSelections && v.length < rule.minSelections) return { valid: false };
    if (rule.maxSelections && v.length > rule.maxSelections) {
      return { valid: false, message: 'Up to three.' };
    }
  } else if (!screen.single && screen.template === 'chips' && rule.minSelections && hasValue(v)) {
    return { valid: false };
  }

  if (screen.detail && detailShown(screen, answers)) {
    const d = screen.detail;
    if (d.chipsKey && d.chipsRequired && !hasValue(answers[d.chipsKey])) {
      return { valid: false, message: 'Choose at least one area.' };
    }
    if (d.chipsKey && d.chipsOptions && hasValue(answers[d.chipsKey])) {
      const allowed = new Set(d.chipsOptions.map((o) => o.value));
      const cur = answers[d.chipsKey];
      if (!Array.isArray(cur) || !cur.every((x) => typeof x === 'string' && allowed.has(x))) {
        return { valid: false, message: 'Choose at least one area.' };
      }
    }
    if (d.textKey) {
      const t = answers[d.textKey];
      const max = d.textMaxLength ?? rule.detailMaxLength;
      if (typeof t === 'string' && max && t.length > max) {
        return { valid: false, message: `Up to ${max} characters.` };
      }
    }
  }

  return { valid: true };
}

/**
 * True only for an affirmative P0 record that matches the copy version this
 * build displays (Sol A-03). Anything else (missing, malformed, not agreed,
 * an older or newer copy version, an unreadable timestamp) is not consent:
 * the client is sent back to P0 with the box unticked.
 */
export function isConsentAnswerCurrent(v: AnswerValue | undefined): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as { agreed?: unknown; copy_version?: unknown; agreed_at?: unknown };
  if (c.agreed !== true) return false;
  if (c.copy_version !== CONSULT_CONSENT_COPY_VERSION) return false;
  if (typeof c.agreed_at !== 'string' || Number.isNaN(Date.parse(c.agreed_at))) return false;
  return true;
}

/** Whether a screen with no answer yet may be passed (Skip / optional). */
export function isSatisfied(screen: ScreenDef, answers: Answers, now: Date = new Date()): boolean {
  const key = answerKeyOf(screen);
  if (screen.skippable && !hasValue(answers[key])) return true;
  return validateScreen(screen, answers, now).valid;
}

export function nextScreenId(currentId: string, answers: Answers): string | null {
  const vis = visibleScreens(answers);
  const i = vis.findIndex((s) => s.id === currentId);
  if (i < 0) return vis[0]?.id ?? null;
  return vis[i + 1]?.id ?? null;
}

export function previousScreenId(currentId: string, answers: Answers): string | null {
  const vis = visibleScreens(answers);
  const i = vis.findIndex((s) => s.id === currentId);
  if (i <= 0) return null;
  return vis[i - 1].id;
}

/** True when moving forward from `currentId` leaves its chapter (save point). */
export function endsChapter(currentId: string, answers: Answers): boolean {
  const vis = visibleScreens(answers);
  const i = vis.findIndex((s) => s.id === currentId);
  if (i < 0) return false;
  const next = vis[i + 1];
  return !next || next.chapter !== vis[i].chapter;
}

export function lastScreenOfChapter(chapter: ChapterId, answers: Answers): string | null {
  const inCh = visibleScreens(answers).filter((s) => s.chapter === chapter);
  return inCh.length ? inCh[inCh.length - 1].id : null;
}

export function firstScreenOfChapter(chapter: ChapterId, answers: Answers): string | null {
  return visibleScreens(answers).find((s) => s.chapter === chapter)?.id ?? null;
}

export function chapterProgress(currentId: string, answers: Answers): ChapterProgress {
  const vis = visibleScreens(answers);
  const screen = vis.find((s) => s.id === currentId) ?? SCREENS.find((s) => s.id === currentId);
  const chapter = (screen?.chapter ?? 0) as ChapterId;
  const inCh = vis.filter((s) => s.chapter === chapter);
  const position = Math.max(1, inCh.findIndex((s) => s.id === currentId) + 1);
  return { chapter, position, count: Math.max(1, inCh.length), totalChapters: TOTAL_CHAPTERS };
}

/** Segment fill (0-1) for each of the 8 chapters, as the progress bar draws it. */
export function progressSegments(p: ChapterProgress): number[] {
  return Array.from({ length: p.totalChapters }, (_, k) => {
    const c = k + 1;
    if (c < p.chapter) return 1;
    if (c === p.chapter) return p.position / p.count;
    return 0;
  });
}

/** First visible screen whose answer is still required and missing or invalid. */
export function firstIncompleteScreenId(answers: Answers, now: Date = new Date()): string | null {
  for (const s of visibleScreens(answers)) {
    if (s.template === 'intro' || s.template === 'message') continue;
    if (!isSatisfied(s, answers, now)) return s.id;
  }
  return null;
}

export function requiredComplete(answers: Answers, now: Date = new Date()): boolean {
  return firstIncompleteScreenId(answers, now) === null;
}

/** Chapters (1-8) whose visible screens are all satisfied. */
export function completedChapters(answers: Answers, now: Date = new Date()): ChapterId[] {
  const done: ChapterId[] = [];
  for (let c = 1; c <= TOTAL_CHAPTERS; c += 1) {
    const ch = c as ChapterId;
    const inCh = visibleScreens(answers).filter((s) => s.chapter === ch);
    const answeredSomething = inCh.some(
      (s) => s.template === 'message' || hasValue(answers[answerKeyOf(s)]) || s.skippable,
    );
    if (inCh.length && answeredSomething && inCh.every((s) => s.template === 'message' || isSatisfied(s, answers, now))) {
      done.push(ch);
    }
  }
  return done;
}

/**
 * Where to resume. The saved screen wins when it is still visible, unless an
 * earlier required screen is now incomplete (for example after a condition
 * changed), in which case the earlier screen is returned. A finished
 * questionnaire resumes at the summary (`'SUM'`).
 */
export function resumeScreenId(
  savedScreenId: string | null | undefined,
  answers: Answers,
  now: Date = new Date(),
): string {
  const vis = visibleScreens(answers);
  const firstGap = firstIncompleteScreenId(answers, now);
  const savedIdx = savedScreenId ? vis.findIndex((s) => s.id === savedScreenId) : -1;
  if (savedScreenId === 'SUM') return firstGap ?? 'SUM';
  if (savedIdx < 0) {
    // Nothing answered yet: start at the welcome.
    if (Object.keys(answers).length === 0) return vis[0].id;
    return firstGap ?? 'SUM';
  }
  if (!firstGap) return vis[savedIdx].id;
  const gapIdx = vis.findIndex((s) => s.id === firstGap);
  return gapIdx < savedIdx ? firstGap : vis[savedIdx].id;
}

/**
 * The answer set sent to the server. Answers belonging to hidden screens and
 * to collapsed detail blocks are dropped, so a changed answer (S3 from home
 * to gym, T3 from yes to no) never leaves stale data behind.
 */
export function answersForSave(answers: Answers): Answers {
  const out: Answers = {};
  for (const s of SCREENS) {
    if (!isVisible(s, answers)) continue;
    const key = answerKeyOf(s);
    if (answers[key] !== undefined) out[key] = answers[key];
    if (s.detail && detailShown(s, answers)) {
      if (s.detail.chipsKey && answers[s.detail.chipsKey] !== undefined) {
        out[s.detail.chipsKey] = answers[s.detail.chipsKey];
      }
      if (s.detail.textKey && hasValue(answers[s.detail.textKey])) {
        out[s.detail.textKey] = answers[s.detail.textKey];
      }
    }
  }
  return out;
}

/** Fill `{coach}`, `{Coach}`, `{first}` and `{greeting}` in definition copy. */
export interface CopyContext {
  coachName?: string | null;
  firstName?: string | null;
  now?: Date;
}

export function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function fillCopy(text: string, ctx: CopyContext): string {
  const coach = ctx.coachName?.trim() || '';
  const first = ctx.firstName?.trim() || '';
  return text
    .replace(/\{coach\}/g, coach || 'your coach')
    .replace(/\{Coach\}/g, coach || 'Your coach')
    .replace(/\{greeting\}/g, greetingFor(ctx.now ?? new Date()))
    .replace(/,\n\{first\}\./g, first ? `,\n${first}.` : '.')
    .replace(/, \{first\}\./g, first ? `, ${first}.` : '.')
    .replace(/\{first\}/g, first || 'there');
}
