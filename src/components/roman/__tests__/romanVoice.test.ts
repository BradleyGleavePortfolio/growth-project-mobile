/**
 * romanVoice — voice-contract / forbidden-move sweep over EVERY client-side
 * Roman string the chat surface renders.
 *
 * The identity spec (AI_BUTLER_ROMAN_IDENTITY_SPEC.md §1.3-§1.4 / §5 anti-
 * patterns) forbids, in user-facing Roman copy:
 *   - emoji (§1.4: "No emoji. Ever. None."),
 *   - exclamation points (§1.4: the single rationed exclamation is a milestone
 *     instrument and never appears on a chat empty/error/typing state),
 *   - hype words, corporate-speak, startup slang, fitness-bro clichés, and
 *     Gen-Z slang (§1.3 / §1.4 / §5 banned lists).
 *
 * This suite enumerates every exported string (and the rendered output of the
 * two string-builders across their name / seconds branches) and asserts none of
 * them trip a forbidden move. The assistant REPLY prose is intentionally NOT
 * covered here — it comes verbatim from the backend SSE `done` chunk, not this
 * module.
 */
import {
  romanGreeting,
  romanRateLimited,
  ROMAN_ERROR_EXHAUSTED,
  ROMAN_ERROR_TRANSIENT,
  ROMAN_GREETING_SUBTITLE,
  ROMAN_INTERRUPTED_NOTE,
  ROMAN_LOADING_OLDER,
  ROMAN_OFFLINE_BODY,
  ROMAN_OFFLINE_TITLE,
  ROMAN_REPLY_ANNOUNCE_PREFIX,
  ROMAN_SEND_FAILED,
  ROMAN_TYPING_A11Y_LABEL,
  ROMAN_TYPING_LABEL,
  ROMAN_UNAVAILABLE_BODY,
  ROMAN_UNAVAILABLE_TITLE,
} from '../romanVoice';

/** Every literal Roman string + both builder branches, with a human label. */
const STRINGS: Array<{ label: string; value: string }> = [
  { label: 'greeting (first open, client)', value: romanGreeting({ surface: 'client', isFirstOpen: true, firstName: 'Sam' }) },
  { label: 'greeting (first open, coach)', value: romanGreeting({ surface: 'coach', isFirstOpen: true, firstName: 'Sam' }) },
  { label: 'greeting (returning client, named)', value: romanGreeting({ surface: 'client', isFirstOpen: false, firstName: 'Sam' }) },
  { label: 'greeting (returning client, nameless)', value: romanGreeting({ surface: 'client', isFirstOpen: false, firstName: null }) },
  { label: 'greeting (returning client, empty name)', value: romanGreeting({ surface: 'client', isFirstOpen: false, firstName: '   ' }) },
  { label: 'greeting (returning coach, named)', value: romanGreeting({ surface: 'coach', isFirstOpen: false, firstName: 'Sam' }) },
  { label: 'greeting (returning coach, nameless)', value: romanGreeting({ surface: 'coach', isFirstOpen: false, firstName: null }) },
  { label: 'greeting subtitle', value: ROMAN_GREETING_SUBTITLE },
  { label: 'error transient', value: ROMAN_ERROR_TRANSIENT },
  { label: 'error exhausted', value: ROMAN_ERROR_EXHAUSTED },
  { label: 'send failed', value: ROMAN_SEND_FAILED },
  { label: 'interrupted note', value: ROMAN_INTERRUPTED_NOTE },
  { label: 'loading older', value: ROMAN_LOADING_OLDER },
  { label: 'unavailable title', value: ROMAN_UNAVAILABLE_TITLE },
  { label: 'unavailable body', value: ROMAN_UNAVAILABLE_BODY },
  { label: 'offline title', value: ROMAN_OFFLINE_TITLE },
  { label: 'offline body', value: ROMAN_OFFLINE_BODY },
  { label: 'typing a11y', value: ROMAN_TYPING_A11Y_LABEL },
  { label: 'typing label', value: ROMAN_TYPING_LABEL },
  { label: 'rate limited (with seconds)', value: romanRateLimited(12) },
  { label: 'rate limited (no seconds)', value: romanRateLimited() },
  { label: 'rate limited (1 second)', value: romanRateLimited(1) },
];

// §1.3 / §1.4 / §5 banned vocabulary — matched case-insensitively as whole words.
const BANNED_WORDS = [
  // §1.3 corporate-speak
  'synergy', 'leverage', 'circle back', 'touch base', 'bandwidth', 'action item', "let's align",
  // §1.3 hype words
  'amazing', 'incredible', 'awesome', 'epic', 'insane', 'game-changer',
  // §1.4 startup slang
  'ship it', 'mvp', 'north star', 'low-hanging fruit',
  // §1.4 fitness-bro clichés
  'crushing it', "let's go", 'beast mode', 'no pain no gain', 'grind', "let's get it",
  // §1.4 Gen-Z slang
  'slay', 'no cap', 'rizz', 'lowkey', "it's giving",
];

// Pictographic emoji ranges (covers the common emoji blocks). Each range is its
// own alternation branch with the `u` flag so no combining marks are mixed into
// a single character class — that mixing is exactly what eslint's
// `no-misleading-character-class` rule flags. Variation selectors
// (U+FE00–U+FE0F), which are combining marks, are matched as their own branch.
const EMOJI_RE = new RegExp(
  [
    '[\\u{1F300}-\\u{1FAFF}]',
    '[\\u{2600}-\\u{27BF}]',
    '[\\u{2190}-\\u{21FF}]',
    '[\\u{2B00}-\\u{2BFF}]',
    '[\\u{1F000}-\\u{1F02F}]',
    '[\\u{1F1E6}-\\u{1F1FF}]',
    '[\\u{FE00}-\\u{FE0F}]',
  ].join('|'),
  'u',
);

describe('romanVoice — every client Roman string passes the §1.4 forbidden-move sweep', () => {
  it.each(STRINGS)('"$label" contains no emoji', ({ value }) => {
    expect(EMOJI_RE.test(value)).toBe(false);
  });

  it.each(STRINGS)('"$label" contains no exclamation point', ({ value }) => {
    expect(value).not.toContain('!');
  });

  it.each(STRINGS)('"$label" contains no banned hype / slang / corporate word', ({ value }) => {
    const lower = value.toLowerCase();
    for (const word of BANNED_WORDS) {
      expect(lower).not.toContain(word.toLowerCase());
    }
  });

  it.each(STRINGS)('"$label" is non-empty and trimmed', ({ value }) => {
    expect(value.length).toBeGreaterThan(0);
    expect(value).toBe(value.trim());
  });
});

describe('romanVoice — greeting interpolation (surface + first-open aware)', () => {
  it('uses the §2.1 self-introduction on first open, on BOTH surfaces', () => {
    expect(romanGreeting({ surface: 'client', isFirstOpen: true, firstName: 'Sam' })).toContain('My name is Roman');
    expect(romanGreeting({ surface: 'coach', isFirstOpen: true, firstName: 'Sam' })).toContain('My name is Roman');
  });

  it('uses the named §2.2 returning register on the client surface', () => {
    const g = romanGreeting({ surface: 'client', isFirstOpen: false, firstName: 'Sam' });
    expect(g).toContain('Sam');
    expect(g).toMatch(/^Welcome back, Sam\./);
  });

  it('falls back to the nameless §2.1 register (never "Welcome back, .") for a nameless returning client', () => {
    expect(romanGreeting({ surface: 'client', isFirstOpen: false, firstName: null })).not.toMatch(/Welcome back,\s*\./);
    expect(romanGreeting({ surface: 'client', isFirstOpen: false, firstName: '  ' })).not.toMatch(/Welcome back,\s*\./);
  });

  it('uses the coach operational §2.3 register on the coach surface (never the client copy)', () => {
    const named = romanGreeting({ surface: 'coach', isFirstOpen: false, firstName: 'Sam' });
    expect(named).toMatch(/^Good morning, Sam\./);
    expect(named).toContain('What needs attention');
    expect(named).not.toContain('Welcome back');
    const nameless = romanGreeting({ surface: 'coach', isFirstOpen: false, firstName: null });
    expect(nameless).not.toMatch(/Good morning,\s*\./);
    expect(nameless).toContain('What needs attention');
  });
});

describe('romanVoice — reply announce prefix (concatenation fragment)', () => {
  // The prefix is composed with backend reply text at runtime, so it carries a
  // deliberate trailing space and is exempt from the trimmed sweep. It must
  // still respect the voice contract (no emoji / no exclamation).
  it('has a trailing separator space and no forbidden moves', () => {
    expect(ROMAN_REPLY_ANNOUNCE_PREFIX).toBe('Roman said: ');
    expect(ROMAN_REPLY_ANNOUNCE_PREFIX).not.toContain('!');
    expect(EMOJI_RE.test(ROMAN_REPLY_ANNOUNCE_PREFIX)).toBe(false);
  });
});

describe('romanVoice — rate-limit copy', () => {
  it('folds known seconds into the remedy clause with correct pluralisation', () => {
    expect(romanRateLimited(12)).toContain('12 seconds');
    expect(romanRateLimited(1)).toContain('1 second');
    expect(romanRateLimited(1)).not.toContain('1 seconds');
  });

  it('uses the generic measured line when seconds are unknown', () => {
    expect(romanRateLimited()).toMatch(/shortly/);
  });
});
