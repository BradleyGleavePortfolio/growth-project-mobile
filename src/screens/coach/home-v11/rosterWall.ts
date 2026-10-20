/**
 * UI-2 (V1_1_UI_SPEC UI-2, second PR): who sits on the Steady wall, what each ring means, and the filter chips.
 * Pure, so the screen and the tests share one rule. The ring comes from the roster's `activity` block
 * (GET /coach/clients): the latest day the client logged anything (a current client's logs always reach the coach).
 */
import { rosterActivityLine, rosterDisplayName, type RosterClient } from '../../../utils/coach/clientRoster';
import type { WinStreakEntry } from '../../../services/commandCenterApi';

/** 'logged' / 'notYet' from the latest log day; 'unknown' when the server sent no activity block. */
export type WallRing = 'logged' | 'notYet' | 'unknown';

export interface WallMember { id: string; name: string; label: string; ring: WallRing }

/** 'setup' is the zero-client Home's one chip over its setup steps. */
export type RosterFilter = 'needs' | 'steady' | 'streaks' | 'setup';

export interface FilterChip { key: RosterFilter; label: string; count: number }

/** The device's calendar day, YYYY-MM-DD (log days are calendar days). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function wallRing(c: RosterClient, today: Date): WallRing {
  const a = c.activity;
  if (!a) return 'unknown';
  return a.lastActiveOn !== null && a.lastActiveOn >= localDay(today) ? 'logged' : 'notYet';
}

/** Active clients who are not in the needs-you list, A to Z, each with the first name the wall prints. */
export function steadyWall(clients: RosterClient[], needsYou: ReadonlySet<string>, today: Date): WallMember[] {
  return clients
    .filter((c) => c.status !== 'archived' && !needsYou.has(c.id))
    .map((c) => {
      const name = rosterDisplayName(c);
      return { id: c.id, name, label: c.firstName?.trim() || name, ring: wallRing(c, today) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * A needs-you tile's last line in the Clients list words ("Logged today", "Last logged 8 days ago") when the
 * roster has a log day for the client; otherwise null and the tile keeps its "Active ..." line.
 */
export function loggedLine(c: RosterClient | undefined, today: Date): string | null {
  const a = c?.activity;
  if (!c || !a || !a.lastActiveOn) return null;
  return rosterActivityLine(c, today).text;
}

/** The streak list's own words (WinStreaksScreen); an unknown type shows no line rather than a raw code. */
const STREAK_TYPE_LABEL: Record<string, string> = {
  check_in: 'Check-in streak',
  workout: 'Training streak',
  weight_log: 'Weight tracking streak',
};
export const streakLabel = (e: WinStreakEntry): string | null => STREAK_TYPE_LABEL[e.streak_type] ?? null;

/** Chips with something behind them, in the mockup's order. "New" is left out: no read says who is new. */
export function filterChips(needsYou: number, steady: number | null, streaks: number): FilterChip[] {
  const chips: FilterChip[] = [];
  if (needsYou > 0) chips.push({ key: 'needs', label: 'Needs you', count: needsYou });
  if (steady !== null && steady > 0) chips.push({ key: 'steady', label: 'Steady', count: steady });
  if (streaks > 0) chips.push({ key: 'streaks', label: 'Streaks', count: streaks });
  return chips;
}
