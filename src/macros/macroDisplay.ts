/**
 * macroDisplay — the lighter start for clients who have never tracked food
 * (clinic onboarding contract v1, addition 8; owner ruling 2026-09-30 18:11).
 *
 * The backend sends `{ macro_display_mode: 'simple' | 'full', simple_until }`
 * on `GET /me/macros/current` and in the `POST /me/onboarding/complete`
 * payload. While the mode is 'simple' and `simple_until` has not passed, the
 * client surfaces (Home, Log, Macros, the pinned macro card) show calories and
 * protein only. Carbohydrate and fat targets are still computed and stored by
 * the server; only the display changes.
 *
 * Safety default: when the field is absent or malformed the mode is 'full',
 * which is exactly the behaviour before this change.
 *
 * Everything in this file is pure so each rule is unit tested.
 */

export type MacroDisplayMode = 'simple' | 'full';

/** What the server said, normalised. */
export interface MacroDisplayInfo {
  mode: MacroDisplayMode;
  /** ISO date or date-time string, or null. */
  simpleUntil: string | null;
}

/**
 * Per-user record kept on the device so the mode survives a cold start and
 * the one-time introduction of carbohydrate and fat is shown exactly once.
 */
export interface MacroDisplayRecord {
  version: 1;
  /** Last mode the server reported (absent field means nothing is stored). */
  mode: MacroDisplayMode;
  simpleUntil: string | null;
  /** True once the server has ever reported 'simple' for this client. */
  seenSimple: boolean;
  /** When the client dismissed the carbs and fat introduction, or null. */
  introDismissedAt: string | null;
}

export function emptyMacroDisplayRecord(): MacroDisplayRecord {
  return { version: 1, mode: 'full', simpleUntil: null, seenSimple: false, introDismissedAt: null };
}

const WRAPPER_KEYS = ['complete', 'result', 'payload', 'data', 'macros_display', 'display'] as const;

/**
 * Read `macro_display_mode` / `simple_until` from a server body. Accepts the
 * fields at the top level or under a common envelope key. Returns null when
 * the field is absent or not one of the two known values (caller keeps the
 * default 'full').
 */
export function parseMacroDisplay(raw: unknown, depth = 0): MacroDisplayInfo | null {
  if (!raw || typeof raw !== 'object' || depth > 3) return null;
  const r = raw as Record<string, unknown>;
  const mode = r.macro_display_mode;
  if (mode === 'simple' || mode === 'full') {
    const until = r.simple_until;
    const simpleUntil =
      typeof until === 'string' && until.trim() && parseUntil(until) !== null ? until.trim() : null;
    return { mode, simpleUntil };
  }
  for (const key of WRAPPER_KEYS) {
    const inner = r[key];
    if (inner && typeof inner === 'object') {
      const nested = parseMacroDisplay(inner, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * `simple_until` as a Date. A bare 'YYYY-MM-DD' is the start of that day in
 * the client's local time, so "until 10-08" means the simple view ends when
 * the client's 8 October begins.
 */
export function parseUntil(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fold a server report into the stored record. Null (field absent) changes nothing. */
export function mergeMacroDisplay(
  record: MacroDisplayRecord,
  info: MacroDisplayInfo | null,
): MacroDisplayRecord {
  if (!info) return record;
  const simpleUntil = info.simpleUntil ?? (info.mode === 'full' ? record.simpleUntil : null);
  const next: MacroDisplayRecord = {
    ...record,
    mode: info.mode,
    simpleUntil,
    seenSimple: record.seenSimple || info.mode === 'simple',
  };
  return next.mode === record.mode &&
    next.simpleUntil === record.simpleUntil &&
    next.seenSimple === record.seenSimple
    ? record
    : next;
}

/**
 * The mode the UI renders right now. 'simple' only while the server says
 * 'simple' and `simple_until` (when given) is still in the future.
 */
export function effectiveMacroDisplayMode(
  record: Pick<MacroDisplayRecord, 'mode' | 'simpleUntil'> | null | undefined,
  now: Date = new Date(),
): MacroDisplayMode {
  if (!record || record.mode !== 'simple') return 'full';
  const until = parseUntil(record.simpleUntil);
  if (until && now.getTime() >= until.getTime()) return 'full';
  return 'simple';
}

/**
 * Show the one-time "carbohydrate and fat join today" card when this client
 * started in the simple view, the simple view has ended (the day
 * `simple_until` passes, or the server now reports 'full'), and they have not
 * dismissed it. A client who was never in the simple view never sees it.
 */
export function shouldShowFullMacrosIntro(
  record: MacroDisplayRecord | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!record || !record.seenSimple || record.introDismissedAt) return false;
  return effectiveMacroDisplayMode(record, now) === 'full';
}

export function parseMacroDisplayRecord(raw: unknown): MacroDisplayRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  return {
    version: 1,
    mode: r.mode === 'simple' ? 'simple' : 'full',
    simpleUntil: typeof r.simpleUntil === 'string' ? r.simpleUntil : null,
    seenSimple: r.seenSimple === true,
    introDismissedAt: typeof r.introDismissedAt === 'string' ? r.introDismissedAt : null,
  };
}

// ─── What each surface shows ────────────────────────────────────────────────

export type HomeCell = 'CALORIES' | 'PROTEIN' | 'CARBS' | 'FAT' | 'WATER';

/** Home's number grid. Full is the existing grid, unchanged. */
export function homeCells(mode: MacroDisplayMode): HomeCell[] {
  return mode === 'simple' ? ['CALORIES', 'PROTEIN', 'WATER'] : ['PROTEIN', 'CARBS', 'FAT', 'WATER'];
}

export type TargetCell = 'protein' | 'carbs' | 'fat' | 'fiber';

/** Macros screen and the pinned macro card (calories are always the headline). */
export function targetCells(mode: MacroDisplayMode): TargetCell[] {
  return mode === 'simple' ? ['protein'] : ['protein', 'carbs', 'fat', 'fiber'];
}

/** The per-entry macro line under each food in a Log meal section. */
export function foodMacroLine(
  log: { protein: number; carbs: number; fat: number },
  mode: MacroDisplayMode,
): string {
  const p = `P: ${Math.round(log.protein)}g`;
  if (mode === 'simple') return p;
  return `${p} · C: ${Math.round(log.carbs)}g · F: ${Math.round(log.fat)}g`;
}

/** Quiet explanatory line shown on the Macros screen in the simple view. */
export const SIMPLE_VIEW_NOTE =
  'For your first week, these two numbers are all you need. Carbohydrate and fat are already worked out and will join them here when the week is done.';
