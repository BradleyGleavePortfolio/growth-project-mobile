// src/services/firstWinApi.ts
//
// Typed client for the Phase 7A Day 1 Win endpoints.
// Wraps POST /me/first-win/complete and GET /me/first-win/status.
//
// The status endpoint is called on every student cold start by RootNavigator.
// The complete endpoint is called once when the client taps a win-card action.

import api from './api';

export type WinType =
  | 'logged_first_weight'
  | 'set_first_goal'
  | 'first_checkin'
  | 'first_meal';

export interface FirstWinStatus {
  completed: boolean;
  completedAt: string | null;
}

export interface FirstWinCompleteResponse {
  completedAt: string;
  aiMessage: string;
}

export const firstWinApi = {
  /**
   * Returns whether the authenticated user has completed their Day 1 Win.
   * Called on every student cold start by RootNavigator.
   */
  getStatus: (): Promise<{ data: FirstWinStatus }> =>
    api.get<FirstWinStatus>('/me/first-win/status'),

  /**
   * Marks the Day 1 Win as completed. Idempotent — safe to retry on poor
   * connections. Returns the timestamp and a 2-sentence AI coaching message.
   */
  complete: (winType: WinType): Promise<{ data: FirstWinCompleteResponse }> =>
    api.post<FirstWinCompleteResponse>('/me/first-win/complete', { winType }),
};
