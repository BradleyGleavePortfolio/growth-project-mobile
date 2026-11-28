/**
 * SC-M4 (agent 203), cases T2-T9: a photo from the photo library into a space chat (spaceChatPhotos, spaceChatPhotoApi).
 * The picker and the file system stand in as src/utils/log/__tests__/mealPhotoAttach.test.ts has them; the server's
 * answers are built from SC-BE3's CONTRACT 6370301575 (b#1139) and backend main 27be6474 (community-images.controller.ts,
 * community-messages.service.ts createImage :278-326 and replay :577-592, community-photo-check.ts :204, :219). Made-up
 * bytes, files and links only. The module's rows start and end empty in every test (a sign-out wipes them).
 */
import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockLibrary = jest.fn();
const mockCamera = jest.fn();
const mockLibraryPermission = jest.fn();
const mockCameraPermission = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockLibrary(...a),
  launchCameraAsync: (...a: unknown[]) => mockCamera(...a),
  requestMediaLibraryPermissionsAsync: (...a: unknown[]) => mockLibraryPermission(...a),
  requestCameraPermissionsAsync: (...a: unknown[]) => mockCameraPermission(...a),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
}));
const mockInfo = jest.fn();
const mockDelete = jest.fn();
const mockUpload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  getInfoAsync: (...a: unknown[]) => mockInfo(...a),
  deleteAsync: (...a: unknown[]) => mockDelete(...a),
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
}));
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), get: jest.fn(async () => ({ data: {} })), delete: jest.fn(async () => ({ data: {} })) },
}));
const mockDisk = new Map<string, string>();
// Every write to the phone's stores over a case, not only what is left at its end (T8: "never hold").
const mockWrites: unknown[] = [];
jest.mock('../../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockWrites.push([k, v]); mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
  prefsStorage: { getString: () => undefined, set: async () => undefined, delete: async () => undefined, getAllKeys: async () => [] },
}));
jest.mock('../../../../store/clientStore', () => ({ useClientStore: { getState: () => ({ selectedDate: '2026-11-27' }) } }));
const mockOwner = { id: 'me-1' as string | null };
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => (mockOwner.id ? { id: mockOwner.id } : null) }));
const mockCapture = jest.fn();
jest.mock('../../../../services/sentry', () => ({ captureError: (...a: unknown[]) => mockCapture(...a), captureErrorWithoutPii: (...a: unknown[]) => mockCapture(...a), setSentryUser: jest.fn() }));
const mockTrack = jest.fn();
jest.mock('../../../../lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));
const mockLog = jest.fn();
jest.mock('../../../../utils/logger', () => ({ logger: { info: (...a: unknown[]) => mockLog(...a), warn: (...a: unknown[]) => mockLog(...a), error: (...a: unknown[]) => mockLog(...a), debug: (...a: unknown[]) => mockLog(...a) } }));

import { authEvents } from '../../../../utils/authEvents';
import { CRISIS_LINE_911_988 } from '../../../../constants/crisisLines';
import { MEAL_PHOTO_OPTIONS } from '../../../../utils/log/mealPhoto';
import { spaceChatKey } from '../useSpaceChat';
import { setSpaceOutboxOnline, spaceOutbox, startSpaceOutbox } from '../spaceChatOutbox';
import { discardSpacePhoto, pickSpacePhoto, retrySpacePhoto, spacePhotoBusy, useSpacePhotos } from '../spaceChatPhotos';
import type { SpaceMessage } from '../spaceChatApi';

const FILE = 'file:///cache/ImagePicker/made-up-photo-1.jpg';
const FILE2 = 'file:///cache/ImagePicker/made-up-photo-2.jpg';
const SIZE = 2_000_000;
const T0 = Date.parse('2026-11-27T19:00:00.000Z');
const store = () => (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store;
const fail = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
const noAnswer = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const asset = (over: Record<string, unknown> = {}) => ({ uri: FILE, width: 1200.4, height: 899.6, mimeType: 'image/jpeg', ...over });
const picked = (over: Record<string, unknown> = {}) => ({ canceled: false, assets: [asset(over)] });
const serverRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: 'c-a', sender_user_id: 'me-1', body: null, kind: 'image', created_at: new Date(T0).toISOString(),
  image: { url: null, width: 1200, height: 900 }, sender: { id: 'me-1', name: 'Dana Reyes', avatar_url: null, is_coach: false }, ...extra,
});

type Answer = () => unknown;
let minted = 0;
let linkAnswers: Answer[] = [];
let sendAnswers: Answer[] = [];
const mint = () => {
  minted += 1;
  return { status: 201, data: { upload_url: `https://storage.example.test/upload/k${minted}.jpg?token=made-up`, key: `made-up-user/c-a-k${minted}.jpg`, expires_at: new Date(Date.now() + 600_000).toISOString() } };
};
const created = (id = 'srv-1', extra: Record<string, unknown> = {}) => () => ({ status: 201, data: { message: serverRow(id), ...extra } });
const reject = (err: unknown) => () => { throw err; };
const hold = () => {
  let release: (v: unknown) => void = () => undefined;
  const p = new Promise((res) => { release = res; });
  return { answer: () => p, release: (v: unknown) => release(v) };
};

const links = () => mockPost.mock.calls.filter(([u]) => String(u).endsWith('/images/upload-url'));
const photoSends = () => mockPost.mock.calls.filter(([u, b]) => String(u).endsWith('/messages') && (b as { kind?: string })?.kind === 'image');
const keyOf = (call: unknown[]) => ((call[2] as { headers: Record<string, string> }).headers)['Idempotency-Key'];
const settle = () => act(async () => { for (let i = 0; i < 15; i += 1) await new Promise((r) => setTimeout(r, 0)); });

let qc: QueryClient;
let invalidate: jest.SpyInstance;
type HookProps = { cohortId: string; userId: string | null; online: boolean; messages: SpaceMessage[]; closed: boolean };
let hook: Awaited<ReturnType<typeof renderHook<ReturnType<typeof useSpacePhotos>, HookProps>>>;
const mount = async (over: Partial<HookProps> = {}) => {
  qc = new QueryClient();
  invalidate = jest.spyOn(qc, 'invalidateQueries');
  const initialProps: HookProps = { cohortId: 'c-a', userId: 'me-1', online: true, messages: [], closed: false, ...over };
  hook = await renderHook((p: HookProps) => useSpacePhotos(p.cohortId, p.userId, p.online, p.messages, p.closed), {
    initialProps,
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
};
const rows = () => hook.result.current.rows;
const props = (over: Partial<HookProps> = {}): HookProps => ({ cohortId: 'c-a', userId: 'me-1', online: true, messages: [], closed: false, ...over });
const reread = () => invalidate.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(spaceChatKey('me-1', 'c-a'))).length;

/** One library pick of a made-up JPEG of `size` bytes, as `who` would make it (online unless said). */
async function pick(over: Record<string, unknown> = {}, size = SIZE, online = true) {
  mockLibrary.mockResolvedValueOnce(picked(over));
  mockInfo.mockResolvedValueOnce({ exists: true, size, uri: String(over.uri ?? FILE), isDirectory: false, modificationTime: 1 });
  await act(async () => { await pickSpacePhoto('c-a', 'me-1', online); });
  await settle();
}

let alert: jest.SpyInstance;
let now: jest.SpyInstance;
beforeEach(async () => {
  authEvents.emit('logout');
  jest.clearAllMocks();
  [mockLibrary, mockInfo, mockUpload, mockDelete, mockPost].forEach((m) => m.mockReset());
  mockDisk.clear();
  mockOwner.id = 'me-1';
  store().set('supabase_token', 'tok-me-1');
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  now = jest.spyOn(Date, 'now').mockReturnValue(T0);
  minted = 0;
  linkAnswers = [];
  sendAnswers = [];
  mockPost.mockImplementation(async (url: string, body: { kind?: string }) => {
    if (url.endsWith('/images/upload-url')) return (linkAnswers.shift() ?? mint)();
    if (url.endsWith('/messages') && body?.kind === 'image') return (sendAnswers.shift() ?? created())();
    if (url.endsWith('/messages')) return { status: 201, data: { message: { ...serverRow('txt-1'), kind: 'text', body: 'Morning all', image: undefined } } };
    throw fail(500);
  });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockDelete.mockResolvedValue(undefined);
  await mount();
});
afterEach(async () => {
  await act(async () => { authEvents.emit('logout'); });
  // The rows end empty: read by a fresh hook (the test's own may already be unmounted by the library's cleanup).
  const after = await renderHook(() => useSpacePhotos('c-a', 'me-1', true, [], false), {
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>,
  });
  expect(after.result.current.rows).toEqual([]);
  expect(spacePhotoBusy()).toBe(false);
  await after.unmount();
  alert.mockRestore();
  now.mockRestore();
});

describe('SCM4 T2: the pick', () => {
  it('SCM4 T2: the picker gets MEAL_PHOTO_OPTIONS itself (one object, never a copy), one photo, and no permission is asked', async () => {
    await pick();
    expect(mockLibrary).toHaveBeenCalledTimes(1);
    expect(mockLibrary.mock.calls[0]).toHaveLength(1);
    expect(mockLibrary.mock.calls[0][0]).toBe(MEAL_PHOTO_OPTIONS);
    expect(MEAL_PHOTO_OPTIONS).toEqual({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8, exif: false, preferredAssetRepresentationMode: 'compatible' });
    expect(mockLibraryPermission).not.toHaveBeenCalled();
    expect(mockCameraPermission).not.toHaveBeenCalled();
    expect(mockCamera).not.toHaveBeenCalled();
  });

  it('SCM4 T2: cancelled: nothing happens (no row, no alert, nothing sent)', async () => {
    mockLibrary.mockResolvedValueOnce({ canceled: true, assets: null });
    await act(async () => { await pickSpacePhoto('c-a', 'me-1', true); });
    await settle();
    expect(rows()).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('SCM4 T2: the picker throws: "Photo not sent" with the app\'s fallback line, no row', async () => {
    mockLibrary.mockRejectedValueOnce(new Error('made-up picker failure'));
    await act(async () => { await pickSpacePhoto('c-a', 'me-1', true); });
    await settle();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Photo not sent', 'The request could not be completed. Try again in a moment.');
    expect(rows()).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([
    ['a PNG', { mimeType: 'image/png' }, SIZE],
    ['a HEIC the picker passed through', { mimeType: 'image/heic' }, SIZE],
    ['a GIF', { mimeType: 'image/gif' }, SIZE],
    ['a WEBP', { mimeType: 'image/webp' }, SIZE],
    ['no type', { mimeType: undefined }, SIZE],
    ['0 bytes on disk', {}, 0],
    ['one byte over 10,485,760', {}, 10_485_761],
    ['a side of 0', { width: 0.3 }, SIZE],
    ['a side of 10,001', { height: 10_001 }, SIZE],
  ])('SCM4 T2: %s: deleted, one alert "This photo can\'t be used. Choose another one.", no row, nothing sent', async (_n, over, size) => {
    await pick(over, size);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Photo not sent', "This photo can't be used. Choose another one.");
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    expect(rows()).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('SCM4 T2: at the limits (10,485,760 bytes, a side of 10,000) the photo goes', async () => {
    await pick({ width: 10_000, height: 10_000 }, 10_485_760);
    expect(alert).not.toHaveBeenCalled();
    expect(links()[0][1]).toEqual({ mime: 'image/jpeg', size_bytes: 10_485_760 });
    expect(photoSends()[0][1]).toEqual({ kind: 'image', image_key: 'made-up-user/c-a-k1.jpg', width: 10_000, height: 10_000 });
  });

  it('SCM4 T2: offline at the tap: told with the describer\'s offline line; the picker never opens, no row', async () => {
    await act(async () => { await pickSpacePhoto('c-a', 'me-1', false); });
    expect(alert).toHaveBeenCalledWith('Photo not sent', 'You appear to be offline. Check your connection, then try again.');
    expect(mockLibrary).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  it('SCM4 T2: a second tap while the picker is up starts nothing', async () => {
    const grid = hold();
    mockLibrary.mockImplementationOnce(grid.answer);
    let first: Promise<void> = Promise.resolve();
    await act(async () => { first = pickSpacePhoto('c-a', 'me-1', true); });
    expect(spacePhotoBusy()).toBe(true);
    await act(async () => { await pickSpacePhoto('c-a', 'me-1', true); });
    expect(mockLibrary).toHaveBeenCalledTimes(1);
    mockInfo.mockResolvedValueOnce({ exists: true, size: SIZE, uri: FILE, isDirectory: false, modificationTime: 1 });
    await act(async () => { grid.release(picked()); await first; });
    await settle();
    expect(spacePhotoBusy()).toBe(false);
    expect(rows()).toHaveLength(1);
  });
});

describe('SCM4 T3: the three calls of a good send, to the byte', () => {
  it('SCM4 T3: call 1, the PUT and call 3, bound to the sign-in that picked the photo', async () => {
    await pick();
    expect(mockPost).toHaveBeenCalledTimes(2);
    const [path1, body1, cfg1] = mockPost.mock.calls[0];
    expect(path1).toBe('/community/cohorts/c-a/images/upload-url');
    expect(body1).toEqual({ mime: 'image/jpeg', size_bytes: SIZE });
    expect(cfg1.accountBinding).toEqual({ subject: expect.any(String), epoch: expect.any(Number) });
    expect(typeof cfg1._sessionGeneration).toBe('number');
    expect(cfg1.signal).toBeInstanceOf(AbortSignal);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith('https://storage.example.test/upload/k1.jpg?token=made-up', FILE, {
      httpMethod: 'PUT', uploadType: 0, headers: { 'Content-Type': 'image/jpeg' },
    });
    const [path3, body3, cfg3] = mockPost.mock.calls[1];
    expect(path3).toBe('/community/cohorts/c-a/messages');
    expect(body3).toEqual({ kind: 'image', image_key: 'made-up-user/c-a-k1.jpg', width: 1200, height: 900 });
    expect(Object.keys(body3).sort()).toEqual(['height', 'image_key', 'kind', 'width']);
    expect(cfg3.headers).toEqual({ 'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(cfg3.accountBinding).toEqual(cfg1.accountBinding);
    expect(cfg3._sessionGeneration).toBe(cfg1._sessionGeneration);
    expect(cfg3.signal).toBeInstanceOf(AbortSignal);
    expect(rows()).toEqual([expect.objectContaining({ state: 'sent', serverId: 'srv-1', uri: FILE, width: 1200, height: 900, cohortId: 'c-a', userId: 'me-1' })]);
    expect(reread()).toBe(1);
  });
});

type Row17 = {
  name: string; at: 'link' | 'upload' | 'send'; answer: () => void;
  sees: 'gone' | 'not sent' | 'sent'; alert: string | null; links: number; uploads: number; sends: number; deleted: boolean; reread: boolean;
};
const W5 = "This photo can't be posted. It didn't pass the automatic check.";
const W6 = "This photo can't be used. Choose another one.";
const ROWS17: Row17[] = [
  { name: 'call 1: 404 community.cohort.not_found (not let in)', at: 'link', answer: () => { linkAnswers.push(reject(fail(404, { error: 'not_found', code: 'community.cohort.not_found' }))); }, sees: 'gone', alert: null, links: 1, uploads: 0, sends: 0, deleted: true, reread: true },
  { name: 'call 3: 403 (not let in)', at: 'send', answer: () => { sendAnswers.push(reject(fail(403, { code: 'community.cohort.no_access' }))); }, sees: 'gone', alert: null, links: 1, uploads: 1, sends: 1, deleted: true, reread: true },
  { name: 'call 3: 404 community.message.not_found (not let in)', at: 'send', answer: () => { sendAnswers.push(reject(fail(404, { error: 'not_found', code: 'community.message.not_found' }))); }, sees: 'gone', alert: null, links: 1, uploads: 1, sends: 1, deleted: true, reread: true },
  { name: 'call 1: a plain 404 with no code (photos off on the server)', at: 'link', answer: () => { linkAnswers.push(reject(fail(404, { message: 'Not Found', statusCode: 404 }))); }, sees: 'not sent', alert: null, links: 1, uploads: 0, sends: 0, deleted: false, reread: false },
  { name: 'call 3: 422 community.image.disabled (photos off)', at: 'send', answer: () => { sendAnswers.push(reject(fail(422, { error: 'invalid_image', code: 'community.image.disabled' }))); }, sees: 'not sent', alert: null, links: 1, uploads: 1, sends: 1, deleted: false, reread: false },
  { name: 'call 3: 422 PHOTO_NOT_ALLOWED (the automatic check)', at: 'send', answer: () => { sendAnswers.push(reject(fail(422, { error: 'invalid_image', code: 'PHOTO_NOT_ALLOWED' }))); }, sees: 'gone', alert: W5, links: 1, uploads: 1, sends: 1, deleted: true, reread: false },
  ...(['has_location', 'not_jpeg', 'too_large'] as const).map((c): Row17 => ({ name: `call 3: 422 community.image.${c}`, at: 'send', answer: () => { sendAnswers.push(reject(fail(422, { error: 'invalid_image', code: `community.image.${c}` }))); }, sees: 'gone', alert: W6, links: 1, uploads: 1, sends: 1, deleted: true, reread: false })),
  ...(['key_invalid', 'missing'] as const).map((c): Row17 => ({ name: `call 3: 422 community.image.${c}, then 201 (one new link and upload, no word)`, at: 'send', answer: () => { sendAnswers.push(reject(fail(422, { error: 'invalid_image', code: `community.image.${c}` }))); }, sees: 'sent', alert: null, links: 2, uploads: 2, sends: 2, deleted: false, reread: true })),
  { name: 'call 3: 422 community.image.key_invalid twice: Not sent', at: 'send', answer: () => { sendAnswers.push(reject(fail(422, { code: 'community.image.key_invalid' })), reject(fail(422, { code: 'community.image.key_invalid' }))); }, sees: 'not sent', alert: null, links: 2, uploads: 2, sends: 2, deleted: false, reread: false },
  { name: 'call 3: 422 community.image.key_invalid, then .key_used: Not sent', at: 'send', answer: () => { sendAnswers.push(reject(fail(422, { code: 'community.image.key_invalid' })), reject(fail(422, { code: 'community.image.key_used' }))); }, sees: 'not sent', alert: null, links: 2, uploads: 2, sends: 2, deleted: false, reread: false },
  { name: 'call 3: 422 community.image.key_used: Not sent', at: 'send', answer: () => { sendAnswers.push(reject(fail(422, { code: 'community.image.key_used' }))); }, sees: 'not sent', alert: null, links: 1, uploads: 1, sends: 1, deleted: false, reread: false },
  { name: 'call 1: no answer', at: 'link', answer: () => { linkAnswers.push(reject(noAnswer())); }, sees: 'not sent', alert: null, links: 1, uploads: 0, sends: 0, deleted: false, reread: false },
  { name: 'call 2: the upload not 2xx', at: 'upload', answer: () => { mockUpload.mockResolvedValueOnce({ status: 403, headers: {}, body: '' }); }, sees: 'not sent', alert: null, links: 1, uploads: 1, sends: 0, deleted: false, reread: false },
  { name: 'call 2: the upload never answers', at: 'upload', answer: () => { mockUpload.mockRejectedValueOnce(new Error('made-up transfer failure')); }, sees: 'not sent', alert: null, links: 1, uploads: 1, sends: 0, deleted: false, reread: false },
  { name: 'call 3: no answer', at: 'send', answer: () => { sendAnswers.push(reject(noAnswer())); }, sees: 'not sent', alert: null, links: 1, uploads: 1, sends: 1, deleted: false, reread: false },
  ...([
    ['429', 429, { code: 'throttled' }], ['500', 500, {}], ['503 community.image.storage_unavailable', 503, { code: 'community.image.storage_unavailable' }],
    ['503 PHOTO_CHECK_UNAVAILABLE', 503, { code: 'PHOTO_CHECK_UNAVAILABLE' }], ['401', 401, {}], ['409 idempotency_key_reused (a code not named)', 409, { code: 'idempotency_key_reused' }],
  ] as const).map(([n, status, data]): Row17 => ({ name: `call 3: ${n}`, at: 'send', answer: () => { sendAnswers.push(reject(fail(status, { ...data }))); }, sees: 'not sent', alert: null, links: 1, uploads: 1, sends: 1, deleted: false, reread: false })),
  { name: 'call 1: 503 (try later)', at: 'link', answer: () => { linkAnswers.push(reject(fail(503, { code: 'community.image.storage_unavailable' }))); }, sees: 'not sent', alert: null, links: 1, uploads: 0, sends: 0, deleted: false, reread: false },
];

describe('SCM4 T4: every answer of line 17', () => {
  it.each(ROWS17.map((r) => [r.name, r] as const))('SCM4 T4: %s', async (_n, r) => {
    r.answer();
    await pick();
    const state = rows()[0]?.state;
    expect(r.sees === 'gone' ? rows() : state).toEqual(r.sees === 'gone' ? [] : r.sees === 'not sent' ? 'failed' : 'sent');
    if (r.alert) {
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert).toHaveBeenCalledWith('Photo not sent', r.alert);
    } else {
      expect(alert).not.toHaveBeenCalled();
    }
    expect(links()).toHaveLength(r.links);
    expect(mockUpload).toHaveBeenCalledTimes(r.uploads);
    expect(photoSends()).toHaveLength(r.sends);
    if (r.sends > 1) expect(new Set(photoSends().map(keyOf)).size).toBe(1);
    expect(mockDelete.mock.calls.some(([u]) => u === FILE)).toBe(r.deleted);
    expect(reread() > 0).toBe(r.reread);
  });

  it('SCM4 T4: the plain 404 never reads as a closed space, and the space\'s own 404 never reads Not sent', async () => {
    linkAnswers.push(reject(fail(404, {})));
    await pick();
    expect(rows()).toEqual([expect.objectContaining({ state: 'failed' })]);
    expect(reread()).toBe(0);
    await act(async () => { discardSpacePhoto(rows()[0].id); });
    linkAnswers.push(reject(fail(404, { code: 'community.cohort.not_found' })));
    await pick();
    expect(rows()).toEqual([]);
    expect(reread()).toBe(1);
  });
});

describe('SCM4 T5: Try again', () => {
  it('SCM4 T5: a live link with a finished upload goes straight to call 3, with the same Idempotency-Key', async () => {
    sendAnswers.push(reject(fail(500)));
    await pick();
    expect(rows()[0].state).toBe('failed');
    await act(async () => { retrySpacePhoto(rows()[0].id); });
    await settle();
    expect(links()).toHaveLength(1);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(photoSends()).toHaveLength(2);
    expect(keyOf(photoSends()[1])).toBe(keyOf(photoSends()[0]));
    expect(photoSends()[1][1]).toEqual(photoSends()[0][1]);
    expect(rows()[0].state).toBe('sent');
  });

  it('SCM4 T5: an unfinished upload starts at call 1 (a new link, a new upload), with the same Idempotency-Key', async () => {
    mockUpload.mockResolvedValueOnce({ status: 500, headers: {}, body: '' });
    await pick();
    expect(rows()[0].state).toBe('failed');
    await act(async () => { retrySpacePhoto(rows()[0].id); });
    await settle();
    expect(links()).toHaveLength(2);
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(photoSends()).toHaveLength(1);
    expect(photoSends()[0][1]).toEqual(expect.objectContaining({ image_key: 'made-up-user/c-a-k2.jpg' }));
    expect(rows()[0].state).toBe('sent');
  });

  it('SCM4 T5: a link past its time whose photo message went out: that key once more; the server says key_invalid, so a new link, a new upload and the same Idempotency-Key', async () => {
    sendAnswers.push(reject(fail(503, { code: 'community.image.storage_unavailable' })));
    await pick();
    now.mockReturnValue(T0 + 601_000);
    sendAnswers.push(reject(fail(422, { code: 'community.image.key_invalid' })));
    await act(async () => { retrySpacePhoto(rows()[0].id); });
    await settle();
    expect(photoSends().map(([, b]) => (b as { image_key: string }).image_key)).toEqual(['made-up-user/c-a-k1.jpg', 'made-up-user/c-a-k1.jpg', 'made-up-user/c-a-k2.jpg']);
    expect(new Set(photoSends().map(keyOf)).size).toBe(1);
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(rows()[0].state).toBe('sent');
  });

  it('SCM4 T5: after a lost 201 the same key answers with the first message: one row, and it leaves when the list carries it', async () => {
    sendAnswers.push(reject(noAnswer()));
    await pick();
    now.mockReturnValue(T0 + 900_000);
    sendAnswers.push(created('srv-1'));
    await act(async () => { retrySpacePhoto(rows()[0].id); });
    await settle();
    expect(photoSends()).toHaveLength(2);
    expect(photoSends()[1][1]).toEqual(photoSends()[0][1]);
    expect(keyOf(photoSends()[1])).toBe(keyOf(photoSends()[0]));
    expect(links()).toHaveLength(1);
    expect(rows()).toEqual([expect.objectContaining({ state: 'sent', serverId: 'srv-1' })]);
    await hook.rerender(props({ cohortId: 'c-a', userId: 'me-1', online: true, messages: [serverRow('srv-1') as SpaceMessage], closed: false }));
    await settle();
    expect(rows()).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  });

  it('SCM4 T5: two photos never share an Idempotency-Key', async () => {
    await pick();
    await pick({ uri: FILE2 });
    expect(photoSends()).toHaveLength(2);
    expect(keyOf(photoSends()[0])).not.toBe(keyOf(photoSends()[1]));
  });

  it('SCM4 T5: Delete drops a Not sent row and deletes its file; a row on its way or sent has none', async () => {
    const send = hold();
    sendAnswers.push(send.answer);
    await pick();
    const id = rows()[0].id;
    await act(async () => { discardSpacePhoto(id); });
    expect(rows()).toHaveLength(1);
    await act(async () => { send.release({ status: 201, data: { message: serverRow('srv-1') } }); });
    await settle();
    await act(async () => { discardSpacePhoto(id); });
    expect(rows()).toEqual([expect.objectContaining({ state: 'sent' })]);
    await act(async () => { authEvents.emit('logout'); });
    sendAnswers.push(reject(fail(500)));
    await pick({ uri: FILE2 });
    await act(async () => { discardSpacePhoto(rows()[0].id); });
    expect(rows()).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(FILE2, { idempotent: true });
  });
});

describe('SCM4 T6: order', () => {
  it('SCM4 T6: two photos go one at a time, oldest first; a text typed meanwhile is not held up', async () => {
    const first = hold();
    sendAnswers.push(first.answer);
    await pick();
    now.mockReturnValue(T0 + 1000);
    await pick({ uri: FILE2 });
    expect(links()).toHaveLength(1);
    expect(rows().map((r) => r.state)).toEqual(['sending', 'sending']);
    startSpaceOutbox('me-1');
    setSpaceOutboxOnline(true);
    await act(async () => { spaceOutbox.add('c-a', 'Morning all'); });
    await settle();
    expect(mockPost.mock.calls.some(([u, b]) => String(u).endsWith('/messages') && (b as { body?: string }).body === 'Morning all')).toBe(true);
    expect(links()).toHaveLength(1);
    await act(async () => { first.release({ status: 201, data: { message: serverRow('srv-1') } }); });
    await settle();
    expect(links()).toHaveLength(2);
    expect(mockUpload.mock.calls.map(([, uri]) => uri)).toEqual([FILE, FILE2]);
    expect(rows().map((r) => r.state)).toEqual(['sent', 'sent']);
    setSpaceOutboxOnline(false);
  });

  it('SCM4 T6: the connection drops: the photo on its way fails by its own error, the one behind it reads Not sent too; no row waits', async () => {
    const first = hold();
    sendAnswers.push(first.answer);
    await pick();
    await pick({ uri: FILE2 });
    await hook.rerender(props({ cohortId: 'c-a', userId: 'me-1', online: false, messages: [], closed: false }));
    await act(async () => { first.release(Promise.reject(noAnswer())); });
    await settle();
    expect(rows().map((r) => r.state)).toEqual(['failed', 'failed']);
    expect(links()).toHaveLength(1);
  });
});

describe('SCM4 T7: the account fence', () => {
  it('SCM4 T7: a sign-out during the pick\'s checks: no row, the file deleted, nothing sent', async () => {
    const info = hold();
    mockLibrary.mockResolvedValueOnce(picked());
    mockInfo.mockImplementationOnce(info.answer);
    let p: Promise<void> = Promise.resolve();
    await act(async () => { p = pickSpacePhoto('c-a', 'me-1', true); });
    await act(async () => { authEvents.emit('logout'); });
    await act(async () => { info.release({ exists: true, size: SIZE, uri: FILE, isDirectory: false, modificationTime: 1 }); await p; });
    await settle();
    expect(rows()).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each(['call 1', 'the upload', 'call 3'] as const)('SCM4 T7: a sign-out while %s is on its way sends nothing more, wipes the rows, deletes the file and cancels the bound call', async (at) => {
    const h = hold();
    if (at === 'call 1') linkAnswers.push(h.answer);
    else if (at === 'the upload') mockUpload.mockImplementationOnce(h.answer);
    else sendAnswers.push(h.answer);
    await pick();
    const before = mockPost.mock.calls.length;
    const signal = (mockPost.mock.calls[before - 1][2] as { signal: AbortSignal }).signal;
    await act(async () => { authEvents.emit('logout'); });
    expect(rows()).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    if (at !== 'the upload') expect(signal.aborted).toBe(true);
    await act(async () => { h.release(at === 'the upload' ? { status: 200, headers: {}, body: '' } : at === 'call 1' ? mint() : { status: 201, data: { message: serverRow('srv-1') } }); });
    await settle();
    expect(mockPost.mock.calls.length).toBe(before);
    expect(mockUpload).toHaveBeenCalledTimes(at === 'call 1' ? 0 : 1);
    expect(rows()).toEqual([]);
    expect(reread()).toBe(0);
  });

  it('SCM4 T7: another account signed in on this phone never sends the first one\'s photo', async () => {
    sendAnswers.push(reject(fail(500)));
    await pick();
    const sent = mockPost.mock.calls.length;
    store().set('supabase_token', 'tok-someone-else-2');
    await act(async () => { authEvents.emit('login'); });
    await act(async () => { retrySpacePhoto(rows()[0].id); });
    await settle();
    expect(mockPost.mock.calls.length).toBe(sent);
    expect(rows()[0].state).toBe('failed');
  });

  it('SCM4 T7: a \'login\' of the same account keeps the rows, and Try again goes out under its new sign-in', async () => {
    sendAnswers.push(reject(fail(500)));
    await pick();
    const first = (photoSends()[0][2] as { accountBinding: { subject: string; epoch: number } }).accountBinding;
    await act(async () => { authEvents.emit('login'); });
    expect(rows()).toEqual([expect.objectContaining({ state: 'failed' })]);
    await act(async () => { retrySpacePhoto(rows()[0].id); });
    await settle();
    const second = (photoSends()[1][2] as { accountBinding: { subject: string; epoch: number } }).accountBinding;
    expect(second.subject).toBe(first.subject);
    expect(second.epoch).toBeGreaterThan(first.epoch);
    expect(rows()[0].state).toBe('sent');
  });

  it('SCM4 T7: nobody signed in at the pick: no row, the file deleted, nothing sent', async () => {
    store().delete('supabase_token');
    await pick();
    expect(rows()).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('SCM4 T8: nothing saved', () => {
  it('SCM4 T8: over a whole send, a failure and a sign-out, no store, cache, log, report or event holds the file, the link or the key', async () => {
    mockWrites.length = 0;
    const asyncWrites = [
      jest.spyOn(AsyncStorage, 'setItem'), jest.spyOn(AsyncStorage, 'mergeItem'),
      jest.spyOn(AsyncStorage, 'multiSet'), jest.spyOn(AsyncStorage, 'multiMerge'),
    ];
    const cached: unknown[] = [];
    const unwatch = qc.getQueryCache().subscribe((e) => { cached.push([e.query.queryKey, e.query.state.data]); });
    startSpaceOutbox('me-1');
    await pick();
    sendAnswers.push(reject(fail(500)), reject(fail(422, { code: 'PHOTO_NOT_ALLOWED' })));
    await pick({ uri: FILE2 });
    await act(async () => { retrySpacePhoto(rows()[1].id); });
    await settle();
    await act(async () => { qc.setQueryData(spaceChatKey('me-1', 'c-a'), { pages: [{ messages: [serverRow('srv-1')], next_before: null }], pageParams: [null] }); });
    await act(async () => { authEvents.emit('logout'); });
    await settle();
    const secrets = [FILE, FILE2, 'storage.example.test', 'made-up-user/', ...photoSends().map(keyOf)];
    const asyncKeys = await AsyncStorage.getAllKeys();
    const kept = [
      JSON.stringify([...mockDisk.entries()]),
      JSON.stringify(await Promise.all(asyncKeys.map(async (k) => [k, await AsyncStorage.getItem(k)]))),
      JSON.stringify(qc.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data])),
      JSON.stringify(qc.getMutationCache().getAll().map((m) => m.state)),
      JSON.stringify([mockCapture.mock.calls, mockTrack.mock.calls, mockLog.mock.calls]),
      JSON.stringify([mockWrites, asyncWrites.map((w) => w.mock.calls), cached]),
    ].join('\n');
    unwatch();
    asyncWrites.forEach((w) => w.mockRestore());
    for (const s of secrets) expect(kept).not.toContain(s);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('SCM4 T9: the crisis reader', () => {
  it('SCM4 T9: a 201 carrying the mark shows the approved line once, to the account that sent it', async () => {
    sendAnswers.push(created('srv-1', { crisis_flag: true }));
    await pick();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('', CRISIS_LINE_911_988);
  });

  it('SCM4 T9: the account changed before the answer: no line', async () => {
    const send = hold();
    sendAnswers.push(send.answer);
    await pick();
    mockOwner.id = 'someone-else';
    await act(async () => { send.release({ status: 201, data: { message: serverRow('srv-1'), crisis_flag: true } }); });
    await settle();
    expect(alert).not.toHaveBeenCalled();
  });

  it('SCM4 T9: a 422 with the mark leads its alert with the line; no mark, no line', async () => {
    sendAnswers.push(reject(fail(422, { code: 'PHOTO_NOT_ALLOWED', crisis_flag: true })));
    await pick();
    expect(alert).toHaveBeenCalledWith('Photo not sent', `${CRISIS_LINE_911_988}\n\n${W5}`);
    alert.mockClear();
    sendAnswers.push(reject(fail(422, { code: 'PHOTO_NOT_ALLOWED' })));
    await pick({ uri: FILE2 });
    expect(alert).toHaveBeenCalledWith('Photo not sent', W5);
    expect(JSON.stringify(alert.mock.calls)).not.toContain(CRISIS_LINE_911_988);
  });
});

describe('SCM4 T10 (module part): the rows are per space and per person; a closed space keeps none that is not on its way', () => {
  it('SCM4 T10: another space and another person see none of them', async () => {
    sendAnswers.push(reject(fail(500)));
    await pick();
    expect(rows()).toHaveLength(1);
    await hook.rerender(props({ cohortId: 'c-b', userId: 'me-1', online: true, messages: [], closed: false }));
    expect(rows()).toEqual([]);
    await hook.rerender(props({ cohortId: 'c-a', userId: 'u-2', online: true, messages: [], closed: false }));
    expect(rows()).toEqual([]);
    await hook.rerender(props({ cohortId: 'c-a', userId: 'me-1', online: true, messages: [], closed: false }));
    expect(rows()).toHaveLength(1);
    await hook.rerender(props({ cohortId: 'c-a', userId: 'me-1', online: true, messages: [], closed: true }));
    await settle();
    expect(rows()).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  });

  it('SCM4 T10: a send keeps going when the page is left; its answer settles the row and reads the list again', async () => {
    const send = hold();
    sendAnswers.push(send.answer);
    await pick();
    await hook.unmount();
    await act(async () => { send.release({ status: 201, data: { message: serverRow('srv-1') } }); });
    await settle();
    expect(reread()).toBe(1);
    await mount();
    expect(rows()).toEqual([expect.objectContaining({ state: 'sent', serverId: 'srv-1' })]);
  });
});
