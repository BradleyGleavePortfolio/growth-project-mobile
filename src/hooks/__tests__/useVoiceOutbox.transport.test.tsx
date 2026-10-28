/**
 * BF-2 (LS-871X, VF-848B): a queued voice note goes out only under the account and the sign-in that sent
 * it, and a sign-out stops it. This runs the REAL outbox, publishVoiceNote, communityVoiceApi,
 * accountBinding and the REAL axios instance from services/api.ts (its request and response
 * interceptors). Only SecureStore, the file system and the transport are doubled: the adapter records
 * what would have been sent and never touches the network. Tokens are synthetic unsigned JWTs.
 */
import React from 'react';
import axios, {
  CanceledError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../services/secureStorage', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    secureStorage: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
    },
  };
});
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
    move = async () => undefined;
    delete = () => undefined;
  }
  class Directory extends File {
    create = () => undefined;
  }
  return { File, Directory, Paths: { document: 'file:///docs' } };
});

import api, { __resetRefreshStateForTests, __setSignOutForTests } from '../../services/api';
import { resetVoiceOutbox, useVoiceOutbox } from '../useVoiceOutbox';
import { authEvents } from '../../utils/authEvents';
import { HapticService } from '../../ui/haptics/haptics.service';
import type { VoiceRecordingResult } from '../voiceRecorderPort';

const secure = jest.requireMock('../../services/secureStorage') as { __store: Map<string, string> };

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
/** A synthetic, unsigned JWT for `sub` (never a real credential). */
function jwt(sub: string, n = 0): string {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ sub, n }))}.sig`;
}
const TOKEN_A = jwt('user-a');
const TOKEN_A_AGAIN = jwt('user-a', 1);
const TOKEN_B = jwt('user-b');

const REC: VoiceRecordingResult = {
  uri: 'file:///cache/r.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4', peaks: [0.2, 0.8],
};
const TARGET = {
  upload_url: 'https://storage.example.test/put/k-1',
  storage_key: 'user-a/k-1.m4a',
  expires_at: '2026-10-28T10:10:00.000Z',
  expires_in_seconds: 600,
  bucket: 'community-voice',
};
const NOTE = {
  id: 'vn-1', workspace_id: 'ws-1', cohort_id: null, conversation_id: null, author_id: 'u-a', url: null,
  duration_ms: 3000, bytes: 10, mime_type: 'audio/mp4', has_waveform: true, created_at: '2026-10-28T10:00:00.000Z',
};

type Hop = 'upload-url' | 'put' | 'create';
interface Sent {
  hop: Hop;
  authorization: string | undefined;
  signal: AbortSignal | undefined;
}
let sent: Sent[];
let held: Set<Hop>;
let answers: Partial<Record<Hop, () => void>>;

const hopOf = (config: InternalAxiosRequestConfig): Hop =>
  config.method === 'put' ? 'put' : (config.url ?? '').endsWith('/upload-url') ? 'upload-url' : 'create';

/** Records each request; a held hop answers only when told, and fails as a real transport does when aborted. */
const adapter: AxiosAdapter = (config) => {
  const hop = hopOf(config);
  const signal = config.signal as AbortSignal | undefined;
  sent.push({ hop, authorization: config.headers?.Authorization as string | undefined, signal });
  const data = hop === 'upload-url' ? TARGET : hop === 'create' ? { voice_note: NOTE } : '';
  const reply = (): AxiosResponse => ({ data, status: 200, statusText: '', headers: {}, config });
  if (!held.has(hop)) return Promise.resolve(reply());
  held.delete(hop);
  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new CanceledError(undefined, config)));
    answers[hop] = () => resolve(reply());
  });
};

function signIn(token: string): void {
  secure.__store.set('supabase_token', token);
  authEvents.emit('login');
}
function signOut(): void {
  secure.__store.clear();
  authEvents.emit('logout');
}
const hops = () => sent.map((s) => s.hop);
const settle = () => act(async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
});

async function mount(author: string) {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useVoiceOutbox('ws-1', author), { wrapper });
}

const realFetch = global.fetch;
const realAxiosAdapter = axios.defaults.adapter;
beforeEach(async () => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  api.defaults.adapter = adapter;
  axios.defaults.adapter = adapter; // the signed PUT is a bare axios call
  global.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(10) })) as unknown as typeof fetch;
  sent = [];
  held = new Set();
  answers = {};
  secure.__store.clear();
  resetVoiceOutbox();
  await AsyncStorage.clear();
});
afterEach(() => {
  global.fetch = realFetch;
  axios.defaults.adapter = realAxiosAdapter;
  jest.restoreAllMocks();
});

describe('BF-2 — a voice note goes out only under the sign-in that sent it', () => {
  it('positive control: all three hops go out, the API ones with the sender’s own credential', async () => {
    signIn(TOKEN_A);
    const a = await mount('u-a');
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(a.result.current.items).toEqual([]));
    expect(hops()).toEqual(['upload-url', 'put', 'create']);
    expect(sent[0].authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(sent[1].authorization).toBeUndefined(); // the signed PUT carries no app credential
    expect(sent[2].authorization).toBe(`Bearer ${TOKEN_A}`);
  });

  it('A signs out and B signs in while the upload target is minted: nothing more goes out, nothing as B', async () => {
    signIn(TOKEN_A);
    held.add('upload-url');
    const a = await mount('u-a');
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(hops()).toEqual(['upload-url']));
    await act(async () => signOut());
    await a.unmount();
    await act(async () => signIn(TOKEN_B));
    const b = await mount('u-b');
    await act(async () => answers['upload-url']?.());
    await settle();
    expect(hops()).toEqual(['upload-url']);
    expect(sent.some((s) => s.authorization === `Bearer ${TOKEN_B}`)).toBe(false);
    expect(b.result.current.items).toEqual([]);
  });

  it('A signs out and signs in again while the upload target is minted: the old note never goes out', async () => {
    signIn(TOKEN_A);
    held.add('upload-url');
    const a = await mount('u-a');
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(hops()).toEqual(['upload-url']));
    await act(async () => signOut());
    await a.unmount();
    await act(async () => signIn(TOKEN_A_AGAIN));
    const again = await mount('u-a');
    await act(async () => answers['upload-url']?.());
    await settle();
    expect(hops()).toEqual(['upload-url']);
    expect(again.result.current.items).toEqual([]);
  });

  it('a sign-out during the upload aborts the PUT; the note is never posted and no Not sent buzz', async () => {
    signIn(TOKEN_A);
    held.add('put');
    const buzz = jest.spyOn(HapticService, 'error');
    const a = await mount('u-a');
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(hops()).toEqual(['upload-url', 'put']));
    const put = sent[1];
    expect(put.signal?.aborted).toBe(false);
    await act(async () => signOut());
    expect(put.signal?.aborted).toBe(true);
    await settle();
    expect(hops()).toEqual(['upload-url', 'put']);
    expect(a.result.current.items).toEqual([]);
    expect(buzz).not.toHaveBeenCalled();
  });

  it('a sign-in change of the same account mid-upload sends the note again under the new sign-in, once', async () => {
    signIn(TOKEN_A);
    held.add('put');
    const buzz = jest.spyOn(HapticService, 'error');
    const a = await mount('u-a');
    await act(async () => a.result.current.send(REC));
    await waitFor(() => expect(hops()).toEqual(['upload-url', 'put']));
    await act(async () => authEvents.emit('login')); // no sign-out, e.g. a house join settles on Home
    await waitFor(() => expect(a.result.current.items).toEqual([]));
    expect(hops()).toEqual(['upload-url', 'put', 'upload-url', 'put', 'create']);
    expect(sent.filter((s) => s.hop !== 'put').every((s) => s.authorization === `Bearer ${TOKEN_A}`)).toBe(true);
    expect(buzz).not.toHaveBeenCalled();
  });
});
