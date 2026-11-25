/**
 * TOKEN-CACHE-M: a community error restored from the phone cache reads
 * exactly as it read before saved errors were cut down to plain fields.
 *
 * before = JSON.parse(JSON.stringify(err))                     (main's save path)
 * after  = JSON.parse(JSON.stringify(persistableError(err)))   (this fix)
 *
 * For every error shape a community query can save, and every action a saved
 * community query is described with, describeCommunityFailure gives the same
 * title, words, code, status and reference for both.
 */
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../utils/idempotency', () => ({
  ...jest.requireActual('../../utils/idempotency'),
  randomUuid: () => '0f0e0d0c-0b0a-4000-8000-000000000001',
}));

import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { z } from 'zod';

import { CommunityApiError, classify } from '../apiCall';
import { describeCommunityFailure, type CommunityAction } from '../communityErrors';
import { persistableError } from '../../services/queryClient';

const TOKEN = 'FAKE.TEST.TOKEN';

function axiosFailure(status: number | null, data: unknown = {}): AxiosError {
  const config = {
    url: '/v1/community/blocks',
    method: 'get',
    headers: new AxiosHeaders({ Authorization: `Bearer ${TOKEN}`, 'X-Request-Id': '9b2f1c4e-0000-4000-8000-000000000002' }),
  } as InternalAxiosRequestConfig;
  if (status === null) return new AxiosError('Network Error', 'ERR_NETWORK', config, {});
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

/** What call() (apiCall.ts:61-81) and the API files that copy it build. */
function fromRequest(status: number | null, data?: unknown): CommunityApiError {
  const s = status ?? 0;
  return new CommunityApiError(classify(s), s, `community request failed (${s || 'network'})`, axiosFailure(status, data));
}
const zodError = z.object({ id: z.string() }).safeParse({}).error;

const SAVED_SHAPES: Array<[string, unknown]> = [
  ['no answer (network)', fromRequest(null)],
  ['401', fromRequest(401)],
  ['403 with a mapped code', fromRequest(403, { code: 'community.forbidden', message: 'No.' })],
  ['404', fromRequest(404)],
  ['409', fromRequest(409)],
  ['410', fromRequest(410)],
  ['503', fromRequest(503)],
  ['answer of the wrong shape (contract)', new CommunityApiError('contract', 200, 'shape drifted', zodError)],
  ['not a request (unknown, -1)', new CommunityApiError('unknown', -1, 'request failed', new Error('boom'))],
  ['a raw AxiosError with an answer', axiosFailure(404, { code: 'community.post.gone' })],
  ['a raw AxiosError with no answer', axiosFailure(null)],
  ['a plain Error', new Error('boom')],
];
const SAVED_READER_ACTIONS: CommunityAction[] = [
  'load_wins', // src/screens/client/CommunityScreen.tsx:120
  'load_blocks', // src/screens/community/CommunitySafetyScreen.tsx:111
  'load_notices', // src/screens/community/CommunitySafetyScreen.tsx:116
  'load_posts', // src/screens/community/CommunitySpaceScreen.tsx:146
  'load_challenge', // src/screens/community/CommunityChallengeDetailScreen.tsx:132
];

describe.each(SAVED_SHAPES)('a saved %s', (_label, err) => {
  const before = JSON.parse(JSON.stringify(err) ?? 'null');
  const after = JSON.parse(JSON.stringify(persistableError(err)) ?? 'null');

  it('no longer saves the token', () => {
    expect(JSON.stringify(after)).not.toMatch(/FAKE\.TEST\.TOKEN|bearer|authorization/i);
  });

  it.each(SAVED_READER_ACTIONS)('reads the same for %s', (action) => {
    expect(describeCommunityFailure(after, action)).toEqual(describeCommunityFailure(before, action));
  });
});

it('control: main saved the token with every request failure', () => {
  expect(JSON.stringify(fromRequest(404))).toContain(`Bearer ${TOKEN}`);
  expect(JSON.stringify(axiosFailure(null))).toContain(`Bearer ${TOKEN}`);
});
