/**
 * romanVoice — the ONLY client-side Roman-voiced strings the chat surface
 * renders. Every string below is taken from the locked identity spec
 * (BradleyGleavePortfolio/tgp-agent-context strategy/AI_BUTLER_ROMAN_IDENTITY_SPEC.md),
 * cited per string with its §section. The Phase 1 backend serves NO greeting /
 * empty / error PROSE for the chat surface — the controller returns only
 * session/message views and SSE chunks (roman.controller.ts), and there are no
 * participant-facing Roman surface keys. So these surfaces consume the spec's
 * sample-copy patterns directly, per the operator FACE+VOICE rule (avatar
 * renders beside each of these strings via RomanGreeting / the screen header).
 *
 * Voice-contract compliance (spec §1.1-§1.6), verified against §1.4 forbidden
 * moves: no emoji, no exclamation points (the one rationed exclamation is a
 * milestone instrument not used on a chat empty/error state), no contractions
 * in the default tone, no hype words, no slang. Assistant REPLY prose is NOT
 * here — it comes from the backend SSE `done` chunk verbatim (romanApi).
 */

/**
 * The host surface a greeting is rendered on — mirrors ROMAN_SURFACES
 * (roman.dto.ts L18) so the empty-state copy can speak the right register.
 */
export type RomanGreetingSurface = 'client' | 'coach';

export interface RomanGreetingInput {
  /** Which surface is rendering — selects the client vs coach register. */
  surface: RomanGreetingSurface;
  /** True the very first time Roman is opened (no prior session history). */
  isFirstOpen: boolean;
  /** Authenticated user's first name, when known. */
  firstName?: string | null;
}

/**
 * Empty-chat greeting, aware of BOTH the surface and whether this is the first
 * time Roman has been opened (R1 UX finding U1). The four registers are taken
 * verbatim from the identity spec:
 *
 *   - First open (client OR coach): the §2.1 first-launch self-introduction —
 *     `"Good day. My name is Roman. I will be looking after things here.
 *     Whenever you need me, I am present."` This is Roman's defining first
 *     impression and must NOT be replaced by returning-user copy.
 *   - Returning client (named): §2.2 "App boot / returning user" Default —
 *     `"Welcome back, {firstName}. Everything is in order. Where shall we
 *     begin?"`
 *   - Returning client (nameless): the §2.1 nameless ambient register, trimmed
 *     to the greeting clause, to avoid an empty "Welcome back, ." render.
 *   - Returning coach: the §2.3 coach operational register —
 *     `"Good morning, {coachName}. I am ready. What needs attention?"` When the
 *     coach name is unknown the nameless variant `"I am ready. What needs
 *     attention?"` is used so we never render "Good morning, .".
 */
export function romanGreeting(input: RomanGreetingInput): string {
  const name = (input.firstName ?? '').trim();

  if (input.isFirstOpen) {
    // identity spec §2.1 first-launch self-introduction (both surfaces).
    return 'Good day. My name is Roman. I will be looking after things here. Whenever you need me, I am present.';
  }

  if (input.surface === 'coach') {
    // identity spec §2.3 coach operational register.
    if (name === '') {
      return 'I am ready. What needs attention?';
    }
    return `Good morning, ${name}. I am ready. What needs attention?`;
  }

  // Returning client — identity spec §2.2 Default.
  if (name === '') {
    // Nameless ambient register — identity spec §2.1 greeting clause.
    return 'Good day. Everything is in order. Where shall we begin?';
  }
  return `Welcome back, ${name}. Everything is in order. Where shall we begin?`;
}

/**
 * One-line sub-copy under the greeting, inviting the first message. Derived
 * from the identity spec §2.1 Default presence line ("Whenever you need me, I
 * am present.") — restated as the empty-composer prompt with no new claim.
 */
export const ROMAN_GREETING_SUBTITLE =
  'Whenever you need me, I am present. Send a message to begin.';

/**
 * Transient send/system failure (retry available). Source: identity spec §2.10
 * "Generic error / system failure", Default variant — `"That request did not
 * complete. I will try again."`
 */
export const ROMAN_ERROR_TRANSIENT = 'That request did not complete. I will try again.';

/**
 * Hard failure after retries are exhausted. Source: identity spec §2.10 Error
 * variant — `"That request did not complete, and my attempts to retry have not
 * succeeded either. I have logged the matter. Please try again in a few
 * minutes."`
 */
export const ROMAN_ERROR_EXHAUSTED =
  'That request did not complete, and my attempts to retry have not succeeded either. I have logged the matter. Please try again in a few minutes.';

/**
 * "Roman unavailable" state — backend feature gate is off (404 on every
 * /roman route, roman-feature.guard.ts). This is not a crash and not a hard
 * data-loss failure, so per §1.6 Roman states the fact plainly without
 * apology. Phrased from the §1.6 failure-tone pattern ("state the fact, state
 * the remedy, and stop") and the backend's own ROMAN_UNAVAILABLE copy ("Roman
 * is not available right now.", roman.service.ts L353/L359).
 */
export const ROMAN_UNAVAILABLE_TITLE = 'Roman is not available right now.';
export const ROMAN_UNAVAILABLE_BODY =
  'I am not able to attend to this just yet. I will be here when the service is ready.';

/**
 * Offline state. §1.6 failure tone — fact then remedy, no panic. The dry
 * self-deprecating network quip is a §2.10-permitted option but is held back
 * here so the offline state stays plainly reassuring (one quip per ~8 messages
 * ceiling, §1.5).
 */
export const ROMAN_OFFLINE_TITLE = 'I cannot reach the service.';
export const ROMAN_OFFLINE_BODY =
  'There appears to be no connection at the moment. I will try again once it returns.';

/**
 * Rate-limited (backend @Throttle / per-tier cap → 429). Calm backoff copy in
 * the §1.6 register: states the fact, states the remedy (wait), and stops.
 * `seconds`, when known from the Retry-After header, is folded into the remedy
 * clause; otherwise the generic measured line is used.
 */
export function romanRateLimited(seconds?: number): string {
  if (typeof seconds === 'number' && seconds > 0) {
    const unit = seconds === 1 ? 'second' : 'seconds';
    return `A moment, if you would. Send your next message in about ${seconds} ${unit}.`;
  }
  return 'A moment, if you would. Send your next message again shortly.';
}

/** Accessibility label announced while Roman's reply is being prepared (§2.9 readback register). */
export const ROMAN_TYPING_A11Y_LABEL = 'Roman is typing';
/** Visible "preparing a reply" line — plain, composed (§1.1). */
export const ROMAN_TYPING_LABEL = 'Roman is preparing a reply';

/**
 * Interrupted-reply note (R1 code finding F7 / UX finding P2). The backend
 * persisted a partial turn on client disconnect (toMessageView.interrupted,
 * roman.controller.ts L210). Roman states the fact and the remedy in his own
 * voice (§1.6 failure tone — state the fact, state the remedy, and stop)
 * rather than the prior generic system line. Lives here so all Roman prose is
 * sourced from one cited module, never hardcoded in a component.
 */
export const ROMAN_INTERRUPTED_NOTE =
  'This reply was interrupted. Send it again, and I will continue.';

/**
 * Failed-send remedy (R1 UX finding P1). The app does NOT auto-retry — it
 * waits for the user to send again — so the copy must name the REAL remedy
 * (user re-sends) rather than promising Roman will retry on his own. §1.6
 * failure tone: state the fact, state the actual remedy, and stop.
 */
export const ROMAN_SEND_FAILED =
  'That request did not complete. Send it once more, and I will try again.';

/**
 * "Loading earlier messages" footer prose (R1 UX finding P2 — generic copy on
 * a Roman surface). Roman-voiced and rendered beside his face so the line is
 * not disembodied. Derived from the §2.9 readback register ("I am gathering
 * …") with no new claim.
 */
export const ROMAN_LOADING_OLDER = 'I am gathering the earlier messages.';

/** Accessibility prefix used when announcing a freshly arrived Roman reply (§2.9 readback). */
export const ROMAN_REPLY_ANNOUNCE_PREFIX = 'Roman said: ';
