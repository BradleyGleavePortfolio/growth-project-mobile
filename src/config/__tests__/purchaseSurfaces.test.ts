import { clientPurchasesHidden } from '../purchaseSurfaces';

describe('clientPurchasesHidden', () => {
  it('hides only on iOS with the flag on', () => {
    expect(clientPurchasesHidden('ios', true)).toBe(true);
    expect(clientPurchasesHidden('ios', false)).toBe(false);
    expect(clientPurchasesHidden('android', true)).toBe(false);
    expect(clientPurchasesHidden('web', true)).toBe(false);
  });
});

describe('EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES resolution', () => {
  const OLD = process.env.EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES;
  afterEach(() => {
    if (OLD === undefined) delete process.env.EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES;
    else process.env.EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES = OLD;
    jest.resetModules();
  });

  function load(): boolean {
    let v = false;
    jest.isolateModules(() => {
      v = (require('../featureFlags') as typeof import('../featureFlags')).featureFlags.iosHidePurchases;
    });
    return v;
  }

  it('explicit "true" (eas.json preview/production) turns it on', () => {
    process.env.EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES = 'true';
    expect(load()).toBe(true);
  });

  it('explicit "false" turns it off', () => {
    process.env.EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES = 'false';
    expect(load()).toBe(false);
  });

  it('unset in a dev/test build defaults off so checkout stays testable', () => {
    delete process.env.EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES;
    expect(load()).toBe(false);
  });

  it('eas.json sets it to "true" for preview and production', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eas = require('../../../eas.json');
    expect(eas.build.production.env.EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES).toBe('true');
    expect(eas.build.preview.env.EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES).toBe('true');
  });
});
