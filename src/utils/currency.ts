// Minimal currency helpers used by the payments surface. Cents → display.
//
// Intl.NumberFormat is the right tool: it correctly handles minor units for
// JPY / KWD etc. We keep a tiny try/catch fallback because some lower-end
// Android JSC builds fail on uncommon ISO codes — the fallback yields a
// readable, if less polished, string instead of crashing the screen.

export function formatCurrencyCents(
  cents: number | null | undefined,
  currency: string | null | undefined = 'usd',
): string {
  const amount = (cents ?? 0) / 100;
  const iso = (currency ?? 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: iso,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${iso} ${amount.toFixed(2)}`;
  }
}

// Parse a UI string like "$199.00" or "199" back into integer cents. Returns
// null when the input isn't a sensible non-negative number, so callers can
// validate without writing their own regex.
export function parseDollarsToCents(input: string): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}
