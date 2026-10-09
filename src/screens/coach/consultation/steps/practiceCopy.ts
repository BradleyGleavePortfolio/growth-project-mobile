/** K5-K8 (prototype 82-85) copy and pure rules, tested alone. No app first person outside Roman; no exclamation marks. */
import { SPECIALTY_OPTIONS } from '../../../../lib/coachConsultation/flow';

/** K5 Programming style (prototype 82); the rows are PROGRAMMING_STYLE_OPTIONS (flow.ts). */
export const K5_COPY = {
  question: 'How do you usually build programs?',
  skip: 'Skip',
} as const;

/** K6 Your personal link (prototype 83). */
export const K6_COPY = {
  question: 'Your personal link.',
  roman: 'Anyone who opens this joins your roster directly.',
  share: 'Share my link',
  copy: 'Copy link',
  copied: 'Copied',
  later: 'Later',
  loading: 'Loading your link',
  retry: 'Try again',
} as const;

/** K7 Import offer (prototype 84). Rendered only when the importer flag is on. */
export const K7_COPY = {
  question: 'Bring your existing clients over?',
  // The Settings row is labelled "Import my records" (coach SettingsScreen).
  why: 'You can do this later from Settings > Import my records.',
  cta: 'Show me how',
  later: 'Do this later',
} as const;

/** K8 Practice ready (prototype 85). */
export const K8_COPY = {
  question: 'Your practice is ready.',
  cardLabel: 'Your card',
  specialtiesLabel: 'You specialise in',
  linkLabel: 'Your link',
  linkReady: 'Your link is ready to share.',
  linkInSettings: 'Your link is in Settings > Invite Codes.',
  roman: 'Next is your Clients page. Share your link there to bring in your first client.',
  cta: 'Go to my clients',
} as const;

/** The share sheet message: the coach's real join link. */
export function shareMessage(url: string): string {
  return `Join my coaching on The Growth Project: ${url}`;
}

/** The link as the prototype prints it: no scheme, no trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** "Strength, fat loss and beginners." First label kept, the rest lower-cased (K2 labels have no acronyms). */
export function joinSentence(labels: readonly string[]): string {
  const parts = labels.map((l) => l.trim()).filter(Boolean).map((l, i) => (i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1)));
  if (parts.length === 0) return '';
  return `${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}.`;
}

/** "Jordan Reyes, Reyes Strength." or "Jordan Reyes." without a business name. */
export function cardSentence(name: string | null | undefined, business: string | null | undefined): string {
  const n = (name ?? '').trim();
  const b = (business ?? '').trim();
  if (!n && !b) return '';
  const body = n && b ? `${n}, ${b}` : n || b;
  return /[.?!]$/.test(body) ? body : `${body}.`;
}

/** K2 labels (SPECIALTY_OPTIONS) in the order the coach chose them; unknown keys are dropped. */
export function specialtyLabels(keys: readonly string[] | null | undefined): string[] {
  return (keys ?? [])
    .map((k) => SPECIALTY_OPTIONS.find((o) => o.value === k)?.label)
    .filter((l): l is string => !!l);
}

export interface SummarySection {
  key: 'card' | 'specialties' | 'link';
  label: string;
  sentence: string;
}

/** K8 summary sections, in prototype order; an empty section is left out. */
export function practiceSummary(input: {
  name?: string | null;
  business?: string | null;
  specialtyLabels?: readonly string[];
  linkLoaded?: boolean;
}): SummarySection[] {
  const out: SummarySection[] = [];
  const card = cardSentence(input.name, input.business);
  if (card) out.push({ key: 'card', label: K8_COPY.cardLabel, sentence: card });
  const spec = joinSentence(input.specialtyLabels ?? []);
  if (spec) out.push({ key: 'specialties', label: K8_COPY.specialtiesLabel, sentence: spec });
  // "Ready" only when K6 showed the link; otherwise point to where it always is.
  out.push({ key: 'link', label: K8_COPY.linkLabel, sentence: input.linkLoaded ? K8_COPY.linkReady : K8_COPY.linkInSettings });
  return out;
}
