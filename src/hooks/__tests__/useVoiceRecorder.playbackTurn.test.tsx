/**
 * OB1 (m#896 AUDIT 6482721065, VF-848C): a take holds the voice playback turn. A note that is playing when
 * a take begins is paused (its place kept) before the microphone starts, so it never plays into the take.
 * Every recorder entry (the Hall record sheet, the composer screen, Re-record) goes through start().
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useVoiceRecorder } from '../useVoiceRecorder';
import type { MicPermissionStatus, VoiceRecorderPort, VoiceRecordingResult } from '../voiceRecorderPort';
import {
  endVoicePlaybackTurn,
  hasVoicePlaybackTurn,
  takeVoicePlaybackTurn,
  type VoicePlaybackTurn,
} from '../../components/community/voicePlaybackPort';

const log: string[] = [];
const RESULT: VoiceRecordingResult = {
  uri: 'file:///tmp/rec.m4a',
  durationMs: 3000,
  bytes: 50_000,
  mimeType: 'audio/mp4',
  peaks: [0.1, 0.4],
};
const port = (perm: MicPermissionStatus = 'granted'): VoiceRecorderPort => ({
  isAvailable: true,
  getPermissionStatus: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue(perm),
  requestPermission: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue(perm),
  start: jest.fn(async () => void log.push('take starts')),
  stop: jest.fn(async () => {
    log.push('take stops');
    return RESULT;
  }),
  cancel: jest.fn(async () => void log.push('take cancelled')),
});
const playingNote = (): VoicePlaybackTurn => ({ stop: jest.fn(async () => void log.push('note pauses')) });

let note: VoicePlaybackTurn;
beforeEach(() => {
  log.length = 0;
  note = playingNote();
  void takeVoicePlaybackTurn(note);
});
afterEach(() => endVoicePlaybackTurn(note));

it('start pauses the playing note before the microphone starts', async () => {
  const { result } = await renderHook(() => useVoiceRecorder({ recorder: port() }));
  await act(async () => {
    await result.current.start();
  });
  expect(log).toEqual(['note pauses', 'take starts']);
  expect(hasVoicePlaybackTurn(note)).toBe(false);
  expect(result.current.status).toBe('recording');
});

it('a refused microphone leaves the note playing (no take begins)', async () => {
  const { result } = await renderHook(() => useVoiceRecorder({ recorder: port('denied') }));
  await act(async () => {
    await result.current.start();
  });
  expect(log).toEqual([]);
  expect(hasVoicePlaybackTurn(note)).toBe(true);
  expect(result.current.status).toBe('denied');
});

it('Re-record pauses a note that started during review before the next take', async () => {
  const { result } = await renderHook(() => useVoiceRecorder({ recorder: port() }));
  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    await result.current.stop();
  });
  const listenBack = playingNote();
  void takeVoicePlaybackTurn(listenBack);
  log.length = 0;
  await act(async () => {
    result.current.reset();
    await result.current.start();
  });
  expect(log).toEqual(['note pauses', 'take starts']);
  endVoicePlaybackTurn(listenBack);
});

it('closing while the note is still pausing never starts the microphone', async () => {
  let release: () => void = () => undefined;
  const slow: VoicePlaybackTurn = {
    stop: jest.fn(() => new Promise<void>((r) => { release = () => { log.push('note pauses'); r(); }; })),
  };
  void takeVoicePlaybackTurn(slow);
  const rec = port();
  const { result, unmount } = await renderHook(() => useVoiceRecorder({ recorder: rec }));
  let pending: Promise<void> = Promise.resolve();
  await act(async () => {
    pending = result.current.start();
  });
  await waitFor(() => expect(slow.stop).toHaveBeenCalled());
  await unmount();
  await act(async () => {
    release();
    await pending;
  });
  expect(rec.start).not.toHaveBeenCalled();
  expect(log).not.toContain('take starts');
  endVoicePlaybackTurn(slow);
});
