import { calcBMR, calcTDEE, calcMacros, heightToFeetInches, feetInchesToCm, calculateAge } from '../nutrition';

describe('nutrition calculations', () => {
  it('calcBMR uses Mifflin-St Jeor with sex-specific constant', () => {
    // 180 lb, 180 cm, age 30, male → 10 * 81.65 + 6.25 * 180 - 5 * 30 + 5 ≈ 1796
    expect(Math.round(calcBMR(180, 180, 30, 'male'))).toBe(1796);
    // Female of same inputs is 166 less.
    expect(Math.round(calcBMR(180, 180, 30, 'female'))).toBe(1630);
  });

  it('calcTDEE multiplies by activity factor; unknown activity falls back to light', () => {
    expect(calcTDEE(2000, 'sedentary')).toBe(2400);
    expect(calcTDEE(2000, 'active')).toBe(3450);
    expect(calcTDEE(2000, 'bogus')).toBe(2750); // 2000 * 1.375 light fallback
  });

  it('calcMacros floors calories at 1200 and returns sensible macro split', () => {
    const m = calcMacros(150, 2200, 'lose_moderate');
    expect(m.calories).toBe(1700);
    expect(m.protein).toBe(128); // 150 * 0.85
    expect(m.fat).toBe(47); // 25% of calories / 9
    expect(m.carbs).toBeGreaterThan(0);
    // Below the 1200 floor — should clamp.
    expect(calcMacros(100, 1500, 'lose_fast').calories).toBe(1200);
  });

  it('heightToFeetInches and feetInchesToCm round-trip approximately', () => {
    const { feet, inches } = heightToFeetInches(180);
    expect(feet).toBe(5);
    expect(inches).toBe(11);
    expect(Math.round(feetInchesToCm(5, 11))).toBe(180);
  });

  it('calculateAge accounts for whether birthday has occurred this year', () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');

    // Birthday is today, 30 years ago → 30.
    expect(calculateAge(`${yyyy - 30}-${mm}-${dd}`)).toBe(30);
    // Birthday is tomorrow — still 29.
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tMm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const tDd = String(tomorrow.getDate()).padStart(2, '0');
    expect(calculateAge(`${tomorrow.getFullYear() - 30}-${tMm}-${tDd}`)).toBe(29);
  });
});
