import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const mockPublish = jest.fn();
jest.mock('../useVoiceUpload', () => ({
  publishVoiceNote: (...args: unknown[]) => mockPublish(...args),
}));
jest.mock('../../lib/userCache', () => ({
  readUserCache: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../config/featureFlags', () => ({
  featureFlags: {
    ...jest.requireActual('../../config/featureFlags').featureFlags,
    communityVoiceNotes: true,
  },
}));

import { authEvents } from '../../utils/authEvents';
import { resetVoiceOutbox, useVoiceOutbox } from '../useVoiceOutbox';
import type { VoiceOutboxItem } from '../useVoiceOutbox';

const net = NetInfo as unknown as { __reset: () => void };
const STORE_KEY = 'tgp.voiceOutbox.v1';

afterEach(() => {
  jest.restoreAllMocks();
  resetVoiceOutbox();
  net.__reset();
});

it('LS871R7 BF-2: a restore started by the old account cannot publish after logout and account change', async () => {
  net.__reset();
  resetVoiceOutbox(true);
  await AsyncStorage.clear();
  mockPublish.mockReset().mockResolvedValue({ id: 'unexpected-note' });
  const saved: VoiceOutboxItem = {
    id: 'saved-before-logout',
    authorId: 'author-a',
    workspaceId: 'workspace-a',
    input: {
      uri: 'file:///recording-a.m4a',
      durationMs: 3000,
      bytes: 100,
      mimeType: 'audio/mp4',
      cohortId: 'space-a',
    },
    peaks: [],
    status: 'waiting',
  };
  let finishRestore: (raw: string | null) => void = () => undefined;
  const pendingRead = new Promise<string | null>((resolve) => { finishRestore = resolve; });
  const read = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key) =>
    key === STORE_KEY ? pendingRead : null,
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = await renderHook(
    ({ authorId }: { authorId: string }) => useVoiceOutbox('workspace-a', authorId),
    { wrapper: Wrapper, initialProps: { authorId: 'author-a' } },
  );
  try {
    await waitFor(() => expect(read).toHaveBeenCalledWith(STORE_KEY));
    await act(async () => { authEvents.emit('logout'); });
    await hook.rerender({ authorId: 'author-b' });
    await act(async () => {
      finishRestore(JSON.stringify([saved]));
      await pendingRead;
    });
    expect(hook.result.current.items).toHaveLength(0);
    expect(mockPublish).not.toHaveBeenCalled();
  } finally {
    await hook.unmount();
    qc.clear();
  }
});
