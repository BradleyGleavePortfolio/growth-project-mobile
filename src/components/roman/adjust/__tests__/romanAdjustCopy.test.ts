import { changeSummary } from '../romanAdjustCopy';
import type { RomanAdjustChange } from '../../../../api/romanAdjustApi';

jest.mock('../../../../services/sentry', () => ({ captureError: jest.fn() }));

function change(sets_before: number, sets_after: number, volume_pct: number): RomanAdjustChange {
  return { volume_pct, sets_before, sets_after, exercises: [] };
}

describe('changeSummary (Opus C-337)', () => {
  it('a cut says less volume', () => {
    expect(changeSummary(change(18, 15, 15))).toBe('18 to 15 sets, 15% less volume');
  });

  it('an edit that raises sets says more volume, never a negative percent', () => {
    const text = changeSummary(change(18, 21, -17));
    expect(text).toBe('18 to 21 sets, 17% more volume');
    expect(text).not.toMatch(/-\d/);
  });

  it('no change in total sets says same volume', () => {
    expect(changeSummary(change(18, 18, 0))).toBe('18 to 18 sets, same volume');
  });
});
