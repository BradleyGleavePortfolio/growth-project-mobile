/**
 * Completion detection: each gated step completes only on the real product
 * action's success path.
 *   - meal logged: POST /log/food 2xx (every online log path goes through
 *     logApi.logFood) or an entry accepted by the offline queue;
 *   - message sent: POST /messages 2xx (messagesApi.send and the reply path);
 *   - wearable connected: an on-device grant / OAuth success (covered in
 *     ConnectProviderSheet.test.tsx) or a `connected` row in the connections
 *     list (hasConnectedWearable, below);
 *   - explicit deferral is a machine action (tutorialMachine.test.ts).
 * Failures never emit.
 */
import api, { logApi, messagesApi } from '../../services/api';
import { messagesModerationApi } from '../../api/messagesApi';
import { enqueue } from '../../services/foodLogQueue';
import { subscribeTutorialSignals, withTutorialSignal } from '../tutorialEvents';
import { hasConnectedWearable } from '../../components/tutorial/TutorialHost';
import type { TutorialSignal } from '../types';

const seen: TutorialSignal[] = [];
let unsub: () => void = () => undefined;

beforeEach(() => {
  seen.length = 0;
  unsub = subscribeTutorialSignals((s) => seen.push(s));
});
afterEach(() => {
  unsub();
  jest.restoreAllMocks();
});

const ok = (data: unknown = {}) => Promise.resolve({ data, status: 201 } as never);

describe('meal logged', () => {
  it('emits after POST /log/food succeeds and passes the response through', async () => {
    const post = jest.spyOn(api, 'post').mockImplementation(() => ok({ id: 'log-1' }));
    const res = await logApi.logFood({ date: '2026-10-01', meal_type: 'breakfast', food_item_id: 'f1' });
    expect(post).toHaveBeenCalledWith('/log/food', expect.objectContaining({ food_item_id: 'f1' }));
    expect((res as { data: { id: string } }).data.id).toBe('log-1');
    expect(seen).toEqual(['meal_logged']);
  });

  it('does not emit when the log fails', async () => {
    jest.spyOn(api, 'post').mockImplementation(() => Promise.reject(new Error('500')));
    await expect(
      logApi.logFood({ date: '2026-10-01', meal_type: 'lunch', food_item_id: 'f1' }),
    ).rejects.toThrow('500');
    expect(seen).toEqual([]);
  });

  it('emits when the offline queue accepts an entry', async () => {
    await enqueue({
      kind: 'manual',
      food: { name: 'Water' },
      log: { date: '2026-10-01', meal_type: 'snack' },
    } as never);
    expect(seen).toEqual(['meal_logged']);
  });
});

describe('message sent', () => {
  it('emits after POST /messages succeeds', async () => {
    jest.spyOn(api, 'post').mockImplementation(() => ok({ id: 'm1', body: 'Hi' }));
    await messagesApi.send('Hi');
    expect(seen).toEqual(['message_sent']);
  });

  it('emits after a threaded reply succeeds', async () => {
    jest.spyOn(api, 'post').mockImplementation(() => ok({ id: 'm2', body: 'Thanks' }));
    await messagesModerationApi.sendReply({ body: 'Thanks', parent_message_id: 'm1' });
    expect(seen).toEqual(['message_sent']);
  });

  it('does not emit when sending fails', async () => {
    jest.spyOn(api, 'post').mockImplementation(() => Promise.reject(new Error('offline')));
    await expect(messagesApi.send('Hi')).rejects.toThrow('offline');
    expect(seen).toEqual([]);
  });
});

describe('wearable connected', () => {
  it('counts only a connected row', () => {
    expect(hasConnectedWearable([{ status: 'connected', provider: 'APPLE_HEALTHKIT' }])).toBe(true);
    expect(hasConnectedWearable([{ status: 'disconnected' }, { status: 'error' }])).toBe(false);
    expect(hasConnectedWearable(undefined)).toBe(false);
    expect(hasConnectedWearable([null])).toBe(false);
  });
});

describe('withTutorialSignal', () => {
  it('a throwing listener never breaks the real action', async () => {
    const off = subscribeTutorialSignals(() => {
      throw new Error('listener bug');
    });
    await expect(withTutorialSignal(Promise.resolve(7), 'meal_logged')).resolves.toBe(7);
    off();
  });
});
