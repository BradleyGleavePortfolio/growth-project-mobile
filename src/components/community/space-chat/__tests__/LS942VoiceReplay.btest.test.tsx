import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-file-system', () => ({
  Directory: class { create() {} delete() {} },
  File: class { exists = true; delete() {} },
  Paths: { document: 'file:///docs' },
}));
jest.mock('../../../../components/community/space-chat/useSpaceChat', () => ({
  spaceChatKey: (user: string, space: string) => ['community', 'space-chat', user, space],
}));
jest.mock('../../../../api/communityVoiceApi', () => ({
  ...jest.requireActual('../../../../api/communityVoiceApi'),
  communityVoiceApi: { create: jest.fn(), issueUploadUrl: jest.fn(), uploadBytes: jest.fn() },
}));

import { communityVoiceApi } from '../../../../api/communityVoiceApi';
import { useSpaceVoiceOutbox } from '../useSpaceVoiceOutbox';
import { resetVoiceOutbox } from '../../../../hooks/useVoiceOutbox';
import { CommunityApiError } from '../../../../api/apiCall';

const wire = jest.mocked(communityVoiceApi);
const queueKey = 'tgp.voiceOutbox.v1';
const originalKey = 'viewer-a/original-committed-key';
const replacementKey = 'viewer-a/replacement-key';
const persisted = {
  id: 'recording', workspaceId: 'workspace', authorId: 'viewer-a', cohortId: 'space',
  status: 'failed', progress: 0, peaks: [],
  input: { uri: 'file:///recording.m4a', durationMs: 3000, bytes: 1000, mimeType: 'audio/mp4', cohortId: 'space' },
  uploadedKey: originalKey,
};
let qc: QueryClient;
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const note = (id: string) => ({
  id, workspace_id: 'workspace', cohort_id: 'space', conversation_id: null,
  author_id: 'viewer-a', url: 'https://signed.example/note', duration_ms: 3000,
  bytes: 1000, mime_type: 'audio/mp4' as const, has_waveform: false,
  created_at: '2026-11-05T00:00:00.000Z',
});

beforeEach(async () => {
  resetVoiceOutbox();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  await AsyncStorage.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store
    .set('supabase_token', 'header.eyJzdWIiOiJ2aWV3ZXItYSJ9.signature');
  await AsyncStorage.setItem(queueKey, JSON.stringify([persisted]));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  wire.create.mockReset();
  wire.issueUploadUrl.mockReset().mockResolvedValue({
    storage_key: replacementKey, upload_url: 'https://storage.example/new',
    expires_at: '2026-11-06T00:00:00.000Z', expires_in_seconds: 300, bucket: 'community-voice',
  });
  wire.uploadBytes.mockReset().mockResolvedValue(undefined);
  jest.spyOn(global, 'fetch').mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(1000) } as Response);
});
afterEach(() => { qc.clear(); jest.restoreAllMocks(); });

it('LS942 control: a lost answer retried while its upload key is valid returns the original note without reuploading', async () => {
  wire.create.mockResolvedValue(note('already-committed') as never);
  const hook = await renderHook(() => useSpaceVoiceOutbox('workspace', 'viewer-a', 'space'), { wrapper: Wrapper });
  await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
  await act(async () => { hook.result.current.retry('recording'); });
  await waitFor(() => expect(hook.result.current.rows).toHaveLength(0));
  expect(wire.create.mock.calls[0][1].storage_key).toBe(originalKey);
  expect(wire.issueUploadUrl).not.toHaveBeenCalled();
  await hook.unmount();
});

it('LS942 B1: a lost answer retried after the 24h10m key window never posts the same recording as a second note', async () => {
  // Model the backend's exact boundary order at 2adcfc33:
  // verifyPublishableVoiceKey(maxAgeMs = 24h10m) runs BEFORE its storage_key lookup.
  // The original request already committed; only its response was lost.
  const serverRows = [note('already-committed')];
  wire.create.mockImplementation(async (_workspace, body) => {
    if (body.storage_key === originalKey) throw new CommunityApiError('unknown', 400, 'expired key');
    const next = note('second-commit');
    serverRows.push(next);
    return next as never;
  });
  const hook = await renderHook(() => useSpaceVoiceOutbox('workspace', 'viewer-a', 'space'), { wrapper: Wrapper });
  await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
  await act(async () => { hook.result.current.retry('recording'); });
  await waitFor(() => expect(hook.result.current.rows[0]?.v.status).toBe('failed'));
  expect(wire.create.mock.calls[0][1].storage_key).toBe(originalKey);
  await act(async () => { hook.result.current.retry('recording'); });
  await waitFor(() => expect(hook.result.current.rows).toHaveLength(0));
  expect(serverRows).toHaveLength(1);
  await hook.unmount();
});
