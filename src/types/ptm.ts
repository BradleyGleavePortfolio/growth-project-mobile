// Mobile-side mirror of the PTM bucket constants.
// Source of truth: gpb/src/ptm/ptm.types.ts (PTM_SCORE_BUCKETS).
// Keep numeric cutoffs in sync if the backend ever shifts them.

export type PtmRiskBucket = 'green' | 'amber' | 'red';

export const PTM_SCORE_BUCKETS = {
  GREEN_MAX: 0.3,
  AMBER_MAX: 0.6,
} as const;

export function bucketize(riskScore: number): PtmRiskBucket {
  if (riskScore <= PTM_SCORE_BUCKETS.GREEN_MAX) return 'green';
  if (riskScore <= PTM_SCORE_BUCKETS.AMBER_MAX) return 'amber';
  return 'red';
}
