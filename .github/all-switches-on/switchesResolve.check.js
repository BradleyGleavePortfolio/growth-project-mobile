/**
 * ALL-ON-CI-M: run only by the "All switches on (not required)" job, after
 * switches.js find has set every switch. Its name ends in .check.js, so the
 * normal suite never picks it up. It proves the switches the job set really
 * read on inside jest; a switch that stays off here cannot be turned on by env.
 */
const { featureFlags } = require('../../src/config/featureFlags');
const { aiGatewayFlags } = require('../../src/config/aiGatewayFlags');

const names = (process.env.ALL_SWITCHES_ON_NAMES || '').split(',').filter(Boolean);

test('the job turned switches on', () => {
  expect(names.length).toBeGreaterThan(10);
  expect(names.filter((n) => process.env[n] !== '1')).toEqual([]);
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
