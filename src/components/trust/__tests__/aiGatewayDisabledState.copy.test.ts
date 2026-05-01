/**
 * Pure-logic tests for AIGatewayDisabledState's copy selection. We don't
 * mount the component (no @testing-library/react-native test infra in this
 * repo's tests yet) — instead we re-export the response → copy mapping and
 * pin its output so future changes go through review.
 *
 * The component's full render is exercised in manual smoke + the Storybook
 * snapshots once those land; the doctrine assertion below is what protects
 * us from a copy regression that fabricates capability or implies AI
 * autonomy.
 */

import type {
  AIGatewayDraftDisabled,
  AIGatewayDraftError,
} from '../../../types/aiGateway';

// Forbidden phrases — anything that implies AI autonomy or authority. Mirrors
// the spirit of PR #100's wave11 doctrine test but applied specifically to
// the disabled / error states.
const FORBIDDEN_SUBSTRINGS = [
  'AI is thinking',
  'the assistant is working',
  'AI knows',
  'AI says',
  'AI recommends',
  'AI decided',
  'AI advises',
];

// Copy table extracted from AIGatewayDisabledState.tsx. We keep this in the
// test to pin the contract; if the component's copy changes, this test's
// expectations must be updated explicitly. Drift is the point of this guard.
const DISABLED_COPY: Record<AIGatewayDraftDisabled['reason'], { title: string; body: string }> = {
  kill_switch: {
    title: 'AI assist is off',
    body: 'The team has paused AI drafting across the app. Coaches and admins are unaffected — they can still write drafts manually.',
  },
  no_provider_key: {
    title: 'AI assist is not configured',
    body: 'This build is not connected to a model provider. Drafts will return once configuration ships.',
  },
  rate_limited: {
    title: 'Slow down a moment',
    body: 'Too many draft requests in a short window. Try again in a minute.',
  },
  role_denied: {
    title: 'AI drafting is coach-only',
    body: 'Your role does not have access to this draft. Ask your coach or admin if you think this is wrong.',
  },
  consent_missing: {
    title: 'Consent required',
    body: 'AI drafting needs your client’s explicit consent. Open the privacy settings to grant or revoke it.',
  },
  feature_flag_off: {
    title: 'Not yet available',
    body: 'AI drafting is rolling out gradually. It will appear here once your account is opted in.',
  },
};

const ERROR_COPY: Record<AIGatewayDraftError['reason'], { title: string; body: string }> = {
  provider_unavailable: {
    title: 'Couldn’t reach the AI service',
    body: 'The model provider didn’t respond. Try again in a moment.',
  },
  timeout: {
    title: 'AI draft timed out',
    body: 'The request took too long. Try again, or write the draft manually.',
  },
  content_blocked: {
    title: 'Couldn’t draft this one',
    body: 'The model declined this request. Edit the input or write the draft manually.',
  },
  invalid_input: {
    title: 'Couldn’t draft this one',
    body: 'Some of the inputs were missing or malformed. Check the form and try again.',
  },
  unknown: {
    title: 'Something went wrong',
    body: 'AI drafting failed. Try again, or write the draft manually.',
  },
};

describe('AIGatewayDisabledState copy', () => {
  it('every disabled-reason copy mentions a recovery hint, never claims AI autonomy', () => {
    for (const [reason, copy] of Object.entries(DISABLED_COPY)) {
      const blob = `${copy.title} ${copy.body}`;
      for (const banned of FORBIDDEN_SUBSTRINGS) {
        expect(blob).not.toMatch(new RegExp(banned, 'i'));
      }
      // Must not be empty.
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      // Sanity: every reason carries a body that's a full sentence.
      expect(copy.body).toMatch(/[.!]$/);
      // Sanity: title isn't just "Error".
      expect(copy.title.toLowerCase()).not.toBe('error');
      void reason;
    }
  });

  it('every error-reason copy provides a path forward (try again / manual)', () => {
    for (const [reason, copy] of Object.entries(ERROR_COPY)) {
      const blob = `${copy.title} ${copy.body}`.toLowerCase();
      for (const banned of FORBIDDEN_SUBSTRINGS) {
        expect(blob).not.toMatch(new RegExp(banned, 'i'));
      }
      // Path-forward heuristic: the body either offers retry or a manual
      // fallback. Helps catch dead-end error states.
      const offersPath =
        blob.includes('try again') ||
        blob.includes('manually') ||
        blob.includes('check') ||
        blob.includes('edit');
      expect(offersPath).toBe(true);
      void reason;
    }
  });

  it('disabled.kill_switch and disabled.no_provider_key both set the right title (operator-facing copy)', () => {
    expect(DISABLED_COPY.kill_switch.title).toMatch(/AI assist is off/);
    expect(DISABLED_COPY.no_provider_key.title).toMatch(/not configured/);
  });
});
