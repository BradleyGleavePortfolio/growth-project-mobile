import type { Answers } from '../types';

/** A complete consult-v1 answer set (the prototype's sample client). */
export const NOW = new Date(2026, 8, 30, 12, 1); // Wed 30 Sep 2026, 12:01

export function fullAnswers(overrides: Answers = {}): Answers {
  return {
    G1: 'fat_loss',
    G2: ['energy', 'family'],
    B1: 'female',
    B2: '1988-03-14',
    B3: { height_cm: 167.6, weight_lbs: 172, unit: 'imperial' },
    B4: 150,
    L1: 'moderate',
    L2: '7_8',
    T1: 'beginner',
    T2: ['home'],
    T3: 'no',
    T4: '30_45',
    S1: '3',
    S2: 'morning',
    S3: 'home_some',
    S3b: ['dumbbells', 'resistance_bands'],
    N1: 'none',
    N2: ['dairy'],
    N3: '3',
    N4: 'never',
    N5: ['time'],
    P0: { agreed: true, copy_version: 'consult-consent-v3', agreed_at: '2026-09-30T19:00:00.000Z' },
    P1: 'no',
    P2: 'no',
    P3: 'no',
    P4: 'no',
    P5: 'no',
    P6: 'no',
    P7: 'no',
    C1: '2026-10-01',
    ...overrides,
  };
}

/** Answers through the end of chapter 6 (agreement given, safety chapter not started). */
export function answersBeforeSafety(): Answers {
  const a = fullAnswers();
  for (const k of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'C1']) delete a[k];
  return a;
}
