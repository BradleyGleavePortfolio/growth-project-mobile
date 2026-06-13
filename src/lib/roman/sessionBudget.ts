/**
 * roman/sessionBudget — session-scoped exclamation rationing for Roman.
 *
 * The Roman identity spec (AI_BUTLER_ROMAN_IDENTITY_SPEC §1.4 / §4) allows
 * exactly ONE exclamation point per session, across ALL Roman surfaces — it is
 * "a rationed instrument, not punctuation". Counting literal exclamations in a
 * single copy module is not enough (P2-D-01): if another Roman surface spends
 * the session's one exclamation first (P1 chat, a P4 first-payment screen, an
 * empty-state celebration, or any future Roman surface), a later celebratory
 * line must NOT also render one.
 *
 * This module is the single runtime authority for that budget. It is an
 * in-memory singleton whose state lives only for the process lifetime: the
 * budget RESETS on app restart (cold start) and is deliberately NOT persisted —
 * the spec resets the exclamation at the session boundary, and a fresh launch
 * is a fresh session.
 *
 * Usage: a celebratory Roman copy path calls `requestExclamation()` exactly
 * once at the moment it would render its `!`. The first caller in the session
 * receives `true` and may keep the exclamation; every subsequent caller
 * receives `false` and must render the non-exclamation fallback for that line.
 */

/** The session budget contract. */
export interface RomanSessionBudget {
  /**
   * Request the session's single exclamation. Returns `true` for the FIRST
   * caller in the session (the exclamation is now spent), and `false` for
   * every caller thereafter. Idempotent only in the sense that it always
   * returns a definite boolean; it is NOT a peek — each `true` consumes the
   * budget.
   */
  requestExclamation(): boolean;
  /**
   * Whether the session's exclamation has already been spent. A read-only
   * peek that does NOT consume the budget — useful for tests and for callers
   * that want to choose copy before committing to a render.
   */
  isExclamationSpent(): boolean;
  /**
   * Reset the budget. Intended for test isolation and for an explicit
   * session-boundary reset (e.g. sign-out / sign-in) — NOT called on a mere
   * screen change.
   */
  reset(): void;
}

class InMemoryRomanSessionBudget implements RomanSessionBudget {
  private spent = false;

  requestExclamation(): boolean {
    if (this.spent) return false;
    this.spent = true;
    return true;
  }

  isExclamationSpent(): boolean {
    return this.spent;
  }

  reset(): void {
    this.spent = false;
  }
}

// Module-level singleton: one budget per JS runtime (one app session).
const singleton: RomanSessionBudget = new InMemoryRomanSessionBudget();

/** Returns the process-wide Roman session budget singleton. */
export function getRomanSessionBudget(): RomanSessionBudget {
  return singleton;
}
