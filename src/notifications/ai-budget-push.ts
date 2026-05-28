/**
 * ai-budget-push — push notification taxonomy entry for the AI budget surface.
 *
 * The existing push pipeline (`src/services/pushNotifications.ts`) routes
 * taps via `data.actionScreen` + `data.actionParams` — generic, no per-kind
 * branches needed. This file exists so the kind name is a single named
 * constant, and so the README documents the contract between the backend
 * push job and the mobile router.
 *
 * Backend contract (Stream 1 spec §4 — 95% threshold):
 *   Push payload `data` shape:
 *     {
 *       "kind":         "AI_BUDGET_95_WARNING",   // for analytics tagging
 *       "actionScreen": "CreditPackCheckout",     // routes to checkout
 *       "actionParams": {}                         // none required
 *     }
 *
 * The push is sent EXACTLY ONCE per period when the budget first crosses
 * the 95% threshold. The backend de-dupes on
 * `CoachAIBudget.last_warning_sent_at` (or equivalent) — the mobile side
 * does not throttle the surface.
 *
 * Channel routing (Android): `client-bot` (LOW importance). Budget warnings
 * are informational; they MUST NOT break through Do-Not-Disturb the way
 * coach-direct messages do.
 *
 * Notification preferences: opting out of the `system` kind suppresses this
 * push (the mobile maps `AI_BUDGET_95_WARNING` to the `system` row in the
 * preferences matrix so a single toggle controls every operational alert).
 */

/** Push payload `kind` value for the 95% AI-budget warning. */
export const AI_BUDGET_95_WARNING_KIND = 'AI_BUDGET_95_WARNING' as const;

export type AIBudgetPushKind = typeof AI_BUDGET_95_WARNING_KIND;

/** Navigator screen the push routes to on tap. Mirrors the route name
 *  registered in `CoachNavigator` (SettingsStack). */
export const AI_BUDGET_PUSH_TARGET_SCREEN = 'CreditPackCheckout' as const;
