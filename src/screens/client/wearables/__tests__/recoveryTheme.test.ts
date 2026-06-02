/**
 * recoveryTheme — assert the CALM colour doctrine: NEVER red, low score
 * desaturates to slate, plain-language state labels.
 */

import { RECOVERY_PALETTE, resolveRecoveryState } from '../recoveryTheme';

describe('RECOVERY_PALETTE — never red', () => {
  it('uses cool indigo/slate accents, no pure-red tokens', () => {
    const values = Object.values(RECOVERY_PALETTE);
    // No token should be a red (#Rxxxxx where red channel dominates strongly).
    for (const hex of values) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      // Reject "alarm red": red strongly dominating both other channels.
      const isAlarmRed = r > 180 && r - g > 90 && r - b > 90;
      expect(isAlarmRed).toBe(false);
    }
  });

  it('soft amber attention token is amber, not red', () => {
    const hex = RECOVERY_PALETTE.attention;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    // Amber has substantial green; red would not.
    expect(g).toBeGreaterThan(120);
  });
});

describe('resolveRecoveryState', () => {
  it('labels high scores Recovered with the indigo accent', () => {
    const view = resolveRecoveryState(80);
    expect(view.state).toBe('recovered');
    expect(view.label).toBe('Recovered');
    expect(view.color(RECOVERY_PALETTE)).toBe(RECOVERY_PALETTE.accent);
  });

  it('labels mid scores Recovering', () => {
    expect(resolveRecoveryState(50).label).toBe('Recovering');
  });

  it('labels low scores Run-down with the DESATURATED slate (not red)', () => {
    const view = resolveRecoveryState(20);
    expect(view.state).toBe('run_down');
    expect(view.label).toBe('Run-down');
    expect(view.color(RECOVERY_PALETTE)).toBe(RECOVERY_PALETTE.accentMuted);
  });

  it('handles null score as unknown', () => {
    const view = resolveRecoveryState(null);
    expect(view.state).toBe('unknown');
    expect(view.label).toBe('Recovery');
  });
});
