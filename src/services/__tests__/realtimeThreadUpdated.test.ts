/**
 * messaging v2 realtime: `thread-updated` rides the same `messages:<userId>`
 * channel as `new-message` (one subscription), its ID-only payload is parsed
 * strictly, and a throwing handler never reaches the realtime client.
 */
const mockHandlers: Record<string, (msg: unknown) => void> = {};
interface MockChannel {
  on: jest.Mock;
  subscribe: jest.Mock;
}
const mockChannel: MockChannel = {
  on: jest.fn((_type: string, filter: { event: string }, cb: (msg: unknown) => void): MockChannel => {
    mockHandlers[filter.event] = cb;
    return mockChannel;
  }),
  subscribe: jest.fn((): MockChannel => mockChannel),
};
const mockRemove = jest.fn();
const mockChannelFactory = jest.fn((_name: string, _opts?: unknown) => mockChannel);
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ channel: mockChannelFactory, removeChannel: mockRemove }),
}));
jest.mock('../../config/env', () => ({ env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' } }));

import { parseThreadUpdated, subscribeToMessages } from '../realtime';

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockHandlers)) delete mockHandlers[k];
});

describe('parseThreadUpdated', () => {
  it('reads the backend envelope and drops malformed pings', () => {
    expect(
      parseThreadUpdated({ type: 'broadcast', event: 'thread-updated', payload: { kind: 'edited', thread_client_id: 'c1', message_id: 'm1' } }),
    ).toEqual({ kind: 'edited', threadClientId: 'c1', messageId: 'm1' });
    expect(parseThreadUpdated({ payload: { kind: 'read', thread_client_id: 'c1', message_id: null } })).toEqual({
      kind: 'read',
      threadClientId: 'c1',
      messageId: null,
    });
    expect(parseThreadUpdated({ payload: { kind: 'typing', thread_client_id: 'c1' } })).toBeNull();
    expect(parseThreadUpdated({ payload: { kind: 'read' } })).toBeNull();
    expect(parseThreadUpdated(null)).toBeNull();
  });
});

describe('subscribeToMessages with onThreadUpdated', () => {
  it('listens to both events on one channel and routes each to its handler', () => {
    const onPing = jest.fn();
    const onUpdate = jest.fn();
    const unsubscribe = subscribeToMessages('u1', onPing, onUpdate);
    expect(mockChannelFactory).toHaveBeenCalledTimes(1);
    expect(mockChannelFactory.mock.calls[0][0]).toBe('messages:u1');
    expect(Object.keys(mockHandlers).sort()).toEqual(['new-message', 'thread-updated']);

    mockHandlers['thread-updated']({ payload: { kind: 'pinned', thread_client_id: 'c1', message_id: 'm2' } });
    expect(onUpdate).toHaveBeenCalledWith({ kind: 'pinned', threadClientId: 'c1', messageId: 'm2' });
    expect(onPing).not.toHaveBeenCalled();

    mockHandlers['new-message']({});
    expect(onPing).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(mockRemove).toHaveBeenCalledWith(mockChannel);
  });

  it('without onThreadUpdated only new-message is bound (legacy callers unchanged)', () => {
    subscribeToMessages('u2', jest.fn());
    expect(Object.keys(mockHandlers)).toEqual(['new-message']);
  });

  it('a throwing handler is contained', () => {
    subscribeToMessages('u3', jest.fn(), () => {
      throw new Error('boom');
    });
    expect(() =>
      mockHandlers['thread-updated']({ payload: { kind: 'read', thread_client_id: 'c1', message_id: null } }),
    ).not.toThrow();
  });
});
