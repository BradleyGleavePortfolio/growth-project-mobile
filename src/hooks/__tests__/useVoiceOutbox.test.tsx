/** useVoiceOutbox — the Style B outbox: Send closes the sheet and the note waits here until the server has it
 *  (sending → gone, failed → retry, offline → waiting → sends on reconnect, from any screen and after a restart). */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetVoiceOutbox, useVoiceOutbox } from '../useVoiceOutbox';
import { authEvents } from '../../utils/authEvents';
import { CommunityApiError } from '../../api/apiCall';
import type { VoiceRecordingResult } from '../voiceRecorderPort';

const mockPublish = jest.fn();
jest.mock('../useVoiceUpload', () => ({
  publishVoiceNote: (...a: unknown[]) => mockPublish(...a),
}));
const mockMove = jest.fn();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...p: (string | { uri: string })[]) {
      this.uri = p.map((x) => (typeof x === 'string' ? x : x.uri)).join('/');
    }
    get name() {
      return this.uri.split('/').pop();
    }
    exists = true;
    move = (d: File) => mockMove(this.uri, d.uri);
    delete = () => undefined;
  }
  class Directory extends File {
    create = () => undefined;
  }
  return { File, Directory, Paths: { document: 'file:///docs' } };
});
const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };
// The signed-in author's token on the phone: a queued note goes out only under it (BF-2).
const secure = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };

const REC: VoiceRecordingResult = { uri: 'file:///r.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4', peaks: [0.2, 0.8] };

function setup(author = 'u-me') {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useVoiceOutbox('ws-1', author), { wrapper });
}

beforeEach(async () => {
  net.__reset();
  resetVoiceOutbox();
  await AsyncStorage.clear();
  secure.__store.set('supabase_token', 'token-me');
  mockPublish.mockReset().mockResolvedValue({ id: 'vn-1' });
});

describe('useVoiceOutbox', () => {
  it('sends at once and drops the row when the server has the note', async () => {
    const { result } = await setup();
    await act(async () => result.current.send(REC));
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(mockPublish).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ uri: 'file:///docs/voice-outbox/r.m4a', waveformPeaks: REC.peaks }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(mockMove).toHaveBeenCalledWith(REC.uri, 'file:///docs/voice-outbox/r.m4a');
  });

  it('a failed send online is Not sent, keeps the recording, and Try again sends it', async () => {
    mockPublish.mockRejectedValueOnce(new Error('500'));
    const { result } = await setup();
    await act(async () => result.current.send(REC));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    expect(result.current.items[0].input.uri).toBe('file:///docs/voice-outbox/r.m4a');
    await act(async () => result.current.retry(result.current.items[0].id));
    await waitFor(() => expect(result.current.items).toHaveLength(0));
  });

  it('offline the note waits, then sends when the signal is back', async () => {
    net.__setState({ isConnected: false });
    const { result } = await setup();
    await waitFor(() => expect(result.current.online).toBe(false));
    await act(async () => result.current.send(REC));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('waiting'));
    expect(mockPublish).not.toHaveBeenCalled();
    await act(async () => net.__setState({ isConnected: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it('a waiting note still sends when the signal is back after its screen has closed (B2)', async () => {
    net.__setState({ isConnected: false });
    const { result, unmount } = await setup();
    await waitFor(() => expect(result.current.online).toBe(false));
    await act(async () => result.current.send(REC));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('waiting'));
    await unmount();
    await act(async () => net.__setState({ isConnected: true }));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
  });

  it('shows only the signed-in author’s notes and empties on sign-out', async () => {
    net.__setState({ isConnected: false });
    const mine = await setup('u-me');
    await waitFor(() => expect(mine.result.current.online).toBe(false));
    await act(async () => mine.result.current.send(REC));
    await waitFor(() => expect(mine.result.current.items).toHaveLength(1));
    const other = await setup('u-other');
    expect(other.result.current.items).toHaveLength(0);
    expect(mine.result.current.items).toHaveLength(1);
    await act(async () => authEvents.emit('logout'));
    expect(mine.result.current.items).toHaveLength(0);
  });

  it('a waiting note survives a restart and sends when the signal is back', async () => {
    net.__setState({ isConnected: false });
    const before = await setup();
    await waitFor(() => expect(before.result.current.online).toBe(false));
    await act(async () => before.result.current.send(REC));
    await waitFor(() => expect(before.result.current.items[0]?.status).toBe('waiting'));
    await before.unmount();
    // A cold start: the memory is gone, only what the phone saved is left.
    resetVoiceOutbox(true);
    await act(async () => net.__setState({ isConnected: true }));
    const after = await setup();
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
    expect(mockPublish).toHaveBeenCalledWith('ws-1', expect.objectContaining({ uri: 'file:///docs/voice-outbox/r.m4a' }),
      expect.objectContaining({ onProgress: expect.any(Function) }));
    await waitFor(() => expect(after.result.current.items).toHaveLength(0));
    await after.unmount();
  });
});

describe('useVoiceOutbox — upload progress (GOAL 03)', () => {
  it('the sending row carries the upload share, and it is not written to the phone', async () => {
    let report: (f: number) => void = () => undefined;
    let finish: () => void = () => undefined;
    mockPublish.mockImplementationOnce((_ws: string, _in: unknown, o: { onProgress: (f: number) => void }) => {
      report = o.onProgress;
      return new Promise((r) => { finish = () => r({ id: 'vn-1' }); });
    });
    const { result } = await setup();
    await act(async () => result.current.send(REC));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('sending'));
    await act(async () => report(0.64));
    expect(result.current.items[0]?.progress).toBeCloseTo(0.64);
    const saved = JSON.parse((await AsyncStorage.getItem('tgp.voiceOutbox.v1')) ?? '[]');
    expect(saved[0]?.progress ?? 0).toBe(0);
    await act(async () => finish());
    await waitFor(() => expect(result.current.items).toHaveLength(0));
  });
});

// C-4 (LO-VUX m#848): the bytes are up and the reply to the post is lost (a timeout). Try again posts the
// same key, which the server answers with the note it already made, so the community never gets two
// notes; the key is kept on the phone through a restart. A key the server turns down (400: too old, the
// bytes gone) is dropped, so the next try uploads again.
describe('useVoiceOutbox — a lost reply never posts twice (C-4)', () => {
  const KEY = 'u-me/k-1.m4a';
  const lostReply = (_ws: string, _in: unknown, o: { onUploaded: (k: string) => void }) => {
    o.onUploaded(KEY);
    return Promise.reject(new CommunityApiError('network', 0, 'voice note: timed out'));
  };

  it('Try again, after a restart too, posts the same key and uploads nothing', async () => {
    mockPublish.mockImplementationOnce(lostReply);
    const before = await setup();
    await act(async () => before.result.current.send(REC));
    await waitFor(() => expect(before.result.current.items[0]?.status).toBe('failed'));
    await before.unmount();
    resetVoiceOutbox(true); // a cold start: only what the phone saved is left
    const after = await setup();
    await waitFor(() => expect(after.result.current.items[0]?.uploadedKey).toBe(KEY));
    await act(async () => after.result.current.retry(after.result.current.items[0].id));
    await waitFor(() => expect(after.result.current.items).toHaveLength(0));
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenLastCalledWith('ws-1', expect.anything(), expect.objectContaining({ uploadedKey: KEY }));
    await after.unmount();
  });

  it('a key the server turns down is dropped, so the next try uploads again', async () => {
    mockPublish
      .mockImplementationOnce(lostReply)
      .mockRejectedValueOnce(new CommunityApiError('unknown', 400, 'voice note: storage key rejected'));
    const { result } = await setup();
    await act(async () => result.current.send(REC));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    await act(async () => result.current.retry(result.current.items[0].id));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    expect(result.current.items[0].uploadedKey).toBeUndefined();
    await act(async () => result.current.retry(result.current.items[0].id));
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(mockPublish.mock.calls[1][2]).toMatchObject({ uploadedKey: KEY });
    expect(mockPublish.mock.calls[2][2].uploadedKey).toBeUndefined();
  });
});
