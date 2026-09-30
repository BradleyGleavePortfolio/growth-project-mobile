/**
 * Audit #304 C2: release semantics for EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES
 * with an empty device runtime env (NODE_ENV production, __DEV__ false):
 * unset / empty / malformed → hidden (true); "true" → true; "false" → false.
 * With "false" the purchase gate still hides on iOS binaries >= build 6
 * (native anchor, #305 A1).
 */
const KEY = 'EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES';

function loadFlag(raw: string | undefined): boolean {
  const env = process.env as Record<string, string | undefined>;
  const saved = { node: env.NODE_ENV, raw: env[KEY], dev: (globalThis as { __DEV__?: boolean }).__DEV__ };
  env.NODE_ENV = 'production';
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  if (raw === undefined) delete env[KEY];
  else env[KEY] = raw;
  let value = false;
  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      value = require('../featureFlags').featureFlags.iosHideNonP2PPurchases;
    });
  } finally {
    env.NODE_ENV = saved.node;
    if (saved.raw === undefined) delete env[KEY];
    else env[KEY] = saved.raw;
    (globalThis as { __DEV__?: boolean }).__DEV__ = saved.dev;
  }
  return value;
}

describe('iOS non-P2P hide flag in a release bundle', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['maybe', true],
    ['true', true],
    ['1', true],
    ['false', false],
  ])('raw %p → %p', (raw, expected) => {
    expect(loadFlag(raw)).toBe(expected);
  });

  it('even an explicit "false" bundle cannot show non-P2P purchases on an OTA-capable iOS binary', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nonP2PPurchasesHidden } = require('../purchaseSurfaces');
    expect(nonP2PPurchasesHidden('ios', loadFlag('false'), 6, false)).toBe(true);
    expect(nonP2PPurchasesHidden('ios', loadFlag('false'), null, false)).toBe(true);
    expect(nonP2PPurchasesHidden('android', loadFlag(undefined), 6, false)).toBe(false);
  });
});
