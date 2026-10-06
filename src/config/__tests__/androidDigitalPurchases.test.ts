import * as fs from 'fs';
import * as path from 'path';
import { digitalPurchasesHidden, nonP2PPurchasesHidden } from '../purchaseSurfaces';

describe('Android digital software purchases (Google Play Payments)', () => {
  it.each([true, false])('release hides digital checkout regardless of the iOS flag (%s)', (flag) => {
    expect(digitalPurchasesHidden('android', flag, 5, false)).toBe(true);
    expect(digitalPurchasesHidden('android', flag, null, false)).toBe(true);
  });

  it('development retains checkout for engineering without a release opt-out', () => {
    expect(digitalPurchasesHidden('android', true, 5, true)).toBe(false);
  });

  it('does not change the separate real-time 1:1 human-coaching posture', () => {
    expect(nonP2PPurchasesHidden('android', true, 5, false)).toBe(false);
    expect(nonP2PPurchasesHidden('android', false, 5, false)).toBe(false);
  });

  it.each([
    [true, 6, false],
    [false, 6, false],
    [false, null, false],
    [false, 5, false],
    [false, 6, true],
  ])('preserves the iOS native/flag gate (%s, %s, %s)', (flag, nativeBuild, dev) => {
    expect(digitalPurchasesHidden('ios', flag as boolean, nativeBuild as number | null, dev as boolean))
      .toBe(nonP2PPurchasesHidden('ios', flag as boolean, nativeBuild as number | null, dev as boolean));
  });

  it('does not disable web digital purchases', () => {
    expect(digitalPurchasesHidden('web', true, null, false)).toBe(false);
  });

  it('keeps client recurring coaching checkout ungated and feature-paywall behavior separate', () => {
    const read = (file: string) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    for (const file of [
      'screens/client/ClientPackagesScreen.tsx',
      'screens/client/PackageCheckoutScreen.tsx',
      'hooks/usePackagePurchase.ts',
      'lib/packagePromptGate.ts',
      'entitlements/PaywallSheet.tsx',
      'entitlements/ProtectedScreen.tsx',
    ]) {
      expect(read(file)).not.toContain('digitalPurchasesHidden');
    }
    expect(read('navigation/ClientNavigator.tsx'))
      .toMatch(/name="PackageCheckout"\s+component=\{PackageCheckoutScreen\}/);
  });
});
