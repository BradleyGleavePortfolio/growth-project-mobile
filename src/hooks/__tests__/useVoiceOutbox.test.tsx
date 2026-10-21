/**
 * useVoiceOutbox — the Style B outbox: Send closes the sheet and the note
 * waits here until the server has it (sending → gone, failed → retry,
 * offline → waiting → sends on reconnect). Peaks go only to a Studio server.
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { resetVoiceOutbox, useVoiceOutbox } from '../useVoiceOutbox';
import { authEvents } from '../../utils/authEvents';
import type { VoiceRecordingResult } from '../voiceRecorderPort';

const mockPublish = jest.fn();
jest.mock('../useVoiceUpload', () => ({
  publishVoiceNote: (...a: unknown[]) => mockPublish(...a),
}));
const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };

const REC: VoiceRecordingResult = { uri: 'file:///r.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4', peaks: [0.2, 0.8] };

function setup(author = 'u-me') {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useVoiceOutbox('ws-1', author), { wrapper });
}

beforeEach(() => {
  net.__reset();
  resetVoiceOutbox();
  mockPublish.mockReset().mockResolvedValue({ id: 'vn-1' });
});

describe('useVoiceOutbox', () => {
  it('sends at once and drops the row when the server has the note', async () => {
    const { result } = await setup();
    await act(async () => result.current.send(REC, { sendPeaks: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(mockPublish).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ uri: REC.uri, waveformPeaks: REC.peaks }),
      expect.anything(),
    );
  });

  it('a failed send online is Not sent, keeps the recording, and Try again sends it', async () => {
    mockPublish.mockRejectedValueOnce(new Error('500'));
    const { result } = await setup();
    await act(async () => result.current.send(REC, { sendPeaks: false }));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    expect(result.current.items[0].input.uri).toBe(REC.uri);
    // Old servers reject unknown create keys: no peaks unless the server takes them.
    expect(result.current.items[0].input).not.toHaveProperty('waveformPeaks');
    await act(async () => result.current.retry(result.current.items[0].id));
    await waitFor(() => expect(result.current.items).toHaveLength(0));
  });

  it('offline the note waits, then sends when the signal is back', async () => {
    net.__setState({ isConnected: false });
    const { result } = await setup();
    await waitFor(() => expect(result.current.online).toBe(false));
    await act(async () => result.current.send(REC, { sendPeaks: false }));
    expect(result.current.items[0].status).toBe('waiting');
    expect(mockPublish).not.toHaveBeenCalled();
    await act(async () => net.__setState({ isConnected: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it('shows only the signed-in author’s notes and empties on sign-out', async () => {
    net.__setState({ isConnected: false });
    const mine = await setup('u-me');
    await waitFor(() => expect(mine.result.current.online).toBe(false));
    await act(async () => mine.result.current.send(REC, { sendPeaks: false }));
    const other = await setup('u-other');
    expect(other.result.current.items).toHaveLength(0);
    expect(mine.result.current.items).toHaveLength(1);
    await act(async () => authEvents.emit('logout'));
    expect(mine.result.current.items).toHaveLength(0);
  });
});
