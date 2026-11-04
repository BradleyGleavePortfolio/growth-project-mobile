/**
 * ALL-ON-CI-M: the server switch state the community payloads carry
 * (feature_flag_state, and the /community/me flags map) reads on in the
 * all-on job even when the payload says disabled. Run by the proof step only.
 */
jest.mock('../../src/services/api', () => {
  const payloads = {
    '/community/me': {
      feature_flag_state: 'disabled',
      workspace_id: null,
      membership: null,
      unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
      flags: { community_api: false, community_dm: false, community_realtime: false, community_push: false, community_telemetry: false },
    },
    '/community/today': { feature_flag_state: 'disabled', cohort: null, event: null, pinned_post: null, challenge: null, empty_reason: null },
    '/community/cohorts': { feature_flag_state: 'disabled', cohorts: [] },
  };
  const get = (url) => Promise.resolve({ data: payloads[url] });
  return { __esModule: true, default: { get } };
});

const { communityApi } = require('../../src/api/communityApi');

test('every community payload switch reads on', async () => {
  const me = await communityApi.getMe();
  const today = await communityApi.getToday();
  const cohorts = await communityApi.getCohorts();
  expect([me, today, cohorts].map((r) => r.feature_flag_state)).toEqual(['enabled', 'enabled', 'enabled']);
  expect(Object.keys(me.flags).filter((k) => me.flags[k] !== true)).toEqual([]);
});
