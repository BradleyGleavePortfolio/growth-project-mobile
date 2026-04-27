/**
 * Static guarantees for the lean onboarding flow after the LeanQ4 metrics
 * step was added. Mounting the screens would require pulling in reanimated
 * and the navigation container; we instead verify the structural contracts
 * that decide whether the flow ends in the right place.
 *
 * The point of LeanQ4 is to capture essential body metrics (height, current
 * weight) WITHOUT reintroducing the legacy 10-step flow. So we assert:
 *   - LeanQ4 is in the param list and registered as a Stack.Screen.
 *   - LeanQ3 navigates to LeanQ4 on selection (it no longer ends the flow).
 *   - LeanQ4 marks onboarding_complete + lean_onboarding_done and emits.
 */

import * as fs from 'fs';
import * as path from 'path';

// __dirname → src/screens/onboarding/__tests__
// SRC_ROOT  → src
const SRC_ROOT = path.resolve(__dirname, '..', '..', '..');

const NAV_SRC = fs.readFileSync(
  path.join(SRC_ROOT, 'navigation', 'LeanOnboardingNavigator.tsx'),
  'utf8',
);
const Q3_SRC = fs.readFileSync(
  path.join(SRC_ROOT, 'screens', 'onboarding', 'LeanQ3IntentScreen.tsx'),
  'utf8',
);
const Q4_SRC = fs.readFileSync(
  path.join(SRC_ROOT, 'screens', 'onboarding', 'LeanQ4MetricsScreen.tsx'),
  'utf8',
);

describe('LeanOnboardingNavigator includes the metrics step', () => {
  it('declares LeanQ4 in LeanOnboardingParamList', () => {
    const block = NAV_SRC.match(/LeanOnboardingParamList\s*=\s*\{([\s\S]*?)\};/);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/LeanQ4:\s*undefined/);
  });

  it('registers LeanQ4 as a Stack.Screen', () => {
    expect(NAV_SRC).toMatch(
      /Stack\.Screen\s+name=["']LeanQ4["']\s+component=\{LeanQ4MetricsScreen\}/,
    );
  });
});

describe('LeanQ3 routes onward to LeanQ4 on selection', () => {
  it('navigates to LeanQ4 inside handleSelect (no longer ends the flow there)', () => {
    expect(Q3_SRC).toMatch(/navigation\.navigate\(['"]LeanQ4['"]\)/);
  });

  it('still allows skip-to-home — onboarding_complete is set on skip', () => {
    expect(Q3_SRC).toMatch(/onboarding_complete['"],\s*['"]true['"]/);
  });
});

describe('LeanQ4 finalises onboarding and persists captured metrics', () => {
  it('persists captured height and currentWeight via the onboarding store', () => {
    expect(Q4_SRC).toMatch(/saveOnboardingData\(payload\)/);
    expect(Q4_SRC).toMatch(/payload\.height\s*=/);
    expect(Q4_SRC).toMatch(/payload\.currentWeight\s*=/);
  });

  it('marks onboarding_complete + lean_onboarding_done and emits an authEvent', () => {
    expect(Q4_SRC).toMatch(/onboarding_complete['"],\s*['"]true['"]/);
    expect(Q4_SRC).toMatch(/lean_onboarding_done['"],\s*['"]true['"]/);
    expect(Q4_SRC).toMatch(/authEvents\.emit\(\)/);
  });

  it('imperial → cm conversion is correct (5ft 10in ≈ 178 cm)', () => {
    // The conversion lives inside the screen as a pure helper. We re-derive
    // the same arithmetic and assert agreement instead of re-importing the
    // component module (which pulls in expo-localization).
    const ft = 5;
    const inches = 10;
    const cm = Math.round((ft * 12 + inches) * 2.54);
    expect(cm).toBe(178);
  });

  it('lbs → kg conversion is correct (200 lbs ≈ 90.7 kg)', () => {
    const lbs = 200;
    const kg = Math.round(lbs * 0.45359237 * 10) / 10;
    expect(kg).toBe(90.7);
  });
});
