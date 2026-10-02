/**
 * B-314-7 (#314 fix round 5): recorder start ownership and failure recovery.
 * Each case failed on 4192ba9d:
 *  - a start still waiting on the microphone when the composer unmounts must
 *    be retired: the capture it began is cancelled, no ticker survives;
 *  - a second tap while a start is in flight never begins a second capture;
 *  - a rejected permission read / start / stop ends in a coded `error` state
 *    with a reported reference (it used to escape `void rec.start()` and
 *    leave the member on an idle button with no message).
 */
import { act, renderHook } from '@testing-library/react-native';

const mockCapture = jest.fn();
jest.mock('../../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCapture(...a),
}));

import { useVoiceRecorder } from '../useVoiceRecorder';
import type {
  MicPermissionStatus,
  VoiceRecorderPort,
  VoiceRecordingResult,
} from '../voiceRecorderPort';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const RESULT: VoiceRecordingResult = {
  uri: 'file:///tmp/rec.m4a',
  durationMs: 3000,
  bytes: 50_000,
  mimeType: 'audio/mp4',
  peaks: [0.2],
};

function port(over: Partial<VoiceRecorderPort> = {}): jest.Mocked<VoiceRecorderPort> {
  return {
    isAvailable: true,
    getPermissionStatus: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue('granted'),
    requestPermission: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue('granted'),
    start: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    stop: jest.fn<Promise<VoiceRecordingResult>, []>().mockResolvedValue(RESULT),
    cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    ...over,
  } as jest.Mocked<VoiceRecorderPort>;
}

beforeEach(() => {
  mockCapture.mockReset();
});

describe('B-314-7: a start in flight is owned and fenced', () => {
  it('unmount while the microphone is starting cancels the late capture and leaves no ticker', async () => {
    const held = deferred<void>();
    const p = port({ start: jest.fn(() => held.promise) });
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const { result, unmount } = await renderHook(() => useVoiceRecorder({ recorder: p }));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.start();
    });
    expect(p.start).toHaveBeenCalledTimes(1);
    const intervalsBefore = setIntervalSpy.mock.calls.length;
    unmount();
    await act(async () => {
      held.resolve();
      await pending;
    });
    expect(p.cancel).toHaveBeenCalled();
    expect(setIntervalSpy.mock.calls.length).toBe(intervalsBefore);
    setIntervalSpy.mockRestore();
  });

  it('unmount while the permission read is pending never starts the microphone', async () => {
    const held = deferred<MicPermissionStatus>();
    const p = port({ getPermissionStatus: jest.fn(() => held.promise) });
    const { result, unmount } = await renderHook(() => useVoiceRecorder({ recorder: p }));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.start();
    });
    unmount();
    await act(async () => {
      held.resolve('granted');
      await pending;
    });
    expect(p.start).not.toHaveBeenCalled();
  });

  it('a second tap while a start is in flight never begins a second capture', async () => {
    const held = deferred<void>();
    const p = port({ start: jest.fn(() => held.promise) });
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: p }));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.start();
      second = result.current.start();
    });
    await act(async () => {
      held.resolve();
      await Promise.all([first, second]);
    });
    expect(p.start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('recording');
    await act(async () => {
      await result.current.start();
    });
    expect(p.start).toHaveBeenCalledTimes(1);
  });
});

describe('B-314-7: failures end in a coded error with a reported reference', () => {
  it('a rejected permission read is caught: error permission_check + reference + Sentry', async () => {
    const p = port({ getPermissionStatus: jest.fn().mockRejectedValue(new Error('perm read failed')) });
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: p }));
    await act(async () => {
      await expect(result.current.start()).resolves.toBeUndefined();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.kind).toBe('permission_check');
    expect(result.current.error?.reference).toMatch(/^[A-Za-z0-9-]{8}$/);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: 'community.voice', reason: 'recorder_permission_check' }),
    );
    expect(p.start).not.toHaveBeenCalled();
  });

  it('a rejected permission request on retry is caught too', async () => {
    const p = port({
      getPermissionStatus: jest.fn().mockResolvedValue('denied'),
      requestPermission: jest.fn().mockRejectedValue(new Error('prompt failed')),
    });
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: p }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('denied');
    await act(async () => {
      await expect(result.current.retryPermission()).resolves.toBeUndefined();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.kind).toBe('permission_check');
  });

  it('a rejected start is error start; reset returns to idle and clears the error', async () => {
    const p = port({ start: jest.fn().mockRejectedValue(new Error('session busy')) });
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: p }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.kind).toBe('start');
    await act(async () => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('a rejected stop is error stop with a reference', async () => {
    const p = port({ stop: jest.fn().mockRejectedValue(new Error('write failed')) });
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: p }));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.kind).toBe('stop');
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ reason: 'recorder_stop' }),
    );
  });
});
