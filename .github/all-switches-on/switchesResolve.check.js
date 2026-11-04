/**
 * ALL-ON-CI-M: run only by the "All switches on (not required)" job, after
 * switches.js find has set every switch. Its name ends in .check.js, so the
 * normal suite never picks it up. It proves the switches the job set really
 * read on inside jest; a switch that stays off here cannot be turned on by env.
 */
const { Platform } = require('react-native');
const { featureFlags } = require('../../src/config/featureFlags');
const { aiGatewayFlags } = require('../../src/config/aiGatewayFlags');
const { resolveWalletConfig } = require('../../src/config/wallets');
const { isAndroidHealthConnectEnabled } = require('../../src/config/healthConnect');

function onAndroid(read) {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try {
    return read();
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  }
}

test('the Android Health Connect gate (build metadata) reads on', () => {
  expect(onAndroid(isAndroidHealthConnectEnabled)).toBe(true);
});

test('the Android Google Pay gate (optional switch) reads on', () => {
  expect(resolveWalletConfig({ os: 'android', currency: 'usd', publishableKey: '' }).googlePay).toBeDefined();
});

test('every featureFlags.ts switch reads on', () => {
  expect(Object.keys(featureFlags).filter((k) => featureFlags[k] !== true)).toEqual([]);
});

test('every aiGatewayFlags.ts switch reads on', () => {
  const caps = aiGatewayFlags.capabilities;
  expect(aiGatewayFlags.aiGatewayEnabled).toBe(true);
  expect(aiGatewayFlags.showSourceBadge).toBe(true);
  expect(Object.keys(caps).filter((k) => caps[k] !== true)).toEqual([]);
});
