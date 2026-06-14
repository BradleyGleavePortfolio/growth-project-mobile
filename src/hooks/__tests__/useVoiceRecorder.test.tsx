/**
 * useVoiceRecorder — state-machine tests for the v3-3 recorder hook.
 *
 * A fake VoiceRecorderPort is injected so the lifecycle is deterministic and
 * never touches a native module. Covers:
 *   - unavailable build → status 'unavailable', start() is inert.
 *   - permission denial → 'denied' + canRetryPermission + mustOpenSettings
 *     (a REAL recovery state, not a silent no-op — audit req).
 *   - happy path: idle → recording (ticker advances) → stop → 'recorded'
 *     with the finished recording.
 *   - the elapsed timer auto-stops at the cap so a recording can never exceed
 *     the server max duration.
 *   - retryPermission flips to idle on grant.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useVoiceRecorder } from '../useVoiceRecorder';
import type {
  VoiceRecorderPort,
  VoiceRecordingResult,
  MicPermissionStatus,
} from '../voiceRecorderPort';

function makePort(
  overrides: Partial<VoiceRecorderPort> = {},
): VoiceRecorderPort & {
  _result: VoiceRecordingResult;
} {
  const result: VoiceRecordingResult = {
    uri: 'file:///tmp/rec.m4a',
    durationMs: 3000,
    bytes: 50_000,
    mimeType: 'audio/mp4',
    peaks: [0.1, 0.4, 0.9, 0.3],
  };
  return {
    _result: result,
    isAvailable: true,
    getPermissionStatus: jest
      .fn<Promise<MicPermissionStatus>, []>()
      .mockResolvedValue('granted'),
    requestPermission: jest
      .fn<Promise<MicPermissionStatus>, []>()
      .mockResolvedValue('granted'),
    start: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    stop: jest.fn<Promise<VoiceRecordingResult>, []>().mockResolvedValue(result),
    cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('useVoiceRecorder — availability', () => {
  it('reports unavailable and start() is inert when no recorder is bundled', async () => {
    const port = makePort({ isAvailable: false });
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: port }));
    expect(result.current.status).toBe('unavailable');
    expect(result.current.isAvailable).toBe(false);

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('unavailable');
    expect(port.start).not.toHaveBeenCalled();
  });
});

describe('useVoiceRecorder — permission denial recovery', () => {
  it('enters denied with a real recovery state when permission is refused', async () => {
    const port = makePort({
      getPermissionStatus: jest.fn().mockResolvedValue('undetermined'),
      requestPermission: jest.fn().mockResolvedValue('denied'),
    });
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: port }));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('denied');
    expect(result.current.canRetryPermission).toBe(true);
    expect(result.current.mustOpenSettings).toBe(true);
    expect(port.start).not.toHaveBeenCalled();
  });

  it('retryPermission returns to idle when the user later grants', async () => {
    const port = makePort({
      getPermissionStatus: jest.fn().mockResolvedValue('undetermined'),
      requestPermission: jest
        .fn()
        .mockResolvedValueOnce('denied')
        .mockResolvedValueOnce('granted'),
    });
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: port }));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('denied');

    await act(async () => {
      await result.current.retryPermission();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.mustOpenSettings).toBe(false);
  });
});

describe('useVoiceRecorder — capture lifecycle', () => {
  it('records then stops with the finished recording', async () => {
    const port = makePort();
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: port }));
    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('recording');
    expect(port.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe('recorded');
    expect(result.current.recording?.uri).toBe('file:///tmp/rec.m4a');
    expect(result.current.recording?.durationMs).toBe(3000);
  });

  it('clamps a finished recording duration to the cap', async () => {
    const port = makePort({
      stop: jest.fn().mockResolvedValue({
        uri: 'file:///tmp/long.m4a',
        durationMs: 999_999,
        bytes: 10,
        mimeType: 'audio/mp4',
        peaks: [],
      }),
    });
    const { result } = await renderHook(() =>
      useVoiceRecorder({ recorder: port, maxDurationMs: 300_000 }),
    );
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.recording?.durationMs).toBe(300_000);
  });

  it('auto-stops at the cap via the elapsed ticker', async () => {
    jest.useFakeTimers();
    try {
      const port = makePort();
      const { result } = await renderHook(() =>
        useVoiceRecorder({ recorder: port, maxDurationMs: 500 }),
      );
      await act(async () => {
        await result.current.start();
      });
      expect(result.current.status).toBe('recording');

      // Advance past the cap; the ticker should fire the auto-stop.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      await waitFor(() => expect(port.stop).toHaveBeenCalled());
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancel discards and returns to idle', async () => {
    const port = makePort();
    const { result } = await renderHook(() => useVoiceRecorder({ recorder: port }));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(port.cancel).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.recording).toBeNull();
  });
});
