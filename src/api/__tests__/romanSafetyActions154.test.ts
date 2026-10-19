/**
 * CRISIS-BTN (owner "#CRISIS-2B - all 3 buttons" and "thw call 911 988 buttons
 * - Nevermind, do them!"): the server marker on Roman's fixed crisis reply.
 * Every Roman read accepts it whatever the flag (history, live `done` chunk,
 * transcript), keeps only the codes this build knows in the server's order,
 * and a reply without it maps exactly as before. A malformed marker reads as
 * no marker, so the reply itself always shows.
 */
import { listMessages, RomanStreamChunkSchema, RomanWireMessageSchema, sendMessage } from '../romanApi';
import { romanChatsApi } from '../romanChatsApi';
import { toSafetyActions } from '../romanSafetyActions';
import { authEpoch } from '../../services/accountBinding';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'test-token') },
}));
const mockFlag = { on: false };
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  const featureFlags = Object.defineProperty({ ...actual.featureFlags }, 'crisisActions', { get: () => mockFlag.on, enumerable: true });
  return { ...actual, featureFlags };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as { get: jest.Mock };

const SESSION = 'cmg9x2k3l0000abcd1234efgh';
// The server's order: each fixed reply leads with the number it names first.
const EMERGENCY = ['call_911', 'call_988', 'text_988', 'message_coach'];
const SELF_HARM = ['call_988', 'text_988', 'call_911', 'message_coach'];
const wire = (over: Record<string, unknown> = {}) => ({
  id: 'cm1', role: 'roman', content: 'Fixed reply.', interrupted: false, createdAt: '2026-10-17T08:00:00.000Z', ...over,
});

beforeEach(() => {
  api.get.mockReset();
  mockFlag.on = false;
});

it('keeps known codes once each in the server\u2019s order and drops the rest', () => {
  expect(toSafetyActions(undefined)).toBeUndefined();
  expect(toSafetyActions([])).toBeUndefined();
  expect(toSafetyActions(['later_code'])).toBeUndefined();
  expect(toSafetyActions(EMERGENCY)).toEqual(EMERGENCY);
  expect(toSafetyActions(SELF_HARM)).toEqual(SELF_HARM);
  expect(toSafetyActions(['call_911', 'later_code', 'call_988', 'call_988', 'text_988'])).toEqual(['call_911', 'call_988', 'text_988']);
});

it('the strict schemas accept the marker and still reject any other extra field', () => {
  expect(RomanWireMessageSchema.safeParse(wire({ safety_actions: EMERGENCY })).success).toBe(true);
  expect(RomanWireMessageSchema.safeParse(wire({ other: 1 })).success).toBe(false);
  expect(RomanStreamChunkSchema.safeParse({ type: 'done', text: 'x', messageId: 'cm1', interrupted: false, safety_actions: SELF_HARM }).success).toBe(true);
  const bad = RomanWireMessageSchema.safeParse(wire({ safety_actions: 'call_988' }));
  expect(bad.success && bad.data.safety_actions).toBeUndefined();
});

it('history: each marked reply carries its actions in the server\u2019s order, an unmarked one maps as before', async () => {
  api.get.mockResolvedValueOnce({
    data: { messages: [wire({ id: 'cm2', safety_actions: EMERGENCY }), wire({ id: 'cm3', safety_actions: SELF_HARM }), wire()], nextCursor: null },
  });
  const page = await listMessages(SESSION, { limit: 10 });
  expect(page.messages[0].safetyActions).toEqual(EMERGENCY);
  expect(page.messages[1].safetyActions).toEqual(SELF_HARM);
  expect(page.messages[2]).not.toHaveProperty('safetyActions');
  expect(page.messages[2]).toEqual({ id: 'cm1', role: 'assistant', content: 'Fixed reply.', interrupted: false, createdAt: '2026-10-17T08:00:00.000Z' });
});

it('history: a malformed marker never fails the page', async () => {
  api.get.mockResolvedValueOnce({ data: { messages: [wire({ safety_actions: [1, 2] })], nextCursor: null } });
  const page = await listMessages(SESSION, { limit: 10 });
  expect(page.messages[0].content).toBe('Fixed reply.');
  expect(page.messages[0]).not.toHaveProperty('safetyActions');
});

describe('live reply (done chunk)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const respond = (text: string) => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => text }) as unknown as Response);
  };

  it.each([
    ['emergency', ['call_911', 'call_988', 'text_988']],
    ['self-harm', ['call_988', 'text_988', 'call_911']],
  ])('carries the coachless %s calls from the marker, in its order', async (_l, actions) => {
    respond(`data: ${JSON.stringify({ type: 'done', text: 'Fixed reply.', messageId: 'cm3', interrupted: false, safety_actions: actions })}\n\n`);
    expect(await sendMessage(SESSION, 'hello')).toEqual({
      text: 'Fixed reply.', messageId: 'cm3', interrupted: false, safetyActions: actions,
    });
  });

  it('is unchanged without the marker (today\u2019s production backend)', async () => {
    respond('data: {"type":"done","text":"Close, not perfect.","messageId":"cm4","interrupted":false}\n\n');
    expect(await sendMessage(SESSION, 'hello')).toEqual({ text: 'Close, not perfect.', messageId: 'cm4', interrupted: false });
  });
});

it('transcript: the same marker maps on the read-only chat, and its absence changes nothing', async () => {
  api.get.mockResolvedValue({
    status: 200,
    data: { messages: [wire({ id: 'cm2', safety_actions: ['call_911', 'call_988', 'text_988'] }), wire({ role: 'user', content: 'Hi' })], nextCursor: null },
  });
  const out = await romanChatsApi.readMessages({ subject: 'sub:user-a', epoch: authEpoch() }, SESSION);
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.value.messages[0].safetyActions).toEqual(['call_911', 'call_988', 'text_988']);
  expect(out.value.messages[1]).not.toHaveProperty('safetyActions');
});

describe('the app asks for the marker (backend #1075 header) only with the flag on', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it.each([[false], [true]])('flag on: %s', async (on) => {
    mockFlag.on = on;
    const asked = on ? { 'x-roman-safety-actions': '1' } : undefined;
    api.get.mockResolvedValue({ status: 200, data: { messages: [], nextCursor: null } });
    await listMessages(SESSION, { limit: 10 });
    expect(api.get.mock.calls[0][1].headers).toEqual(asked);
    await romanChatsApi.readMessages({ subject: 'sub:user-a', epoch: authEpoch() }, SESSION);
    expect(api.get.mock.calls[1][1].headers).toEqual(asked);
    const live = jest.fn<Promise<Response>, [string, RequestInit]>(async () => ({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => 'data: {"type":"done","text":"x","messageId":"cm5","interrupted":false}\n\n',
    }) as unknown as Response);
    global.fetch = live as unknown as typeof fetch;
    await sendMessage(SESSION, 'hello');
    expect((live.mock.calls[0][1].headers as Record<string, string>)['x-roman-safety-actions']).toBe(on ? '1' : undefined);
  });
});
