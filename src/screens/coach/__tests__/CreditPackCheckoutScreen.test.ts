/**
 * CreditPackCheckoutScreen — `parseDollarsToCents` unit test.
 *
 * The component is too WebView-heavy to render meaningfully under jsdom
 * (the BrandedCheckoutWebViewScreen test fixture is the right place for a
 * full interaction test). What we CAN test in isolation is the pure helper
 * that converts user-entered dollar strings to cents — its edge cases drive
 * the custom-pack validation surface.
 */

import { parseDollarsToCents } from '../CreditPackCheckoutScreen';

describe('parseDollarsToCents', () => {
  it('accepts whole-dollar amounts', () => {
    expect(parseDollarsToCents('10')).toBe(1000);
    expect(parseDollarsToCents('25')).toBe(2500);
    expect(parseDollarsToCents('500')).toBe(50000);
  });

  it('accepts up to 2 decimal places', () => {
    expect(parseDollarsToCents('10.50')).toBe(1050);
    expect(parseDollarsToCents('10.5')).toBe(1050);
    expect(parseDollarsToCents('99.99')).toBe(9999);
  });

  it('strips $ and , chars and tolerates surrounding whitespace', () => {
    expect(parseDollarsToCents(' $25 ')).toBe(2500);
    expect(parseDollarsToCents('$1,000.00')).toBe(100000);
  });

  it('rejects malformed input', () => {
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('10.999')).toBeNull(); // > 2 decimals
    expect(parseDollarsToCents('-10')).toBeNull();
    expect(parseDollarsToCents('10.')).toBeNull();
  });
});
