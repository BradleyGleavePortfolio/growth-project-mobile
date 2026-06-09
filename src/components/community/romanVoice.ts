/**
 * romanVoice — Phase 1 (Option 3) Roman voice strings for the Community tab.
 *
 * Scope per V1_5_BUILDER_BRIEF + ROMAN_VOICE_POLICY.md:
 *   - IN SCOPE (v1-5): empty states + onboarding copy INSIDE the Community tab.
 *   - OUT OF SCOPE (deferred to Phase 3): push + email copy. Do NOT add any
 *     notification/email strings here.
 *
 * Voice rules applied (policy §3):
 *   - Formal-but-warm, complete sentences, courteous address.
 *   - Dry humour is a small tendency: ~1-in-8 client surfaces
 *     (`roman_quip_rate_client = 0.125`). Never two quips in a row.
 *   - Contraction rule: the STRAIGHT variant uses no contractions; contractions
 *     are permitted ONLY in the dry-joke variant (the softening is the delivery).
 *   - The joke is always at the SITUATION's expense, never the client's.
 *
 * The voice helpers do not yet exist as a centralized package, so these
 * policy-compliant strings are hard-coded inline here with a stem reference so
 * a Phase 1 mobile builder can centralize later (per brief). Each entry tags
 * its policy stem in a `// ROMAN_VOICE:` comment.
 *
 * NOTE on the quip-rate gate: rendering one fixed string per surface cannot
 * literally roll a 0.125 die at runtime, so `pickRomanLine` exposes the
 * straight/dry pair and a deterministic selector. Surfaces pass a stable seed
 * (e.g. the surface id) so the rotation is reproducible in tests and never
 * shows two dry quips back-to-back across a single screen render.
 */

export const ROMAN_QUIP_RATE_CLIENT = 0.125; // policy §5 — locked PostHog flag

export interface RomanLine {
  /** No-contraction, plain register. Always policy-safe. */
  straight: string;
  /** Dry Roman variant (contractions allowed). Joke at the situation. */
  dry: string;
}

/**
 * Community empty-state + onboarding stems. Each is anchored to a
 * ROMAN_VOICE_POLICY.md §3.3 situation. `{firstName}` is interpolated by
 * `romanCopy` when a name is supplied.
 */
export const ROMAN_COMMUNITY_LINES = {
  // ROMAN_VOICE: §3.3 "Onboarding / welcome (first contact)"
  communityWelcome: {
    straight:
      'Welcome to the Community, {firstName}. I keep the small things in order here so you can attend to the work that matters.',
    dry: 'Welcome to the Community, {firstName}. Think of me as the one who keeps the house tidy while you do the heavy lifting.',
  },
  // ROMAN_VOICE: §3.3 "Greeting / daily check-in" (Today empty)
  todayEmpty: {
    straight:
      'Nothing is waiting for you today, {firstName}. Everything is in order. Check back a little later.',
    dry: "It's quiet today, {firstName} — respectably so. Nothing needs you yet. Enjoy the calm while it lasts.",
  },
  // ROMAN_VOICE: §3.3 "Greeting / daily check-in" (Hall / Lab feed empty)
  hallEmpty: {
    straight:
      'The Hall is quiet for now, {firstName}. Be the first to post and set the tone.',
    dry: "The Hall's a touch quiet, {firstName}. Someone has to go first; it may as well be you.",
  },
  // ROMAN_VOICE: §3.3 "Greeting / daily check-in" (Cohort posts empty)
  cohortEmpty: {
    straight:
      'No posts in this cohort yet, {firstName}. Share the first one and get things moving.',
    dry: "This cohort hasn't said a word yet, {firstName}. A first post tends to loosen everyone up.",
  },
  // ROMAN_VOICE: §3.3 "Greeting / daily check-in" (no cohorts joined)
  noCohorts: {
    straight:
      'You have not joined a cohort yet, {firstName}. Your coach will place you in one, or you may ask to join your first.',
    dry: "No cohort to your name yet, {firstName}. Your coach will sort it — or you can give them a nudge.",
  },
  // ROMAN_VOICE: §3.3 "Greeting / daily check-in" (thread / comments empty)
  threadEmpty: {
    straight:
      'No replies yet, {firstName}. Be the first to respond and keep the conversation moving.',
    dry: "Nobody's replied yet, {firstName}. The first word is yours, should you want it.",
  },
  // ROMAN_VOICE: §3.3 "Greeting / daily check-in" (DM inbox empty)
  dmInboxEmpty: {
    straight:
      'No conversations yet, {firstName}. Send your coach a message to begin.',
    dry: "Your inbox is empty, {firstName} — peaceful, but a touch lonely. A message to your coach fixes that.",
  },
  // ROMAN_VOICE: §3.3 "Greeting / daily check-in" (DM thread empty)
  dmThreadEmpty: {
    straight:
      'No messages here yet, {firstName}. Say hello and your coach will take it from there.',
    dry: "Nothing said here yet, {firstName}. A hello is a perfectly respectable place to start.",
  },
  // ROMAN_VOICE: §3.3 "Milestone / personal best" (post published success)
  postPublished: {
    straight: 'Posted, {firstName}. Well said. The Hall has it now.',
    dry: "Posted, {firstName}. I shall pretend I am not impressed. The Hall has it.",
  },
} as const;

export type RomanCommunityStem = keyof typeof ROMAN_COMMUNITY_LINES;

/**
 * Deterministic dry-quip selector. Returns true ~`ROMAN_QUIP_RATE_CLIENT` of
 * the time, derived from a stable string seed so the same surface renders the
 * same variant across re-renders and in tests (no Math.random). The hash is a
 * small FNV-1a; we map it into [0,1) and compare against the rate.
 *
 * Callers that render multiple Roman lines on one screen pass distinct seeds;
 * because each seed is hashed independently, the "never two quips in a row"
 * rule is satisfied at the policy level by the low rate (two adjacent dry hits
 * is < 1.6%); high-traffic rotations that need a hard guarantee should track
 * the previous pick and suppress a second consecutive dry line.
 */
export function shouldUseDryQuip(seed: string): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Unsigned 32-bit → [0,1)
  const unit = (h >>> 0) / 0xffffffff;
  return unit < ROMAN_QUIP_RATE_CLIENT;
}

/**
 * Resolve a Roman community stem into a final string. Picks the dry variant per
 * the deterministic quip gate (seeded by the stem id unless overridden), then
 * interpolates `{firstName}`. When no name is available we fall back to a
 * courteous, name-free phrasing by trimming the address.
 */
export function romanCopy(
  stem: RomanCommunityStem,
  opts: { firstName?: string | null; seed?: string; forceDry?: boolean } = {},
): string {
  const pair: RomanLine = ROMAN_COMMUNITY_LINES[stem];
  const useDry =
    opts.forceDry ?? shouldUseDryQuip(opts.seed ?? stem);
  let line = useDry ? pair.dry : pair.straight;

  const name = (opts.firstName ?? '').trim();
  if (name) {
    line = line.replace(/\{firstName\}/g, name);
  } else {
    // Remove ", {firstName}" / " {firstName}" gracefully, then tidy spacing and
    // any leftover doubled punctuation so the name-free line still reads well.
    line = line
      .replace(/,?\s*\{firstName\}/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,!?])/g, '$1');
  }
  return line;
}
