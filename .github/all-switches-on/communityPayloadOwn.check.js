/**
 * ALL-ON-TRIAGE-M: the server switch state the community payloads carry
 * (feature_flag_state, and the /community/me flags map) is the test's own
 * fixture in the all-on job. A disabled fixture stays disabled and an enabled
 * one stays enabled, so the job never hides a disabled-state test nor reaches
 * enabled screens with a disabled fixture. Run by the proof step only.
 */
jest.mock('../../src/services/api', () => {
  const state = (s, flag) => ({
    '/community/me': {
      feature_flag_state: s,
      workspace_id: null,
      membership: null,
      unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
      flags: { community_api: flag, community_dm: flag, community_realtime: flag, community_push: flag, community_telemetry: flag },
    },
    '/community/today': { feature_flag_state: s, cohort: null, event: null, pinned_post: null, challenge: null, empty_reason: null },
    '/community/cohorts': { feature_flag_state: s, cohorts: [] },
  });
  const payloads = { disabled: state('disabled', false), enabled: state('enabled', true) };
  const api = { mode: 'disabled' };
  api.get = (url) => Promise.resolve({ data: payloads[api.mode][url] });
  return { __esModule: true, default: api };
});

const api = require('../../src/services/api').default;
const { communityApi } = require('../../src/api/communityApi');

const read = async () => {
  const me = await communityApi.getMe();
  const today = await communityApi.getToday();
  const cohorts = await communityApi.getCohorts();
  return { states: [me, today, cohorts].map((r) => r.feature_flag_state), flags: Object.values(me.flags) };
};

test("a disabled community fixture stays disabled (the test's own value wins)", async () => {
  api.mode = 'disabled';
  expect(await read()).toEqual({ states: ['disabled', 'disabled', 'disabled'], flags: [false, false, false, false, false] });
});

test('an enabled community fixture stays enabled', async () => {
  api.mode = 'enabled';
  expect(await read()).toEqual({ states: ['enabled', 'enabled', 'enabled'], flags: [true, true, true, true, true] });
});
