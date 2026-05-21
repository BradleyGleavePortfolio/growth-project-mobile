/**
 * Tiny i18n loader for the Day-1 onboarding flow.
 *
 * Why a local module instead of i18next: the app does not yet ship a global
 * i18n runtime (Rule 11: don't shrink — but also don't pre-build infra we
 * don't have). This module gives us:
 *   - All copy lives in en.json (i18n-ready — drop in es.json later)
 *   - A typed `t()` lookup so missing keys are a TS error at the call site
 *   - {placeholder} interpolation without pulling in a new dependency
 *
 * When the app introduces a global i18n provider, swap `t()` for that
 * provider's `t()` and the call sites stay the same.
 */

import en from './en.json';

type Bag = typeof en;

// Recursive dot-path extractor — produces the union of all leaf string paths.
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends readonly string[]
      ? `${P}${K}`
      : T[K] extends Record<string, unknown>
        ? Leaves<T[K], `${P}${K}.`>
        : never;
}[keyof T & string];

export type StringKey = Leaves<Bag>;

function lookup(path: string): string | string[] {
  const parts = path.split('.');
  let cur: unknown = en;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return path; // visible-in-UI fallback so missing keys are obvious in QA
    }
  }
  if (typeof cur === 'string') return cur;
  if (Array.isArray(cur) && cur.every((x) => typeof x === 'string')) return cur as string[];
  return path;
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const v = lookup(key);
  if (typeof v === 'string') return interpolate(v, vars);
  return key; // accidental list-key access — surface the path so QA sees it
}

export function tList(key: StringKey): string[] {
  const v = lookup(key);
  if (Array.isArray(v)) return v;
  return [];
}
