// Phase 7C — Leaderboard API client.
//
// Wraps:
//   GET  /me/leaderboard        — fetch the ranked roster leaderboard
//   POST /me/leaderboard/opt-in — toggle opt-in and set display name
//
// Privacy:
//   * Combined scores are integers [0, 100]. Never raw weight or finance data.
//   * Display names are coach-roster visible only; never platform-wide.

import api from './api';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  combinedScore: number;
  /** Change since the previous nightly computation. Null on first computation. */
  weekDelta: number | null;
  isRequester: boolean;
}

export interface LeaderboardViewer {
  /** Explicit opt-in state from the backend DB field. Never inferred from entries. */
  is_opted_in: boolean;
  /** The requester's current rank. Null when not opted in. */
  rank: number | null;
  /** The requester's combined score (0–100). Null when not opted in. */
  score: number | null;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  /** The requesting user's current rank. Null if no coach assigned or not opted in. */
  selfRank: number | null;
  /** Explicit viewer state — always present. Use this for opt-in checks, not entries membership. */
  viewer: LeaderboardViewer;
}

export interface OptInPayload {
  enabled: boolean;
  /** Max 40 characters. If omitted, the backend derives "{firstName} {lastInitial}.". */
  displayName?: string;
}

export interface OptInResponse {
  success: boolean;
  enabled: boolean;
}

/**
 * Fetches the leaderboard for the authenticated user's coach roster.
 * Only opted-in peers appear in the ranked list.
 * The requesting user's entry is always present (flagged `isRequester: true`).
 */
export async function getLeaderboard(): Promise<LeaderboardResponse> {
  const { data } = await api.get<LeaderboardResponse>('/me/leaderboard');
  return data;
}

/**
 * Opts the authenticated user in or out of the leaderboard.
 *
 * @param payload.enabled     true = appear; false = hide immediately.
 * @param payload.displayName Optional public name (max 40 chars).
 */
export async function setLeaderboardOptIn(
  payload: OptInPayload,
): Promise<OptInResponse> {
  const { data } = await api.post<OptInResponse>('/me/leaderboard/opt-in', payload);
  return data;
}
