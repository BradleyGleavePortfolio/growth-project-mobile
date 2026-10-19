/**
 * The coach AI credit pool words the owner approved on 10-13: CREDIT-W
 * (CREDITPLAN Concept 1) in the CREDIT-S look (S3 Concierge, words under
 * CREDIT-SW). Verbatim; recovered from the owner's shots and listed in the
 * CREDITBUILD PR body ("Approved wording (recovered)"). Change none of them
 * without the owner. Pure; tested alone.
 */
import { formatCents, type CoachAIBudgetResponse } from '../../../api/types/coachAIBudget';
import { renewalDay } from '../../../screens/coach/settings/AICreditsRow';

/** "Your AI credits." page in the coach consultation (KC, after K6/K7). */
export const CREDIT_SETUP_COPY = {
  title: 'Your AI credits.',
  cta: 'Continue',
} as const;

/** The ink statement card: small label over the big amount. */
export const CREDIT_USAGE_LABEL = 'AI Usage:';

/** N7: shown only once backend #1016 (no daily Roman number for coaches) is live. */
export const CREDIT_ROMAN_ASK = 'Ask me as often as you like. Every conversation uses your AI credits.';

/** The explainer rows (label, then the line). */
export const CREDIT_ROWS = {
  usesLabel: 'What uses them',
  uses: 'Roman and AI features, for you and your clients.',
  runOutLabel: 'If they run out',
  runOut: 'Roman and AI features pause for you and your clients until they renew. Everything else keeps working.',
  /** Builds that sell credit packs. */
  addLabel: 'Adding more',
  add: 'Tap Buy more credits on your Money page. Credit you buy and do not use carries over.',
  /** Builds that do not sell credit packs. */
  findLabel: 'Where to find them',
  find: 'Always on your Money page.',
} as const;

/** The row on "Your practice is ready." (K8). */
export const K8_CREDITS_LABEL = 'AI credits';

/** "$125 every month, on your Money page." from the pool's base allowance. */
export function k8CreditsSentence(baseCents: number): string {
  return `${formatCents(baseCents)} every month, on your Money page.`;
}

/** "$0 / $125": used of everything in the pool this month (base plus packs). */
export function usageAmount(b: Pick<CoachAIBudgetResponse, 'used_displayed_cents' | 'total_displayed_cents'>): string {
  return `${formatCents(b.used_displayed_cents)} / ${formatCents(b.total_displayed_cents)}`;
}

/** "Renews Nov 1." (the UTC day the period ends, as Settings shows it), or null. */
export function renewsLine(periodEnd: string): string | null {
  const day = renewalDay(periodEnd);
  return day ? `Renews ${day}.` : null;
}

export type CreditGuideRow = { key: 'uses' | 'runOut' | 'add' | 'find'; label: string; text: string };

/** The three setup rows: the last one depends on whether this build sells packs. */
export function setupRows(packsSold: boolean): CreditGuideRow[] {
  return [
    { key: 'uses', label: CREDIT_ROWS.usesLabel, text: CREDIT_ROWS.uses },
    { key: 'runOut', label: CREDIT_ROWS.runOutLabel, text: CREDIT_ROWS.runOut },
    packsSold
      ? { key: 'add', label: CREDIT_ROWS.addLabel, text: CREDIT_ROWS.add }
      : { key: 'find', label: CREDIT_ROWS.findLabel, text: CREDIT_ROWS.find },
  ];
}
