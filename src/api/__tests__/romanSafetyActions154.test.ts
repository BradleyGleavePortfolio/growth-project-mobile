/**
 * CRISIS-BTN (owner "#CRISIS-2B - all 3 buttons"): the server marker on
 * Roman's fixed crisis reply. Every Roman read accepts it whatever the flag
 * (history, live `done` chunk, transcript), keeps only the codes this build
 * knows, and a reply without it maps exactly as before. A malformed marker
 * reads as no marker, so the reply itself always shows.
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as { get: jest.Mock };

const SESSION = 'cmg9x2k3l0000abcd1234efgh';
const ALL = ['call_988', 'text_988', 'message_coach'];
const wire = (over: Record<string, unknown> = {}) => ({
  id: 'cm1', role: 'roman', content: 'Fixed reply.', interrupted: false, createdAt: '2026-10-17T08:00:00.000Z', ...over,
});

beforeEach(() => api.get.mockReset());

it('keeps known codes once each in a fixed order and drops the rest', () => {
  expect(toSafetyActions(undefined)).toBeUndefined();
  expect(toSafetyActions([])).toBeUndefined();
  expect(toSafetyActions(['later_code'])).toBeUndefined();
  expect(toSafetyActions(['message_coach', 'later_code', 'call_988', 'call_988', 'text_988'])).toEqual(ALL);
  expect(toSafetyActions(['text_988', 'call_988'])).toEqual(['call_988', 'text_988']);
});

it('the strict schemas accept the marker and still reject any other extra field', () => {
  expect(RomanWireMessageSchema.safeParse(wire({ safety_actions: ALL })).success).toBe(true);
  expect(RomanWireMessageSchema.safeParse(wire({ other: 1 })).success).toBe(false);
  expect(RomanStreamChunkSchema.safeParse({ type: 'done', text: 'x', messageId: 'cm1', interrupted: false, safety_actions: ALL }).success).toBe(true);
  const bad = RomanWireMessageSchema.safeParse(wire({ safety_actions: 'call_988' }));
  expect(bad.success && bad.data.safety_actions).toBeUndefined();
});

it('history: a marked reply carries its actions, an unmarked one maps as before', async () => {
  api.get.mockResolvedValueOnce({
    data: { messages: [wire({ id: 'cm2', safety_actions: ['message_coach', 'call_988', 'text_988'] }), wire()], nextCursor: null },
  });
  const page = await listMessages(SESSION, { limit: 10 });
  expect(page.messages[0].safetyActions).toEqual(ALL);
  expect(page.messages[1]).not.toHaveProperty('safetyActions');
  expect(page.messages[1]).toEqual({ id: 'cm1', role: 'assistant', content: 'Fixed reply.', interrupted: false, createdAt: '2026-10-17T08:00:00.000Z' });
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

  it('carries the coachless pair from the marker', async () => {
    respond(`data: {"type":"done","text":"Fixed reply.","messageId":"cm3","interrupted":false,"safety_actions":["call_988","text_988"]}\n\n`);
    expect(await sendMessage(SESSION, 'hello')).toEqual({
      text: 'Fixed reply.', messageId: 'cm3', interrupted: false, safetyActions: ['call_988', 'text_988'],
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
    data: { messages: [wire({ id: 'cm2', safety_actions: ['call_988', 'text_988'] }), wire({ role: 'user', content: 'Hi' })], nextCursor: null },
  });
  const out = await romanChatsApi.readMessages({ subject: 'sub:user-a', epoch: authEpoch() }, SESSION);
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.value.messages[0].safetyActions).toEqual(['call_988', 'text_988']);
  expect(out.value.messages[1]).not.toHaveProperty('safetyActions');
});
