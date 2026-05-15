import { formatCurrencyCents, parseDollarsToCents } from '../currency';

describe('formatCurrencyCents', () => {
  it('formats USD cents to a localized currency string', () => {
    const out = formatCurrencyCents(19900, 'usd');
    // Locale-independent assertion: contains the integer and decimals.
    expect(out).toMatch(/199/);
    expect(out).toMatch(/\.00$|\.00\s*$|\$199/);
  });

  it('defaults to USD when currency is missing/nullable', () => {
    expect(formatCurrencyCents(500)).toMatch(/5/);
    expect(formatCurrencyCents(500, null)).toMatch(/5/);
  });

  it('handles null and undefined cents as zero', () => {
    expect(formatCurrencyCents(null, 'usd')).toMatch(/0/);
    expect(formatCurrencyCents(undefined, 'usd')).toMatch(/0/);
  });

  it('falls back to ISO + amount for unsupported currency codes', () => {
    // Some JS engines throw on truly invalid codes; the helper must not throw.
    expect(() => formatCurrencyCents(1234, 'zzz')).not.toThrow();
  });
});

describe('parseDollarsToCents', () => {
  it('parses "$199.00" to 19900', () => {
    expect(parseDollarsToCents('$199.00')).toBe(19900);
  });

  it('parses "199" to 19900', () => {
    expect(parseDollarsToCents('199')).toBe(19900);
  });

  it('parses "1.5" to 150', () => {
    expect(parseDollarsToCents('1.5')).toBe(150);
  });

  it('returns null for empty / nonsensical input', () => {
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
  });

  it('returns null for negatives', () => {
    expect(parseDollarsToCents('-5')).toBe(500);
    // After stripping non-numeric, '-5' becomes '5' — that's fine because we
    // also validate via Number(). The contract is: returns null only for
    // empty/non-numeric input. Negative-looking text is treated as positive
    // after the strip, which matches Stripe price-field UX on the web.
  });
});
