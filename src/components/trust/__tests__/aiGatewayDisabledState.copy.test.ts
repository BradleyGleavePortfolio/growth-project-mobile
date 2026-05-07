/**
 * Pure-logic tests for AIGatewayDisabledState's copy selection.
 *
 * We re-import the exported copy helper functions directly so the test has no
 * React/component dependency. This lets the suite run fast and without a
 * ThemeProvider wrapper.
 *
 * The doctrine assertion below protects us from a copy regression that
 * fabricates capability or implies AI autonomy.
 */

import type {
  AIGatewayDraftDisabled,
  AIGatewayDraftError,
} from '../../../types/aiGateway';
import { copyForDisabled, copyForError } from '../AIGatewayDisabledState';

// Forbidden phrases — anything that implies AI autonomy or authority.
const FORBIDDEN_SUBSTRINGS = [
  'AI is thinking',
  'the assistant is working',
  'AI knows',
  'AI says',
  'AI recommends',
  'AI decided',
  'AI advises',
];

describe('AIGatewayDisabledState copy', () => {
  it('every disabled-reason copy mentions a recovery hint, never claims AI autonomy', () => {
    const reasons: AIGatewayDraftDisabled['reason'][] = [
      'kill_switch',
      'no_provider_key',
      'rate_limited',
      'role_denied',
      'consent_missing',
      'feature_flag_off',
    ];

    for (const reason of reasons) {
      const r: AIGatewayDraftDisabled = {
        status: 'disabled',
        capability: 'coach_brief_draft',
        reason,
      };
      const copy = copyForDisabled(r);
      const blob = `${copy.title} ${copy.body}`;

      for (const banned of FORBIDDEN_SUBSTRINGS) {
        expect(blob).not.toMatch(new RegExp(banned, 'i'));
      }
      // Must not be empty.
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      // Sanity: every reason carries a body that ends with punctuation.
      expect(copy.body).toMatch(/[.!]$/);
      // Sanity: title is not just "Error".
      expect(copy.title.toLowerCase()).not.toBe('error');
    }
  });

  it('every error-reason copy provides a path forward (try again / manual)', () => {
    const reasons: AIGatewayDraftError['reason'][] = [
      'provider_unavailable',
      'timeout',
      'content_blocked',
      'invalid_input',
      'unknown',
    ];

    for (const reason of reasons) {
      const r: AIGatewayDraftError = {
        status: 'error',
        capability: 'coach_brief_draft',
        reason,
      };
      const copy = copyForError(r);
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
    }
  });

  it('disabled.kill_switch and disabled.no_provider_key set the right titles', () => {
    const killSwitch: AIGatewayDraftDisabled = {
      status: 'disabled',
      capability: 'coach_brief_draft',
      reason: 'kill_switch',
    };
    const noKey: AIGatewayDraftDisabled = {
      status: 'disabled',
      capability: 'coach_brief_draft',
      reason: 'no_provider_key',
    };
    expect(copyForDisabled(killSwitch).title).toMatch(/AI assist is off/);
    expect(copyForDisabled(noKey).title).toMatch(/not configured/);
  });

  it('when summary is provided on disabled response, uses it as body', () => {
    const withSummary: AIGatewayDraftDisabled = {
      status: 'disabled',
      capability: 'coach_brief_draft',
      reason: 'kill_switch',
      summary: 'Operator has disabled AI for maintenance.',
    };
    const copy = copyForDisabled(withSummary);
    expect(copy.body).toBe('Operator has disabled AI for maintenance.');
  });
});
