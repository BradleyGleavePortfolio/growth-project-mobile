/**
 * useVoiceOutbox — the Style B outbox: Send closes the sheet and the note
 * waits here until the server has it (sending → gone, failed → retry,
 * offline → waiting → sends on reconnect, from any screen and after a restart).
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetVoiceOutbox, useVoiceOutbox } from '../useVoiceOutbox';
import { authEvents } from '../../utils/authEvents';
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
    expect(mockPublish).toHaveBeenCalledWith('ws-1', expect.objectContaining({ uri: 'file:///docs/voice-outbox/r.m4a' }));
    await waitFor(() => expect(after.result.current.items).toHaveLength(0));
    await after.unmount();
  });
});
