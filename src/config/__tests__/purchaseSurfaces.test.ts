import { nonP2PPurchasesHidden, oneToOneCoachingLabel } from '../purchaseSurfaces';

describe('nonP2PPurchasesHidden', () => {
  it('hides only on iOS with the flag on', () => {
    expect(nonP2PPurchasesHidden('ios', true)).toBe(true);
    expect(nonP2PPurchasesHidden('ios', false)).toBe(false);
    expect(nonP2PPurchasesHidden('android', true)).toBe(false);
    expect(nonP2PPurchasesHidden('web', true)).toBe(false);
  });
});

describe('EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES resolution', () => {
  const OLD = process.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES;
  afterEach(() => {
    if (OLD === undefined) delete process.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES;
    else process.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES = OLD;
    jest.resetModules();
  });

  function load(): boolean {
    let v = false;
    jest.isolateModules(() => {
      v = (require('../featureFlags') as typeof import('../featureFlags')).featureFlags.iosHideNonP2PPurchases;
    });
    return v;
  }

  it('explicit "true" (eas.json preview/production) turns it on', () => {
    process.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES = 'true';
    expect(load()).toBe(true);
  });

  it('explicit "false" turns it off', () => {
    process.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES = 'false';
    expect(load()).toBe(false);
  });

  it('unset in a dev/test build defaults off so checkout stays testable', () => {
    delete process.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES;
    expect(load()).toBe(false);
  });

  it('eas.json sets it to "true" for preview and production', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eas = require('../../../eas.json');
    expect(eas.build.production.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES).toBe('true');
    expect(eas.build.preview.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES).toBe('true');
  });
});

describe('oneToOneCoachingLabel (3.1.3(d) copy)', () => {
  it('names the individual coach and the 1:1 nature', () => {
    expect(oneToOneCoachingLabel('Bradley Gleave')).toBe('1:1 coaching with Bradley Gleave');
    expect(oneToOneCoachingLabel('  ')).toBe('1:1 coaching with your coach');
    expect(oneToOneCoachingLabel(undefined)).toBe('1:1 coaching with your coach');
  });
});

describe('the old client-wide flag is gone', () => {
  it('eas.json no longer carries EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eas = require('../../../eas.json');
    expect(eas.build.production.env).not.toHaveProperty('EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES');
    expect(eas.build.preview.env).not.toHaveProperty('EXPO_PUBLIC_FF_IOS_HIDE_PURCHASES');
  });
});
