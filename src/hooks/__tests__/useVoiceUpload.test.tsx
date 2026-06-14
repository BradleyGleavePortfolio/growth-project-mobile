/**
 * useVoiceUpload — pipeline tests for the v3-3 publish mutation.
 *
 * The API client is mocked so the three hops are observable without a network,
 * and an injectable byte reader keeps the filesystem out of the test. Covers:
 *   - the ordered three-hop flow (issueUploadUrl → uploadBytes → create) with
 *     the storage_key threaded from hop 1 into hop 3,
 *   - pre-flight validation rejecting an over-cap duration BEFORE any hop,
 *   - a hop-2 failure surfacing as an error while preserving the input (the
 *     composer can retry without re-recording),
 *   - feed invalidation on success.
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../api/communityVoiceApi');
  return {
    ...actual,
    communityVoiceApi: {
      issueUploadUrl: jest.fn(),
      uploadBytes: jest.fn(),
      create: jest.fn(),
    },
  };
});

import { communityVoiceApi } from '../../api/communityVoiceApi';
import { useVoiceUpload } from '../useVoiceUpload';
import { voiceKeys } from '../voiceQueryKeys';

const api = jest.mocked(communityVoiceApi);
const WS = '11111111-1111-4111-8111-111111111111';

const target = {
  upload_url: 'https://storage.example/put/abc',
  storage_key: 'user-1/1700-note.m4a',
  expires_at: '2026-06-10T00:05:00.000Z',
  expires_in_seconds: 300,
  bucket: 'community-voice',
};

const createdNote = {
  id: 'note-1',
  workspace_id: WS,
  cohort_id: null,
  conversation_id: null,
  author_id: 'user-1',
  url: 'https://signed.example/audio.m4a',
  duration_ms: 3000,
  bytes: 50_000,
  mime_type: 'audio/mp4',
  has_waveform: false,
  created_at: '2026-06-10T00:00:00.000Z',
};

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

const goodInput = {
  uri: 'file:///tmp/rec.m4a',
  durationMs: 3000,
  bytes: 50_000,
  mimeType: 'audio/mp4' as const,
};

beforeEach(() => {
  api.issueUploadUrl.mockReset().mockResolvedValue(target);
  api.uploadBytes.mockReset().mockResolvedValue(undefined);
  api.create.mockReset().mockResolvedValue(createdNote);
});

describe('useVoiceUpload — three-hop publish', () => {
  it('runs issueUploadUrl → uploadBytes → create, threading the storage key', async () => {
    const readBytes = jest.fn().mockResolvedValue(new ArrayBuffer(8));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useVoiceUpload(WS, { readBytes }), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(goodInput);
    });

    expect(api.issueUploadUrl).toHaveBeenCalledWith(WS, {
      duration_ms: 3000,
      bytes: 50_000,
      mime_type: 'audio/mp4',
    });
    expect(readBytes).toHaveBeenCalledWith('file:///tmp/rec.m4a');
    expect(api.uploadBytes).toHaveBeenCalledWith(
      target.upload_url,
      expect.any(ArrayBuffer),
      'audio/mp4',
    );
    expect(api.create).toHaveBeenCalledWith(WS, {
      storage_key: target.storage_key,
      duration_ms: 3000,
      bytes: 50_000,
      mime_type: 'audio/mp4',
    });
    // RNTL v14 + TanStack Query v5: post-mutation state lands on the next
    // microtask flush; wait for it so the assertion is not racing the
    // mutation's internal setState.
    await waitFor(() => {
      expect(result.current.data?.id).toBe('note-1');
    });
  });

  it('threads an optional cohort target into create', async () => {
    const readBytes = jest.fn().mockResolvedValue(new ArrayBuffer(8));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useVoiceUpload(WS, { readBytes }), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ ...goodInput, cohortId: 'co-9' });
    });
    expect(api.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ cohortId: 'co-9' }),
    );
  });
});

describe('useVoiceUpload — validation + failure', () => {
  it('rejects an over-cap duration before any hop', async () => {
    const readBytes = jest.fn();
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useVoiceUpload(WS, { readBytes }), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...goodInput, durationMs: 999_999 }),
      ).rejects.toBeInstanceOf(RangeError);
    });
    expect(api.issueUploadUrl).not.toHaveBeenCalled();
    expect(readBytes).not.toHaveBeenCalled();
  });

  it('surfaces a hop-2 upload failure as an error and never creates', async () => {
    api.uploadBytes.mockRejectedValueOnce(new Error('network'));
    const readBytes = jest.fn().mockResolvedValue(new ArrayBuffer(8));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useVoiceUpload(WS, { readBytes }), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(result.current.mutateAsync(goodInput)).rejects.toThrow(
        'network',
      );
    });
    expect(api.create).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useVoiceUpload — cache invalidation', () => {
  it('invalidates the workspace voice feed on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    const readBytes = jest.fn().mockResolvedValue(new ArrayBuffer(8));
    const { result } = await renderHook(() => useVoiceUpload(WS, { readBytes }), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(goodInput);
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: voiceKeys.feedRoot(WS) });
  });
});
