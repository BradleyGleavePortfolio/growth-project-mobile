jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'acct-a-1111', role: 'coach', name: 'A' }),
}));

import { renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useChatDraft } from '../lib/chatDrafts';
import { authEvents } from '../utils/authEvents';
import { cacheStorage } from '../storage/mmkv';
import { READERS } from '../../test/savedKeyLifetimes/savedKeyReaders';
import './savedKeyLifetimes.test';

const A = 'acct-a-1111';
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('LS-910R2 B2 QUEUE probes restore through the app reader', () => {
  beforeEach(async () => {
    authEvents.emit('logout');
    await settle();
    await AsyncStorage.clear();
  });

  it('control: the actual chat reader restores a correctly scoped disk draft', async () => {
    await cacheStorage.set(`chat_draft_${A}:reader-control`, JSON.stringify({ text: 'half typed' }));
    const hook = await renderHook(() => useChatDraft('reader-control'));
    try {
      await waitFor(() => expect(hook.result.current[0]).toBe('half typed'));
    } finally {
      await hook.unmount();
    }
  });

  it('LS-910R2 B2 the registered chat QUEUE fixture is readable by the real chat hook', async () => {
    const probe = READERS['cache chat_draft_{uid}'];
    await probe.write(A);
    expect(await probe.read(A)).toBe(true);
    const hook = await renderHook(() => useChatDraft('roman'));
    try {
      await waitFor(() => expect(hook.result.current[0]).toBe('half typed'));
    } finally {
      await hook.unmount();
    }
  });
});
