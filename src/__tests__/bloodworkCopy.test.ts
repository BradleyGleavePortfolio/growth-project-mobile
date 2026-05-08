/**
 * Forbidden-claims test for the bloodwork surface.
 *
 * Scans every string export in `src/constants/bloodworkCopy.ts` to make
 * sure no diagnostic / prescriptive language sneaks into the UI copy.
 * If you need to add a string that *legitimately* needs one of the
 * forbidden phrases (e.g. a clarifying disclaimer), prefer rephrasing —
 * the rule exists so the surface stays clearly non-medical.
 *
 * Also asserts that the long-form disclaimer keeps the required safety
 * phrases ("not medical advice", "not a diagnosis", "clinician").
 */

import * as copy from '../constants/bloodworkCopy';
import {
  BLOODWORK_DISCLAIMER_LONG,
  BLOODWORK_DISCLAIMER_SHORT,
  BLOODWORK_FORBIDDEN_PHRASES,
  BLOODWORK_REQUIRED_DISCLAIMER_PHRASES,
} from '../constants/bloodworkCopy';

function flattenCopy(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) flattenCopy(item, out);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) flattenCopy(value, out);
  }
  return out;
}

describe('bloodwork copy — forbidden claims', () => {
  // The forbidden-list itself is a string array, so skip it when walking.
  const exclusions = new Set<string>([
    'BLOODWORK_FORBIDDEN_PHRASES',
    'BLOODWORK_REQUIRED_DISCLAIMER_PHRASES',
  ]);

  const allStrings: { key: string; text: string }[] = [];
  for (const [key, value] of Object.entries(copy)) {
    if (exclusions.has(key)) continue;
    for (const text of flattenCopy(value)) {
      allStrings.push({ key, text });
    }
  }

  it('collects copy strings to scan (sanity check)', () => {
    expect(allStrings.length).toBeGreaterThan(0);
  });

  it.each(BLOODWORK_FORBIDDEN_PHRASES)(
    'no UI string contains the forbidden phrase %p',
    (phrase) => {
      const lower = phrase.toLowerCase();
      const offenders = allStrings.filter(({ text }) =>
        text.toLowerCase().includes(lower),
      );
      expect(offenders).toEqual([]);
    },
  );
});

describe('bloodwork disclaimer — required safety phrases', () => {
  it.each(BLOODWORK_REQUIRED_DISCLAIMER_PHRASES)(
    'long-form disclaimer mentions %p',
    (phrase) => {
      expect(BLOODWORK_DISCLAIMER_LONG.toLowerCase()).toContain(phrase.toLowerCase());
    },
  );

  it('short disclaimer makes the non-medical-advice intent explicit', () => {
    expect(BLOODWORK_DISCLAIMER_SHORT.toLowerCase()).toMatch(/not medical advice/);
  });
});
