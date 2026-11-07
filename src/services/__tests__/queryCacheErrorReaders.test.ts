/**
 * FIX-955R1 (LS-955 B1): a saved error is a closed record (persistableError
 * in src/services/queryClient.ts). Every reader of a restored error reads it
 * exactly as it read the error main saved.
 *
 * before = JSON.parse(JSON.stringify(err))                     (main's save path)
 * after  = JSON.parse(JSON.stringify(persistableError(err)))   (this fix)
 *
 * One table: every error shape a saved query can hold x every reader of a
 * restored error (file:line at this head). Readers that are not exported are
 * their read, copied as written.
 */
jest.mock('../sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../utils/idempotency', () => ({
  ...jest.requireActual('../../utils/idempotency'),
  randomUuid: () => '0f0e0d0c-0b0a-4000-8000-000000000001',
}));

import { AxiosError, AxiosHeaders, CanceledError, type InternalAxiosRequestConfig } from 'axios';
import { z } from 'zod';

import { persistableError } from '../queryClient';
import { CommunityApiError, classify } from '../../api/apiCall';
import { describeCommunityFailure } from '../../api/communityErrors';
import { MessagingApiError, toMessagingError } from '../../api/messagingV2Api';
import { RosterIncompleteError } from '../../api/programsApi';
import { WearableSamplesError } from '../../api/wearablesSamplesApi';
import { calendarErrorMessage } from '../../calendar/schedulingErrors';
import { isNoAccess } from '../../components/community/space-chat/spaceChatApi';
import { COACHING_BLOCKED, isClosedRefusal } from '../../components/messaging/closedRefusal';
import { isConnectionFailure, loadFailureMessage } from '../../ui/states/QuietStates';
import { describeProgramFailure } from '../../utils/programErrors';

const TOKEN = 'FAKE.TEST.TOKEN';
const SIGNED_URL = 'https://storage.example.test/v1/x?X-Amz-Signature=FAKESIGNATURE0123456789';

function axiosFailure(status: number | null, data: unknown = {}, code = 'ERR_NETWORK'): AxiosError {
  const config = {
    url: SIGNED_URL,
    method: 'get',
    headers: new AxiosHeaders({ Authorization: `Bearer ${TOKEN}`, 'X-Request-Id': '9b2f1c4e-0000-4000-8000-000000000003' }),
  } as InternalAxiosRequestConfig;
  if (status === null) return new AxiosError(code === 'ERR_NETWORK' ? 'Network Error' : `timeout ${SIGNED_URL}`, code, config, {});
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

function community(status: number | null, data?: unknown): CommunityApiError {
  const s = status ?? 0;
  return new CommunityApiError(classify(s), s, `community request failed (${s || 'network'})`, axiosFailure(status, data));
}

/** Who can hold the shape: only the community reader below is limited to community queries. */
type Family = 'request' | 'community' | 'messaging' | 'wearables' | 'app' | 'thrown';

const SHAPES: Array<[string, Family, unknown]> = [
  ['a raw AxiosError, no answer (ERR_NETWORK)', 'request', axiosFailure(null)],
  ['a raw AxiosError, timed out (ECONNABORTED)', 'request', axiosFailure(null, {}, 'ECONNABORTED')],
  ['a raw AxiosError, timed out (ETIMEDOUT)', 'request', axiosFailure(null, {}, 'ETIMEDOUT')],
  ['a raw AxiosError, 403 closed answer', 'request', axiosFailure(403, { code: 'community.dm.blocked_by_them' })],
  ['a raw AxiosError, 403 coaching refusal', 'request', axiosFailure(403, { message: COACHING_BLOCKED })],
  ['a raw AxiosError, 404', 'request', axiosFailure(404, { code: 'program_not_found' })],
  ['a raw AxiosError, 500', 'request', axiosFailure(500, { message: SIGNED_URL })],
  ['a canceled request', 'request', new CanceledError('canceled')],
  ['CommunityApiError network', 'community', community(null)],
  ['CommunityApiError unauthorized', 'community', community(401)],
  ['CommunityApiError forbidden', 'community', community(403, { code: 'community.workspace.no_access' })],
  ['CommunityApiError not found', 'community', community(404)],
  ['CommunityApiError conflict', 'community', community(409)],
  ['CommunityApiError gone', 'community', community(410)],
  ['CommunityApiError server', 'community', community(503)],
  ['CommunityApiError contract', 'community', new CommunityApiError('contract', 200, 'shape drifted', z.object({ id: z.string() }).safeParse({}).error)],
  ['CommunityApiError not a request (-1)', 'community', new CommunityApiError('unknown', -1, 'request failed', new Error(SIGNED_URL))],
  ['a CommunityApiError restored from an old blob', 'community', JSON.parse(JSON.stringify(community(404)))],
  ['MessagingApiError blocked code', 'messaging', new MessagingApiError('http', 403, 'messaging.blocked', 'You cannot change this message.')],
  ['MessagingApiError DM blocked by me', 'messaging', new MessagingApiError('http', 403, 'community.dm.blocked_by_you', 'x')],
  ['MessagingApiError coaching refusal', 'messaging', new MessagingApiError('http', 403, null, COACHING_BLOCKED)],
  ['MessagingApiError server text', 'messaging', new MessagingApiError('http', 400, null, `server said ${SIGNED_URL}`)],
  ['MessagingApiError network', 'messaging', new MessagingApiError('network', 0, null, 'No connection right now.')],
  ['RosterIncompleteError', 'app', new RosterIncompleteError()],
  ['WearableSamplesError 403', 'wearables', new WearableSamplesError('forbidden', 403, 'samples', axiosFailure(403))],
  ['WearableSamplesError 400', 'wearables', new WearableSamplesError('bad_request', 400, 'samples', axiosFailure(400))],
  ['a plain Error', 'app', new Error(SIGNED_URL)],
  ["a plain Error('Network Error') (message not enumerable)", 'app', new Error('Network Error')],
  ['a TypeError', 'app', new TypeError('x is undefined')],
  ['a thrown string', 'thrown', `failed ${SIGNED_URL}`],
  ['an empty thrown string', 'thrown', ''],
  ['a thrown number', 'thrown', 0],
  ['a thrown array', 'thrown', [SIGNED_URL]],
  ['a plain object with a no-answer code', 'thrown', { code: 'ERR_NETWORK', detail: SIGNED_URL }],
  ['a plain object with a status', 'thrown', { status: 403, reason: TOKEN }],
  ['a plain object with a closed code', 'thrown', { code: 'community.cohort.no_access', status: 403 }],
  ['a toJSON record', 'thrown', { toJSON: () => ({ status: 404, message: 'Network Error', detail: SIGNED_URL }) }],
  ['null', 'thrown', null],
  ['undefined', 'thrown', undefined],
];

type Reader = [string, (err: unknown) => unknown, Family[] | 'all'];

const READERS: Reader[] = [
  // savedRequestFailure (src/api/communityErrors.ts:236-246) is read through describeCommunityFailure. Its restored
  // errors are community queries' (CommunityScreen.tsx:120, CommunitySafetyScreen.tsx:111/:116, CommunitySpaceScreen.tsx:146,
  // ...): a CommunityApiError, a raw AxiosError, or an error call() passes on; never a messaging or wearables error.
  ['describeCommunityFailure, src/api/communityErrors.ts:292', (e) => describeCommunityFailure(e, 'load_posts'), ['request', 'community', 'app', 'thrown']],
  ['isConnectionFailure, src/ui/states/QuietStates.tsx:116', isConnectionFailure, 'all'],
  ['loadFailureMessage, src/ui/states/QuietStates.tsx:134', (e) => loadFailureMessage(e, 'Your lessons'), 'all'],
  ['calendarErrorMessage (client), src/calendar/schedulingErrors.ts:111', (e) => calendarErrorMessage(e, 'load open times'), 'all'],
  ['calendarErrorMessage (coach), src/calendar/schedulingErrors.ts:111', (e) => calendarErrorMessage(e, 'load your schedule', 'coach'), 'all'],
  ['describeProgramFailure, src/utils/programErrors.ts:233', (e) => describeProgramFailure(e, 'load the program'), 'all'],
  ['isClosedRefusal, src/components/messaging/closedRefusal.ts:34', isClosedRefusal, 'all'],
  ['toMessagingError, src/api/messagingV2Api.ts:217 (CoachInboxV2.tsx:303)', (e) => {
    const m = toMessagingError(e);
    return { kind: m.kind, status: m.status, code: m.code, userMessage: m.userMessage, off: m.isFeatureDisabled };
  }, 'all'],
  ['isNoAccess, src/components/community/space-chat/spaceChatApi.ts:154', isNoAccess, 'all'],
  ['refusalSide, src/components/messaging/ConversationClosed.tsx:53-62 (copied)', function refusalSide(err: unknown, depth = 0): unknown {
    if (!err || typeof err !== 'object') return undefined;
    const e = err as { code?: unknown; cause?: unknown; response?: { data?: { code?: unknown } } };
    const inner = depth < 2 && e.cause ? refusalSide(e.cause, depth + 1) : undefined;
    if (inner !== undefined) return inner;
    const code = typeof e.response?.data?.code === 'string' ? e.response.data.code : e.code;
    if (code === 'community.dm.blocked_by_you') return 'me';
    if (code === 'community.dm.blocked_by_them') return 'them';
    return undefined;
  }, 'all'],
  ['refusedBy, src/components/community/space-chat/SpaceVoiceNote.tsx:27 (copied)',
    (err) => [403, 404].includes((err as { status?: number } | null)?.status ?? 0), 'all'],
  ['isForbidden, src/screens/coach/client-detail/SleepRecoveryTab.tsx:57-63 (copied; a restored error is never an instance)',
    (error) => (error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status === 403 : false), 'all'],
  // A community query holds a CommunityApiError, or an error call() passes on (apiCall.ts).
  ['errorKind, src/hooks/useReconstructCounts.ts:75-77 (copied)',
    (err) => (err && typeof err === 'object' && 'kind' in err ? (err as { kind: unknown }).kind : 'unknown'), ['community', 'app', 'thrown']],
  ['a screen that tests the error itself (q.error ? ... : ...)', (e) => !!e, 'all'],
];

function roundTrip(value: unknown): unknown {
  const json = JSON.stringify(value);
  return json === undefined ? undefined : JSON.parse(json);
}

beforeEach(() => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // the calendar's fallback reference
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(SHAPES)('a saved %s', (_label, family, err) => {
  const before = roundTrip(err);
  const after = roundTrip(persistableError(err));

  it('saves no credential, address or server text', () => {
    expect(JSON.stringify(after) ?? '').not.toMatch(/bearer|authorization|FAKE\.TEST\.TOKEN|X-Amz|storage\.example|server said/i);
  });

  it.each(READERS.filter(([, , families]) => families === 'all' || families.includes(family)))(
    'reads the same for %s',
    (_reader, read) => {
      expect(read(after)).toEqual(read(before));
    },
  );
});

it('control: main saved the token with a request failure', () => {
  expect(JSON.stringify(community(404))).toContain(`Bearer ${TOKEN}`);
  expect(JSON.stringify(axiosFailure(500))).toContain(SIGNED_URL);
});
