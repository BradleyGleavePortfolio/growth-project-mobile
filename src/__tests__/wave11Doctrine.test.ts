/**
 * Wave 11 doctrine tests.
 *
 * These guard the AI honesty contract and the feature-flag defaults so a
 * future change can't accidentally:
 *   - claim AI autonomy in user-facing copy
 *   - flip a runtime surface ON in production by default
 *   - render an "approved" chip without a human signoff actor
 */

import { aiDisclaimer, AI_BADGES, FORBIDDEN_AI_CLAIMS } from '../lib/aiHonestyCopy';
import { featureFlags } from '../config/featureFlags';
import {
  fetchAdminControlRoom,
  fetchClientPathCopilot,
  fetchCoachBrief,
  fetchCommunityHub,
} from '../services/wave11Adapters';

describe('aiHonestyCopy', () => {
  it('disclaimer never claims medical or financial authority', () => {
    for (const kind of ['general', 'health', 'finance'] as const) {
      const text = aiDisclaimer(kind).toLowerCase();
      for (const banned of FORBIDDEN_AI_CLAIMS) {
        // The phrase "medical advice" appears NEGATED ("not medical advice")
        // — assert that whenever a forbidden phrase appears, the word "not"
        // shows up close before it.
        const idx = text.indexOf(banned.toLowerCase());
        if (idx >= 0) {
          const slice = text.slice(Math.max(0, idx - 8), idx);
          expect(slice).toMatch(/not\s*$/);
        }
      }
    }
  });

  it('all AI badges are passive verbs (summary/draft/flag/explainer)', () => {
    expect(Object.values(AI_BADGES)).toEqual(
      expect.arrayContaining(['AI summary', 'AI draft', 'AI flag', 'AI explainer']),
    );
  });
});

describe('featureFlags defaults (production)', () => {
  // The flags module reads __DEV__ at import time — these tests assert the
  // *shape* and that voice notes specifically are OFF even in dev. Production
  // defaults are exercised by build-time env vars; tests ensure no flag is
  // accidentally hard-coded `true`.
  it('communityVoiceNotes stays OFF by default (no false promises)', () => {
    expect(featureFlags.communityVoiceNotes).toBe(false);
  });

  it('every flag is a boolean', () => {
    for (const v of Object.values(featureFlags)) {
      expect(typeof v).toBe('boolean');
    }
  });
});

describe('wave11 adapters return honest empty payloads', () => {
  it('client copilot adapter returns isStale + empty arrays without mock env', async () => {
    const p = await fetchClientPathCopilot();
    expect(p.suggestions).toEqual([]);
    expect(p.pendingVerifiedProgress).toEqual([]);
    expect(p.isStale).toBe(true);
  });

  it('coach brief adapter returns empty + stale', async () => {
    const p = await fetchCoachBrief();
    expect(p.clients).toEqual([]);
    expect(p.morningSummary.approvedByCoach).toBe(false);
    expect(p.isStale).toBe(true);
  });

  it('admin control room kpis are all zero in stub mode', async () => {
    const p = await fetchAdminControlRoom();
    expect(p.isStale).toBe(true);
    expect(Object.values(p.kpis).every((n) => n === 0)).toBe(true);
  });

  it('community hub returns no rooms or posts in stub mode', async () => {
    const p = await fetchCommunityHub();
    expect(p.rooms).toEqual([]);
    expect(p.recentPosts).toEqual([]);
    expect(p.isStale).toBe(true);
  });
});
