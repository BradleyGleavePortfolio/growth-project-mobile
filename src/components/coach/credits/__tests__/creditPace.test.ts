/**
 * CREDITBUILD-143: Roman's pace line on the credit moments (CREDIT-SW S3-R1..R4),
 * rebuilt from the approved shots: Oct 22 with $100 of $125 used since Oct 1
 * runs out about Oct 27 and a $25 pack covers it to Nov 1; Oct 27 used up,
 * a $25 pack covers it to Nov 1.
 */
import { paceLine, paceOf, preselectedPack, type PaceBudget } from '../creditPace';

const pool = (used: number, total = 12500): PaceBudget => ({
  period_start: '2026-10-01T00:00:00.000Z',
  period_end: '2026-11-01T00:00:00.000Z',
  used_displayed_cents: used,
  remaining_displayed_cents: total - used,
  pack_options_cents: [9900, 1000, 2500],
});
const OCT22 = new Date('2026-10-22T12:00:00.000Z');
const OCT27 = new Date('2026-10-27T12:00:00.000Z');

describe('pace', () => {
  it('reads the approved low example: runs out about Oct 27, a $25 pack covers it', () => {
    expect(paceOf(pool(10000), OCT22)).toEqual({ lastsToRenewal: false, runOutDay: 'Oct 27', suggestedCents: 2500 });
    expect(paceLine('low', pool(10000), true, OCT22)).toBe(
      'At your pace this month, your credits will last until about Oct 27. A $25 pack should cover you until Nov 1.',
    );
    expect(preselectedPack(pool(10000), OCT22)).toBe(2500);
  });

  it('says only when they run out on builds that sell no packs', () => {
    expect(paceLine('low', pool(10000), false, OCT22)).toBe(
      'At your pace this month, your credits will last until about Oct 27.',
    );
  });

  it('reads the approved used-up example, and says nothing there without packs', () => {
    expect(paceLine('usedUp', pool(12500), true, OCT27)).toBe(
      'At your usual pace, a $25 pack should cover you until Nov 1.',
    );
    expect(paceLine('usedUp', pool(12500), false, OCT27)).toBeNull();
  });

  it('says they should last when the pace carries them to renewal, and preselects the smallest pack', () => {
    const late = new Date('2026-10-30T12:00:00.000Z');
    expect(paceLine('low', pool(10500), true, late)).toBe(
      'At your pace this month, your credits should last until they renew on Nov 1.',
    );
    expect(preselectedPack(pool(10500), late)).toBe(1000);
  });

  it('drops the pack sentence when no pack is enough and preselects the largest', () => {
    const early = new Date('2026-10-02T00:00:00.000Z');
    expect(paceOf(pool(10000), early)?.suggestedCents).toBeNull();
    expect(paceLine('low', pool(10000), true, early)).toBe(
      'At your pace this month, your credits will last until about Oct 2.',
    );
    expect(paceLine('usedUp', pool(12500), true, early)).toBeNull();
    expect(preselectedPack(pool(10000), early)).toBe(9900);
  });

  it('has no pace when nothing is used, or outside the period', () => {
    expect(paceOf(pool(0), OCT22)).toBeNull();
    expect(paceOf(pool(10000), new Date('2026-11-02T00:00:00.000Z'))).toBeNull();
    expect(paceLine('low', { ...pool(10000), period_end: 'soon' }, true, OCT22)).toBeNull();
  });
});
