/**
 * slaCopy — v2-2 (R1 fixer, M-NEW optional P2): short SLA explainability
 * microcopy for the coach message-detail surface.
 *
 * The message-detail view receives only the derived `sla_state` (the FLAT
 * message-view envelope intentionally omits the elapsed/threshold inputs the
 * inbox snapshot carries). Rather than fabricate a precise countdown we cannot
 * honestly compute from that shape, this maps the bounded `sla_state` to a
 * calm, human explainer — so a coach understands WHY the SLA chip is the colour
 * it is without us inventing numbers. If the full snapshot (with `elapsed_ms` +
 * thresholds) is available the caller can pass it to get a precise tail.
 *
 * Pure + deterministic; trivially unit-testable.
 */
import type { CoachSlaState } from '../../../api/coachCommunityApi';

/** Headline explainer per SLA state (no fabricated numbers). */
const SLA_EXPLAINER: Record<CoachSlaState, string> = {
  within: 'Within your response window.',
  warning: 'Approaching your response window.',
  breached: 'Past your response window.',
};

/**
 * Compose the SLA explainer line for the detail surface. When a full snapshot
 * (elapsed + soft target) is supplied we append an honest "Xh waiting" tail
 * derived from `elapsed_ms`; otherwise we return the bounded-state explainer
 * alone. Returns an empty string for a settled (`replied`) thread, signalled by
 * a null `slaState`, so the caller can omit the line.
 */
export function formatSlaExplainer(
  slaState: CoachSlaState | null,
  snapshot?: { elapsed_ms: number } | null,
): string {
  if (slaState == null) return '';
  const head = SLA_EXPLAINER[slaState];
  if (snapshot != null && snapshot.elapsed_ms > 0) {
    const hours = Math.floor(snapshot.elapsed_ms / (60 * 60 * 1000));
    if (hours >= 1) return `${head} ${hours}h waiting.`;
    const mins = Math.floor(snapshot.elapsed_ms / (60 * 1000));
    if (mins >= 1) return `${head} ${mins}m waiting.`;
  }
  return head;
}
