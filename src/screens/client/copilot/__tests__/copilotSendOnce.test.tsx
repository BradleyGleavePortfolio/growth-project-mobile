/**
 * SEND-ONCE-PHONE (182-S10, the phone half of b#1228), write 5 of 5 from its second screen: a Copilot question is a
 * Roman turn (POST /roman/sessions/:id/messages, with the Copilot opt-in). Try again after no answer, a timeout or a
 * 5xx, and asking the same words again after a cut stream, send the same Idempotency-Key, so the server answers from
 * what the first send stored; new words, an answer, or a refusal that ends the key (a 400 / 409, a coded frame) make a
 * new key. The key travels in the call's options (romanApi puts it in the header), never in the question.
 */
import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { error: jest.fn(), success: jest.fn() } }));

import { RomanApiError, RomanKeySpentError, RomanWireError } from '../../../../api/romanApi';
import { useCopilotAsk } from '../useCopilotAsk';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NO_ANSWER = new RomanApiError('offline', 'No answer.');
const TIMEOUT = new RomanApiError('generic', 'Timed out.');
const SERVER_DOWN = new RomanApiError('generic', 'Roman is not available right now.');
// The 200 came and the body did not (romanApi: turnStored), or it ended with no done frame (RomanWireError).
const CUT_STREAM = new RomanApiError('offline', 'No answer.', undefined, undefined, true);
const NO_DONE_FRAME = new RomanWireError('roman stream completed without a terminal `done` chunk');
const REFUSED = new RomanKeySpentError('generic', 'That request did not complete.');
const NO_REPLY_FRAME = new RomanKeySpentError('unavailable', 'Roman is not available right now.', undefined, undefined, true);
const ANSWER = { text: 'Because your week changed.', messageId: 'm-1', interrupted: false };

const open = jest.fn(async () => ({ id: 'sess-1', surface: 'client', messageCount: 0 }));
const send = jest.fn();
const deps = { open, send } as unknown as Parameters<typeof useCopilotAsk>[0];

/** Send `n`: its question and key (the key must be a v4 uuid in the options, never missing). */
const sent = (n: number): { question: string; key: string } => {
  const [sessionId, question, opts] = send.mock.calls[n] as [string, string, { copilot?: boolean; idempotencyKey?: string }];
  expect(sessionId).toBe('sess-1');
  expect(opts).toEqual({ copilot: true, idempotencyKey: expect.stringMatching(UUID) });
  return { question, key: opts.idempotencyKey as string };
};

const mount = async () => renderHook(() => useCopilotAsk(deps));
type Hook = Awaited<ReturnType<typeof mount>>['result'];
const ask = async (result: Hook, text: string, retryId?: string) => {
  let outcome: string | undefined;
  await act(async () => { outcome = await result.current.ask(text, retryId); });
  return outcome;
};

beforeEach(() => {
  open.mockClear();
  send.mockReset().mockResolvedValue(ANSWER);
});

it.each([
  ['no answer', NO_ANSWER],
  ['a timeout', TIMEOUT],
  ['a 5xx', SERVER_DOWN],
])('Try again after %s sends the same question with the same key', async (_label, err) => {
  const { result } = await mount();
  send.mockRejectedValueOnce(err);
  expect(await ask(result, 'Why did my calories change?')).toBe('failed');
  const turn = result.current.turns[0];
  expect(await ask(result, turn.question, turn.id)).toBe('sent');
  expect(sent(1)).toEqual(sent(0));
});

it.each([
  ['a cut stream', CUT_STREAM],
  ['a stream with no done frame', NO_DONE_FRAME],
])('asking the same words again after %s (the question may be stored) sends the same key', async (_label, err) => {
  const { result } = await mount();
  send.mockRejectedValueOnce(err);
  expect(await ask(result, 'Why did my calories change?')).toBe('stored');
  expect(await ask(result, 'Why did my calories change?')).toBe('sent');
  expect(sent(1)).toEqual(sent(0));
});

it('new words after a failure make a new key', async () => {
  const { result } = await mount();
  send.mockRejectedValueOnce(NO_ANSWER);
  await ask(result, 'Why did my calories change?');
  await ask(result, 'Why did my target change?');
  expect(sent(1).question).toBe('Why did my target change?');
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('an answer ends the key: the same words asked again are a new question with a new key', async () => {
  const { result } = await mount();
  await ask(result, 'How was my week?');
  await ask(result, 'How was my week?');
  expect(sent(1).key).not.toBe(sent(0).key);
});

it.each([
  ['a 400 / 409 refusal', REFUSED],
  ['a coded no-reply frame', NO_REPLY_FRAME],
])('after %s the next send of the same words makes a new key', async (_label, err) => {
  const { result } = await mount();
  send.mockRejectedValueOnce(err);
  await ask(result, 'Why did my calories change?');
  const turn = result.current.turns[0];
  await ask(result, turn.question, turn.id);
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('each failed turn keeps its own key: another question in between never takes it (LS-953 B1)', async () => {
  const { result } = await mount();
  send.mockRejectedValueOnce(NO_ANSWER).mockRejectedValueOnce(NO_ANSWER);
  await ask(result, 'Why did my calories change?');
  await ask(result, 'Why did my target change?');
  const [one, two] = result.current.turns;
  expect(await ask(result, two.question, two.id)).toBe('sent');
  expect(await ask(result, one.question, one.id)).toBe('sent');
  expect(sent(2)).toEqual(sent(1));
  expect(sent(3)).toEqual(sent(0));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('a refusal that ends a key ends it for every turn that holds it', async () => {
  const { result } = await mount();
  send.mockRejectedValueOnce(NO_ANSWER).mockRejectedValueOnce(REFUSED);
  await ask(result, 'Why did my calories change?');
  const first = result.current.turns[0];
  await ask(result, 'Why did my calories change?'); // the same words asked again: the same key, refused
  expect(sent(1)).toEqual(sent(0));
  await ask(result, first.question, first.id);
  expect(sent(2).key).not.toBe(sent(0).key);
});
