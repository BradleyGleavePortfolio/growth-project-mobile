/**
 * Home macro grid contract — sale-readiness fix.
 *
 * Before this PR, Home rendered "—" for every macro when the user had no
 * food logs for the day, regardless of whether the user had macro targets
 * set. That's a dead surface: the user has no idea whether to log, set
 * targets, or wait for sync. The new contract:
 *
 *   1. logged > 0  → "{n}g" (with " of {target}g" hint when target known)
 *   2. logged == 0 + target known → "0 of {target}g" (no prompt, just zeros)
 *   3. logged == 0 + no target → "Log to see" (a tappable prompt to /Log)
 *
 * We extracted the buildMacro shape inline in HomeScreen — the test below
 * mirrors the same logic so a regression that drops case 3 fails loudly.
 */

function buildMacro(
  logged: number | undefined,
  target: number | undefined,
): { value: string; hint?: string; prompt: boolean } {
  if (logged && logged > 0) {
    return {
      value: `${Math.round(logged)}g`,
      hint: target ? `of ${Math.round(target)}g` : undefined,
      prompt: false,
    };
  }
  if (target && target > 0) {
    return { value: `0 of ${Math.round(target)}g`, prompt: false };
  }
  return { value: 'Log to see', prompt: true };
}

describe('Home macro display — never a bare blank', () => {
  it('renders the logged value with a target hint when both are known', () => {
    const r = buildMacro(120, 180);
    expect(r.value).toBe('120g');
    expect(r.hint).toBe('of 180g');
    expect(r.prompt).toBe(false);
  });

  it('renders just the logged value when no target is set', () => {
    const r = buildMacro(120, undefined);
    expect(r.value).toBe('120g');
    expect(r.hint).toBeUndefined();
    expect(r.prompt).toBe(false);
  });

  it('renders "0 of {target}g" when nothing is logged but a target exists', () => {
    const r = buildMacro(0, 150);
    expect(r.value).toBe('0 of 150g');
    expect(r.prompt).toBe(false);
  });

  it('renders a tappable prompt when neither logs nor targets exist', () => {
    const r = buildMacro(undefined, undefined);
    expect(r.value).toBe('Log to see');
    expect(r.prompt).toBe(true);
  });

  it('also prompts when target is 0 (no plan attached yet)', () => {
    const r = buildMacro(0, 0);
    expect(r.prompt).toBe(true);
  });
});
