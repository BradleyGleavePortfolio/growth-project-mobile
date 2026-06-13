/**
 * romanP3FlagOff — proves the P3 Roman surfaces are fully contained when the
 * master `featureFlags.romanChat` flag is OFF and the two backend-authority
 * gates (`romanCheckInBackendLive`, `romanStreakBackendLive`) are also OFF —
 * the production default posture (P2-G-02).
 *
 * "Contained" means: with the flags off, none of the eight P3 Roman surfaces
 * mount. Roman must never appear before his flag is deliberately turned on, and
 * the two proxy-signal surfaces (§2.4 check-in, §2.7 streak) must stay hidden
 * even with `romanChat` on until their backend-authority gate is flipped too.
 *
 * Two layers, mirroring romanP3HostWiring.test.tsx:
 *   1. RENDER — CoachBriefScreen renders cleanly in a unit test, so with every
 *      flag off we mount it and assert the non-Roman fallback header shows and
 *      NO Roman testIDs (`roman-brief-card`, `roman-brief-avatar`, the §2.4 /
 *      §2.5 notices) are in the tree.
 *   2. STATIC GUARD — the chart/sqlite/navigator-heavy hosts (ProgressScreen,
 *      WorkoutScreen, ActiveWorkoutScreen, CoachEarningsScreen) are impractical
 *      to fully render, so each P3 surface's render is pinned to live BEHIND a
 *      `featureFlags.romanChat` guard (and, for the two proxy surfaces, behind
 *      the matching backend-live gate). A surface rendered unconditionally, or
 *      gated on only the backend-live flag without `romanChat`, fails here.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import type { CoachBriefPayload, CoachBriefClientCard, VerifiedProgressItem } from '../../../types/wave11';

// Every Roman-relevant flag OFF — the production default. coachBrief stays ON
// so the brief screen renders its content (the fallback), not the preview lock,
// which is the meaningful flag-off case for the §2.3 surface.
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    coachBrief: true,
    romanChat: false,
    romanCheckInBackendLive: false,
    romanStreakBackendLive: false,
  },
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'c1', email: 'm@x.io', firstName: 'Marcus' }),
}));

const mockFetchCoachBrief = jest.fn();
jest.mock('../../../services/wave11Adapters', () => ({
  fetchCoachBrief: () => mockFetchCoachBrief(),
}));

import CoachBriefScreen from '../../../screens/coach/CoachBriefScreen';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
function readSrc(...rel: string[]): string {
  return fs.readFileSync(path.join(ROOT, 'src', ...rel), 'utf8');
}
const PROGRESS = readSrc('screens', 'client', 'ProgressScreen.tsx');
const WORKOUT = readSrc('screens', 'client', 'WorkoutScreen.tsx');
const ACTIVE = readSrc('screens', 'client', 'ActiveWorkoutScreen.tsx');
const EARNINGS = readSrc('screens', 'coach', 'payments', 'CoachEarningsScreen.tsx');
const BRIEF = readSrc('screens', 'coach', 'CoachBriefScreen.tsx');

function vp(over: Partial<VerifiedProgressItem>): VerifiedProgressItem {
  return {
    id: 'vp1',
    kind: 'check_in_consistency',
    label: 'Weekly check-in',
    submittedAt: '2026-06-09T07:00:00.000Z',
    submittedBy: { id: 'u1', kind: 'client', displayName: 'Dana' },
    signoffStatus: 'pending',
    ...over,
  };
}
function card(over: Partial<CoachBriefClientCard>): CoachBriefClientCard {
  return {
    clientId: 'c1',
    clientDisplayName: 'Dana',
    aiSummary: 'summary',
    aiFlags: [],
    todos: [],
    ...over,
  } as CoachBriefClientCard;
}
function payload(over: Partial<CoachBriefPayload> = {}): CoachBriefPayload {
  return {
    morningSummary: { aiDraft: 'draft', approvedByCoach: false },
    clients: [],
    generatedAt: '2026-06-09T08:00:00.000Z',
    isStale: false,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — RENDER: CoachBriefScreen with romanChat OFF shows the fallback only
// ─────────────────────────────────────────────────────────────────────────────
describe('§2.3 CoachBriefScreen with romanChat OFF mounts the non-Roman fallback, never Roman', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders CoachBriefHeaderFallback and NO Roman brief card / avatar', async () => {
    mockFetchCoachBrief.mockResolvedValue(
      payload({ clients: [card({ clientDisplayName: 'A' }), card({ clientDisplayName: 'B' })] }),
    );
    const { getByTestId, queryByTestId } = render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('coach-brief-header-fallback')).toBeTruthy());
    // The Roman voiced+face delivery must NOT be mounted with the flag off.
    expect(queryByTestId('roman-brief-card')).toBeNull();
    expect(queryByTestId('roman-brief-avatar')).toBeNull();
  });

  it('the §2.4 check-in notice and §2.5 new-client notice do NOT mount, even with a pending claim present', async () => {
    // A real pending check-in claim is present in the payload; with romanChat
    // (and romanCheckInBackendLive) OFF the §2.4 notice must still not appear.
    mockFetchCoachBrief.mockResolvedValue(
      payload({ clients: [card({ latestVerifiedProgress: vp({ signoffStatus: 'pending' }) })] }),
    );
    const { getByTestId, queryByTestId } = render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('coach-brief-header-fallback')).toBeTruthy());
    expect(queryByTestId('roman-checkin-card')).toBeNull();
    expect(queryByTestId('roman-newclient-card')).toBeNull();
    expect(queryByTestId('roman-brief-card')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — STATIC GUARD: every P3 surface render is behind featureFlags.romanChat
// ─────────────────────────────────────────────────────────────────────────────
describe('P3 surfaces are gated behind featureFlags.romanChat in their hosts', () => {
  it('§2.3 brief card mounts only inside the featureFlags.romanChat branch', () => {
    // The brief card is the consequent of a `featureFlags.romanChat ?` ternary,
    // with the non-Roman fallback as the alternate.
    expect(BRIEF).toMatch(/featureFlags\.romanChat \?[\s\S]*roman-brief-card/);
    expect(BRIEF).toContain('coach-brief-header-fallback');
  });

  it('§2.4 check-in notice is gated on romanChat AND romanCheckInBackendLive', () => {
    expect(BRIEF).toMatch(
      /featureFlags\.romanChat && featureFlags\.romanCheckInBackendLive && checkInClient/,
    );
  });

  it('§2.5 new-client notice is gated on romanChat', () => {
    expect(BRIEF).toMatch(/featureFlags\.romanChat && newClient/);
  });

  it('§2.7 streak card is gated on romanChat AND romanStreakBackendLive', () => {
    expect(PROGRESS).toMatch(
      /featureFlags\.romanChat && featureFlags\.romanStreakBackendLive && streakTier !== null/,
    );
  });

  it('§2.8 workout-complete card is gated on romanChat', () => {
    expect(WORKOUT).toMatch(/featureFlags\.romanChat && showWorkoutComplete/);
  });

  it('§2.9 voice-log readback is gated on romanChat', () => {
    expect(ACTIVE).toMatch(/featureFlags\.romanChat && lastCompletedSet/);
  });

  it('§2.10 workout error banner is gated on romanChat', () => {
    expect(WORKOUT).toMatch(/featureFlags\.romanChat \?\s*\(\s*<RomanErrorBanner/);
  });

  it('§2.12 payout notice is gated on romanChat', () => {
    expect(EARNINGS).toMatch(
      /featureFlags\.romanChat &&\s*data\.lastPayoutAmountCents != null/,
    );
  });

  it('the two backend-authority gates default OFF unconditionally (not isDev)', () => {
    const FLAGS = readSrc('config', 'featureFlags.ts');
    expect(FLAGS).toMatch(/romanCheckInBackendLive:\s*readFlag\(\s*'EXPO_PUBLIC_FF_ROMAN_CHECKIN_BACKEND_LIVE',\s*false,?\s*\)/);
    expect(FLAGS).toMatch(/romanStreakBackendLive:\s*readFlag\(\s*'EXPO_PUBLIC_FF_ROMAN_STREAK_BACKEND_LIVE',\s*false,?\s*\)/);
    expect(FLAGS).toMatch(/romanChat:\s*readFlag\(\s*'EXPO_PUBLIC_FF_ROMAN_CHAT',\s*false\s*\)/);
  });
});
