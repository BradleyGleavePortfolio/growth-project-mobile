/**
 * BF-2 (LS-871X, VF-848B): every recording is tied to the account and the sign-in that made it, and it is
 * dropped at sign-out. A saved-queue read, a file move or a send that a sign-out overtakes is ignored, and
 * the recordings it held are deleted. A sign-in change of the same account (no sign-out) sends the note
 * again under the new sign-in, so nothing is lost. The publish itself is doubled here; the real API client
 * is run in useVoiceOutbox.transport.test.tsx.
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetVoiceOutbox, useVoiceOutbox } from '../useVoiceOutbox';
import { authEvents } from '../../utils/authEvents';
import { AccountChangedError, authEpoch } from '../../services/accountBinding';
import { CommunityApiError } from '../../api/apiCall';
import { HapticService } from '../../ui/haptics/haptics.service';
import type { VoiceRecordingResult } from '../voiceRecorderPort';

const mockPublish = jest.fn();
jest.mock('../useVoiceUpload', () => ({
  publishVoiceNote: (...a: unknown[]) => mockPublish(...a),
}));
const mockMove = jest.fn();
const mockDelete = jest.fn();
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
    delete = () => mockDelete(this.uri);
  }
  class Directory extends File {
    create = () => undefined;
  }
  return { File, Directory, Paths: { document: 'file:///docs' } };
});

const secure = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };
const net = NetInfo as unknown as { __reset: () => void };
const STORE = 'tgp.voiceOutbox.v1';
const A = 'u-a';
const B = 'u-b';
const REC: VoiceRecordingResult = {
  uri: 'file:///cache/r.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4', peaks: [0.2, 0.8],
};
const MOVED = 'file:///docs/voice-outbox/r.m4a';
const SAVED_A = [{
  id: 'local-a', authorId: A, workspaceId: 'ws-1', peaks: [0.3], status: 'waiting',
  input: { uri: 'file:///docs/voice-outbox/a.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4' },
}];
/** What the API client answers a request that a sign-in change stopped (see services/accountBinding.ts). */
const stopped = (sent: boolean) =>
  new CommunityApiError('unknown', -1, 'community voice request failed', new AccountChangedError(sent));

/** The phone holds this account's token and the app says it signed in. */
function signIn(token: string): void {
  secure.__store.set('supabase_token', token);
  authEvents.emit('login');
}
function signOut(): void {
  secure.__store.delete('supabase_token');
  authEvents.emit('logout');
}
/** The file is gone: deleted itself, or with the outbox folder it was in. */
const deleted = (uri: string) =>
  mockDelete.mock.calls.some(([p]: [string]) => uri === p || uri.startsWith(`${p}/`));
const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
});

async function mount(author: string) {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = await renderHook(() => useVoiceOutbox('ws-1', author), { wrapper });
  return { qc, ...hook };
}

/** Holds the next saved-queue read: it reads what is saved now and answers only when let go. */
function holdSavedRead(): { started: () => boolean; release: () => void } {
  const real = AsyncStorage.getItem;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((r) => {
    open = r;
  });
  let started = false;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
    if (key !== STORE || started) return real(key);
    started = true;
    const now = await real(key);
    await gate;
    return now;
  });
  return { started: () => started, release: () => open() };
}

beforeEach(async () => {
  net.__reset();
  resetVoiceOutbox();
  await AsyncStorage.clear();
  secure.__store.clear();
  mockPublish.mockReset().mockResolvedValue({ id: 'vn-1' });
  mockMove.mockReset();
  mockDelete.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('BF-2 — a saved-queue read that a sign-out overtakes (slow restore)', () => {
  it('never sends or shows the old account’s note for the next account', async () => {
    signIn('token-a');
    await AsyncStorage.setItem(STORE, JSON.stringify(SAVED_A));
    const held = holdSavedRead();
    const a = await mount(A);
    await waitFor(() => expect(held.started()).toBe(true));
    await act(async () => signOut());
    await a.unmount();
    await act(async () => signIn('token-b'));
    const b = await mount(B);
    await act(async () => held.release());
    await settle();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(b.result.current.items).toEqual([]);
    expect(JSON.parse((await AsyncStorage.getItem(STORE)) ?? '[]')).toEqual([]);
  });

  it('never sends the old note in a new sign-in of the same account', async () => {
    signIn('token-a');
    await AsyncStorage.setItem(STORE, JSON.stringify(SAVED_A));
    const held = holdSavedRead();
    const a = await mount(A);
    await waitFor(() => expect(held.started()).toBe(true));
    await act(async () => signOut());
    await a.unmount();
    await act(async () => signIn('token-a-again'));
    const again = await mount(A);
    await act(async () => held.release());
    await settle();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(again.result.current.items).toEqual([]);
  });

  it('deletes the saved recordings it had not read back yet, and sends none of them', async () => {
    mockPublish.mockImplementation(() => new Promise(() => undefined)); // a send would never finish
    signIn('token-a');
    await AsyncStorage.setItem(STORE, JSON.stringify(SAVED_A));
    const held = holdSavedRead();
    await mount(A);
    await waitFor(() => expect(held.started()).toBe(true));
    await act(async () => signOut());
    await act(async () => held.release());
    await settle();
    expect(deleted(SAVED_A[0].input.uri)).toBe(true);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('a sign-in change of the same account during the read still sends the note, once', async () => {
    signIn('token-a');
    await AsyncStorage.setItem(STORE, JSON.stringify(SAVED_A));
    const held = holdSavedRead();
    const a = await mount(A);
    await waitFor(() => expect(held.started()).toBe(true));
    await act(async () => authEvents.emit('login')); // e.g. a house join settles on Home: no sign-out
    await act(async () => held.release());
    await waitFor(() => expect(a.result.current.items).toEqual([]));
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });
});

describe('BF-2 — a recording still being moved when its account signs out (pending file move)', () => {
  it('is deleted once it lands and never sent, for the next account or a new sign-in of the same one', async () => {
    signIn('token-a');
    let landed: () => void = () => undefined;
    mockMove.mockImplementationOnce(() => new Promise<void>((r) => {
      landed = r;
    }));
    const a = await mount(A);
    await act(async () => a.result.current.send(REC));
    await act(async () => signOut());
    await a.unmount();
    await act(async () => signIn('token-a-again'));
    const again = await mount(A);
    await act(async () => landed());
    await settle();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(MOVED);
    expect(again.result.current.items).toEqual([]);
  });
});

describe('BF-2 — a send that a sign-out overtakes (upload in flight)', () => {
  it('goes out bound to the sign-in that sent it', async () => {
    signIn('token-a');
    const a = await mount(A);
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
    expect(mockPublish.mock.calls[0][2]).toMatchObject({
      binding: { subject: expect.stringMatching(/^tok:/), epoch: authEpoch() },
    });
  });

  it('leaves no Not sent row, no error buzz and no feed refresh', async () => {
    signIn('token-a');
    let fail: (e: unknown) => void = () => undefined;
    mockPublish.mockImplementationOnce(() => new Promise((_r, j) => {
      fail = j;
    }));
    const buzz = jest.spyOn(HapticService, 'error');
    const a = await mount(A);
    const refresh = jest.spyOn(a.qc, 'invalidateQueries');
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
    await act(async () => signOut());
    await act(async () => fail(stopped(true)));
    await settle();
    expect(a.result.current.items).toEqual([]);
    expect(buzz).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('that still lands after the sign-out refreshes nothing and gives no buzz', async () => {
    signIn('token-a');
    let land: () => void = () => undefined;
    mockPublish.mockImplementationOnce(() => new Promise((r) => {
      land = () => r({ id: 'vn-1' });
    }));
    const done = jest.spyOn(HapticService, 'success');
    const a = await mount(A);
    const refresh = jest.spyOn(a.qc, 'invalidateQueries');
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
    await act(async () => signOut());
    await act(async () => land());
    await settle();
    expect(refresh).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it('a sign-in change of the same account sends it again under the new sign-in, with no Not sent row', async () => {
    signIn('token-a');
    let fail: (e: unknown) => void = () => undefined;
    mockPublish.mockImplementationOnce(() => new Promise((_r, j) => {
      fail = j;
    }));
    const buzz = jest.spyOn(HapticService, 'error');
    const a = await mount(A);
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
    const first = mockPublish.mock.calls[0][2].binding as { epoch: number };
    await act(async () => authEvents.emit('login')); // no sign-out: the same account, a new sign-in epoch
    await act(async () => fail(stopped(false)));
    await waitFor(() => expect(a.result.current.items).toEqual([]));
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish.mock.calls[1][2].binding.epoch).toBe(first.epoch + 1);
    expect(buzz).not.toHaveBeenCalled();
  });

  it('with no sign-in token on the phone nothing goes out: the note waits, with no Not sent row', async () => {
    const a = await mount(A);
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(a.result.current.items[0]?.status).toBe('waiting'));
    await settle();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(a.result.current.items[0]?.status).toBe('waiting');
  });
});
