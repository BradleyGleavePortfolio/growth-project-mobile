/**
 * wave11Adapters.ts — Mock-safe adapters for Wave 11 runtime surfaces.
 *
 * The backend endpoints these adapters describe are NOT YET LIVE. Each
 * function returns a shaped, empty payload with `isStale: true` so the UI
 * renders an honest empty state rather than fake data.
 *
 * When the real endpoints ship, replace the function bodies with `api.get(...)`
 * calls; the call sites do not change because they consume the typed payload.
 *
 * Importantly, we do NOT seed mock content in production builds — the empty
 * shape is what callers receive. In dev, set `EXPO_PUBLIC_WAVE11_MOCK=true`
 * to opt into a small fixture so screens have something to render.
 */

import type {
  AdminControlRoomPayload,
  ClientPathCopilotPayload,
  CoachBriefPayload,
  CommunityHubPayload,
} from '../types/wave11';

const ALLOW_MOCK =
  process.env.NODE_ENV !== 'production' &&
  process.env.EXPO_PUBLIC_WAVE11_MOCK?.toLowerCase() === 'true';

const NOW = () => new Date().toISOString();

// ─── Client Path Copilot ──────────────────────────────────────────────────────

export async function fetchClientPathCopilot(): Promise<ClientPathCopilotPayload> {
  if (ALLOW_MOCK) {
    return {
      suggestions: [
        {
          id: 'mock-sug-1',
          createdAt: NOW(),
          headline: 'You hit protein 5 days running — nice cadence',
          body:
            'Your AI Copilot noticed five consecutive days at or above your protein floor. ' +
            'This is an AI summary — your coach decides whether to adjust your target.',
          topic: 'nutrition',
          pinnedByCoach: false,
          requiresCoachApproval: false,
        },
      ],
      pendingVerifiedProgress: [],
      isStale: false,
      generatedAt: NOW(),
    };
  }
  // Empty, honest shape until the live endpoint lands.
  return {
    suggestions: [],
    pendingVerifiedProgress: [],
    isStale: true,
    generatedAt: NOW(),
  };
}

// ─── Coach Brief ──────────────────────────────────────────────────────────────

export async function fetchCoachBrief(): Promise<CoachBriefPayload> {
  if (ALLOW_MOCK) {
    return {
      morningSummary: {
        aiDraft:
          'AI draft: 3 clients logged yesterday, 1 missed a check-in. Two verified-progress ' +
          'submissions are waiting for your signoff.',
        approvedByCoach: false,
      },
      clients: [],
      generatedAt: NOW(),
      isStale: false,
    };
  }
  return {
    morningSummary: { aiDraft: '', approvedByCoach: false },
    clients: [],
    generatedAt: NOW(),
    isStale: true,
  };
}

// ─── Admin Control Room ───────────────────────────────────────────────────────

export async function fetchAdminControlRoom(): Promise<AdminControlRoomPayload> {
  return {
    alerts: [],
    kpis: {
      activeCoaches: 0,
      activeClients: 0,
      pendingSignoffs: 0,
      flaggedItems: 0,
      disputedItems: 0,
    },
    generatedAt: NOW(),
    isStale: true,
  };
}

// ─── Private Community Hub ────────────────────────────────────────────────────

export async function fetchCommunityHub(): Promise<CommunityHubPayload> {
  return {
    rooms: [],
    recentPosts: [],
    generatedAt: NOW(),
    isStale: true,
  };
}
