/**
 * Coach consultation flow registry (prototype 77-85): order, chapters,
 * conditions, validation, resume and the wire payload. Pure functions; the
 * screen layer (src/screens/coach/consultation) decides which steps have a
 * component, so a step that is not built yet is skipped, never a dead end.
 */
import type {
  ClientsToday,
  CoachConsultAnswers,
  CoachProgress,
  CoachStepId,
  CoachingTouch,
  OptionItem,
  ProgrammingStyle,
  Specialty,
} from './types';

export const STEP_ORDER: readonly CoachStepId[] = ['K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8'];

/** Chapter of each framed step (K0 and K8 have no bar). K4 and K5 share chapter 4. */
const CHAPTER: Partial<Record<CoachStepId, CoachProgress['chapter']>> = {
  K1: 1,
  K2: 2,
  K3: 3,
  K4: 4,
  K5: 4,
  K6: 5,
  K7: 5,
};

export const NAME_MAX = 80;
export const BUSINESS_MAX = 80;
export const BIO_MAX = 280;
export const SPECIALTY_CAP = 5;

export const SPECIALTY_OPTIONS: readonly OptionItem<Specialty>[] = [
  { value: 'fat_loss', label: 'Fat loss' },
  { value: 'strength', label: 'Strength' },
  { value: 'muscle', label: 'Muscle gain' },
  { value: 'beginners', label: 'Beginners' },
  { value: 'older', label: 'Older adults' },
  { value: 'sports', label: 'Sports performance' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'nutrition', label: 'Nutrition habits' },
  { value: 'busy', label: 'Busy professionals' },
  { value: 'other', label: 'Something else' },
];

export const CLIENTS_TODAY_OPTIONS: readonly OptionItem<ClientsToday>[] = [
  { value: 'none', label: 'None yet' },
  { value: '1_10', label: '1 to 10' },
  { value: '11_25', label: '11 to 25' },
  { value: '26_50', label: '26 to 50' },
  { value: '50_plus', label: 'More than 50' },
];

export const COACHING_TOUCH_OPTIONS: readonly OptionItem<CoachingTouch>[] = [
  { value: 'close', label: 'Close guidance', sub: 'Frequent check-ins' },
  { value: 'balanced', label: 'Balanced', sub: 'A weekly check-in' },
  { value: 'light', label: 'Light touch', sub: 'Clients mostly self-direct' },
];

/** K5 (built by COACH-CONSULT-M2-134); listed here so drafts keep a valid answer. */
export const PROGRAMMING_STYLE_OPTIONS: readonly OptionItem<ProgrammingStyle>[] = [
  { value: 'own', label: 'I write my own' },
  { value: 'templates', label: 'I adapt templates' },
  { value: 'help', label: "I'd like help building them" },
];

export interface FlowContext {
  /** Steps that have a component (registry). */
  built: ReadonlySet<CoachStepId>;
  /** featureFlags.extensionImport (K7). */
  importOn: boolean;
}

export function isStepVisible(id: CoachStepId, a: CoachConsultAnswers, ctx: FlowContext): boolean {
  if (!ctx.built.has(id)) return false;
  if (id === 'K7') return ctx.importOn && a.clients_today !== undefined && a.clients_today !== 'none';
  return true;
}

export function visibleSteps(a: CoachConsultAnswers, ctx: FlowContext): CoachStepId[] {
  return STEP_ORDER.filter((id) => isStepVisible(id, a, ctx));
}

/** Next visible step, or null when `id` is the last (the flow completes). */
export function nextStep(id: CoachStepId, a: CoachConsultAnswers, ctx: FlowContext): CoachStepId | null {
  const from = STEP_ORDER.indexOf(id);
  return STEP_ORDER.slice(from + 1).find((s) => isStepVisible(s, a, ctx)) ?? null;
}

export function previousStep(id: CoachStepId, a: CoachConsultAnswers, ctx: FlowContext): CoachStepId | null {
  const from = STEP_ORDER.indexOf(id);
  const before = STEP_ORDER.slice(0, Math.max(from, 0)).filter((s) => isStepVisible(s, a, ctx));
  return before.length ? before[before.length - 1] : null;
}

/** The five-segment bar; null for K0 and K8. Position counts visible steps of the chapter. */
export function progressFor(id: CoachStepId, a: CoachConsultAnswers, ctx: FlowContext): CoachProgress | null {
  const chapter = CHAPTER[id];
  if (!chapter) return null;
  const inChapter = visibleSteps(a, ctx).filter((s) => CHAPTER[s] === chapter);
  const position = Math.max(inChapter.indexOf(id), 0) + 1;
  return { chapter, position, count: Math.max(inChapter.length, 1), total: 5 };
}

/** Width of each of the five segments, 0..1. */
export function segmentFill(p: CoachProgress): number[] {
  return [1, 2, 3, 4, 5].map((c) => (c < p.chapter ? 1 : c === p.chapter ? p.position / p.count : 0));
}

export function eyebrowFor(p: CoachProgress | null): string {
  return p ? `Your practice · ${p.chapter} of ${p.total}` : 'Your practice';
}

/** First name for K0's greeting: the cached first name, else the first word of the name. */
export function firstNameOf(user: { firstName?: string; name?: string } | null | undefined): string {
  const first = user?.firstName?.trim();
  if (first) return first;
  return user?.name?.trim().split(/\s+/)[0] ?? '';
}

/** K1 can continue: a name 1-80 and the optional fields inside their limits. */
export function cardValid(a: CoachConsultAnswers): boolean {
  const name = (a.display_name ?? '').trim();
  return (
    name.length >= 1 &&
    name.length <= NAME_MAX &&
    (a.business_name ?? '').trim().length <= BUSINESS_MAX &&
    (a.bio ?? '').trim().length <= BIO_MAX
  );
}

/** Toggle a specialty, never above the cap. */
export function toggleSpecialty(list: readonly Specialty[] | undefined, v: Specialty): Specialty[] {
  const cur = list ?? [];
  if (cur.includes(v)) return cur.filter((x) => x !== v);
  return cur.length >= SPECIALTY_CAP ? [...cur] : [...cur, v];
}

/** Required answers for completion (backend: display_name and clients_today). */
export function missingRequired(a: CoachConsultAnswers): Array<'display_name' | 'clients_today'> {
  const out: Array<'display_name' | 'clients_today'> = [];
  if (!cardValid(a)) out.push('display_name');
  if (!a.clients_today) out.push('clients_today');
  return out;
}

/** Where a missing answer is asked. */
export function stepForMissing(field: 'display_name' | 'clients_today'): CoachStepId {
  return field === 'display_name' ? 'K1' : 'K3';
}

const pick = <T extends string>(v: unknown, opts: readonly OptionItem<T>[]): T | undefined =>
  opts.some((o) => o.value === v) ? (v as T) : undefined;
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Keep only known keys and values (a draft or a server answer from another build). */
export function sanitizeAnswers(raw: unknown): CoachConsultAnswers {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const specialties = Array.isArray(r.specialties)
    ? Array.from(new Set(r.specialties.map((v) => pick(v, SPECIALTY_OPTIONS)).filter((v): v is Specialty => !!v))).slice(
        0,
        SPECIALTY_CAP,
      )
    : undefined;
  const out: CoachConsultAnswers = {
    display_name: str(r.display_name, NAME_MAX),
    business_name: str(r.business_name, BUSINESS_MAX),
    bio: str(r.bio, BIO_MAX),
    specialties,
    clients_today: pick(r.clients_today, CLIENTS_TODAY_OPTIONS),
    coaching_touch: pick(r.coaching_touch, COACHING_TOUCH_OPTIONS),
    programming_style: pick(r.programming_style, PROGRAMMING_STYLE_OPTIONS),
    link_shared: r.link_shared === true ? true : undefined,
    import_choice: r.import_choice === 'show_me' || r.import_choice === 'later' ? r.import_choice : undefined,
  };
  (Object.keys(out) as Array<keyof CoachConsultAnswers>).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

export function isStepId(v: unknown): v is CoachStepId {
  return typeof v === 'string' && (STEP_ORDER as readonly string[]).includes(v);
}

/** Wire body for PUT / complete: backend keys only ("" on an optional field = null). */
export function wireAnswers(a: CoachConsultAnswers): Record<string, unknown> {
  const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  const body: Record<string, unknown> = {
    business_name: opt(a.business_name),
    bio: opt(a.bio),
    specialties: a.specialties ?? [],
  };
  if (a.display_name !== undefined) body.display_name = a.display_name.trim();
  if (a.clients_today) body.clients_today = a.clients_today;
  body.coaching_touch = a.coaching_touch ?? null;
  body.programming_style = a.programming_style ?? null;
  return body;
}

/** Resume point: the saved step if still visible, else the first visible step at or before it. */
export function resumeStep(saved: CoachStepId | null | undefined, a: CoachConsultAnswers, ctx: FlowContext): CoachStepId {
  const steps = visibleSteps(a, ctx);
  if (!steps.length) return 'K0';
  if (saved && steps.includes(saved)) return saved;
  const idx = saved ? STEP_ORDER.indexOf(saved) : -1;
  const earlier = steps.filter((s) => STEP_ORDER.indexOf(s) <= idx);
  return earlier.length ? earlier[earlier.length - 1] : steps[0];
}
