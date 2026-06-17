/**
 * useCoachExerciseLibrary — tests for the custom-move authoring pipeline.
 *
 * The API client is mocked so the three media hops are observable without a
 * network, and an injectable byte reader keeps the filesystem out of the test.
 * Covers:
 *   - the ordered three-hop media flow (issueMediaUploadUrl → uploadBytes →
 *     create) with the storage_key threaded from hop 1 into hop 3,
 *   - the media-less path skipping BOTH upload hops and posting media_kind
 *     'none' directly,
 *   - pre-flight validation rejecting an empty name BEFORE any hop,
 *   - library invalidation on success.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/coachExerciseApi', () => {
  const actual = jest.requireActual('../../api/coachExerciseApi');
  return {
    ...actual,
    coachExerciseApi: {
      issueMediaUploadUrl: jest.fn(),
      uploadBytes: jest.fn(),
      create: jest.fn(),
      list: jest.fn(),
    },
  };
});

import { coachExerciseApi } from '../../api/coachExerciseApi';
import type { CustomExerciseMime } from '../../api/coachExerciseApi';
import {
  useAuthorExercise,
  assertAuthorable,
  coachExerciseKeys,
  type AuthorExerciseInput,
} from '../useCoachExerciseLibrary';

const api = jest.mocked(coachExerciseApi);

const target = {
  upload_url: 'https://storage.example/put/abc',
  storage_key: 'coach-1/1700-move.mp4',
  expires_at: '2026-06-17T00:05:00.000Z',
  expires_in_seconds: 300,
  bucket: 'coach-exercise',
};

const createdMove = {
  id: 'move-1',
  coach_id: 'coach-1',
  name: 'Standing forward fold',
  instructions: 'Hinge at the hips and let the spine lengthen.',
  media_kind: 'video' as const,
  media_url: 'https://signed.example/move.mp4',
  media_mime: 'video/mp4',
  created_at: '2026-06-17T00:00:00.000Z',
  archived_at: null,
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

beforeEach(() => {
  api.issueMediaUploadUrl.mockReset().mockResolvedValue(target);
  api.uploadBytes.mockReset().mockResolvedValue(undefined);
  api.create.mockReset().mockResolvedValue(createdMove);
  api.list.mockReset();
});

describe('useAuthorExercise — three-hop media publish', () => {
  it('runs issueMediaUploadUrl → uploadBytes → create, threading the storage key', async () => {
    const readBytes = jest.fn().mockResolvedValue(new ArrayBuffer(8));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useAuthorExercise({ readBytes }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        name: '  Standing forward fold  ',
        instructions: '  Hinge at the hips.  ',
        mediaKind: 'video',
        media: { uri: 'file:///tmp/move.mp4', bytes: 200_000, mimeType: 'video/mp4' },
      });
    });

    expect(api.issueMediaUploadUrl).toHaveBeenCalledWith({
      bytes: 200_000,
      mime_type: 'video/mp4',
    });
    expect(readBytes).toHaveBeenCalledWith('file:///tmp/move.mp4');
    expect(api.uploadBytes).toHaveBeenCalledWith(
      target.upload_url,
      expect.any(ArrayBuffer),
      'video/mp4',
    );
    // Hop 3 receives the threaded storage_key + trimmed text.
    expect(api.create).toHaveBeenCalledWith({
      name: 'Standing forward fold',
      instructions: 'Hinge at the hips.',
      media_kind: 'video',
      storage_key: target.storage_key,
      media_mime: 'video/mp4',
    });
  });

  it('skips both upload hops for a media-less move', async () => {
    const readBytes = jest.fn();
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useAuthorExercise({ readBytes }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Box breathing',
        instructions: 'Inhale four, hold four, exhale four.',
        mediaKind: 'none',
      });
    });

    expect(api.issueMediaUploadUrl).not.toHaveBeenCalled();
    expect(api.uploadBytes).not.toHaveBeenCalled();
    expect(readBytes).not.toHaveBeenCalled();
    expect(api.create).toHaveBeenCalledWith({
      name: 'Box breathing',
      instructions: 'Inhale four, hold four, exhale four.',
      media_kind: 'none',
    });
  });

  it('invalidates the library query on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    const { result } = await renderHook(
      () => useAuthorExercise({ readBytes: () => Promise.resolve(new ArrayBuffer(8)) }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Box breathing',
        instructions: '',
        mediaKind: 'none',
      });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: coachExerciseKeys.list() });
  });
});

describe('assertAuthorable — pre-flight validation', () => {
  it('rejects an empty name before any hop', () => {
    expect(() =>
      assertAuthorable({ name: '   ', instructions: '', mediaKind: 'none' }),
    ).toThrow(RangeError);
  });

  it('rejects a media kind with no media payload', () => {
    expect(() =>
      assertAuthorable({ name: 'X', instructions: '', mediaKind: 'image' }),
    ).toThrow(RangeError);
  });

  it('rejects a disallowed media mime', () => {
    const input: AuthorExerciseInput = {
      name: 'X',
      instructions: '',
      mediaKind: 'image',
      media: {
        uri: 'file:///x.gif',
        bytes: 10,
        // a gif is not in the allowlist — @ts-expect-error is the sanctioned
        // escape to feed a runtime-invalid mime into the validator under test.
        // @ts-expect-error intentional out-of-allowlist mime for this assertion
        mimeType: 'image/gif' satisfies CustomExerciseMime,
      },
    };
    expect(() => assertAuthorable(input)).toThrow(RangeError);
  });

  it('accepts a valid media-less move', () => {
    expect(() =>
      assertAuthorable({ name: 'Box breathing', instructions: 'calm', mediaKind: 'none' }),
    ).not.toThrow();
  });
});
