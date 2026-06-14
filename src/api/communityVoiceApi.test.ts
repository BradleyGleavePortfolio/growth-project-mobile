/**
 * communityVoiceApi — wire-contract tests for the v3-3 voice-notes client.
 *
 * Mocks the axios instance at `../services/api` (the repo's established test
 * seam) and the bare `axios` module (for the signed-URL byte PUT). Asserts:
 *   - the exact URL + HTTP method + params/body the mobile client sends,
 *   - the two-hop publish flow (issueUploadUrl -> uploadBytes -> create),
 *   - that the client never sends a waveform field on create (backend ignores
 *     it; sending it would be silent drift),
 *   - a Zod parse-SUCCESS path (valid backend shape -> typed object),
 *   - a Zod parse-FAILURE path (drifted shape -> CommunityApiError `contract`),
 *   - HTTP error mapping (401 -> unauthorized, 403 -> forbidden, 5xx -> server,
 *     network -> network),
 *   - bounded pagination params (limit always present; cursor threaded).
 */
import axios from 'axios';
import {
  communityVoiceApi,
  VoiceNoteViewSchema,
  VOICE_PAGE_LIMIT,
  MAX_VOICE_DURATION_MS,
  MAX_VOICE_BYTES,
  VOICE_NOTE_MIME_ALLOWLIST,
  type VoiceNoteView,
  type VoiceUploadTarget,
} from './communityVoiceApi';
import { CommunityApiError } from './communityApi';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    put: jest.fn(),
    // isAxiosError is consulted by the client's catch blocks.
    isAxiosError: (e: unknown): boolean =>
      !!(e as { isAxiosError?: boolean })?.isAxiosError,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};
const mockedAxios = jest.mocked(axios);

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  mockedAxios.put.mockReset();
});

function axiosError(status: number): Error {
  const err = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response?: { status: number };
  };
  err.isAxiosError = true;
  if (status > 0) err.response = { status };
  return err;
}

const WS = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';

function view(overrides: Partial<VoiceNoteView> = {}): VoiceNoteView {
  return {
    id: NOTE_ID,
    workspace_id: WS,
    cohort_id: null,
    conversation_id: null,
    author_id: '33333333-3333-4333-8333-333333333333',
    url: 'https://signed.example/audio.m4a',
    duration_ms: 4200,
    bytes: 91234,
    mime_type: 'audio/mp4',
    has_waveform: false,
    created_at: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

const uploadTarget: VoiceUploadTarget = {
  upload_url: 'https://storage.example/put/abc',
  storage_key: '33333333-3333-4333-8333-333333333333/1700-note.m4a',
  expires_at: '2026-06-10T00:05:00.000Z',
  expires_in_seconds: 300,
  bucket: 'community-voice',
};

describe('communityVoiceApi — limits mirror the backend DTO', () => {
  it('pins the duration / size / mime constants', () => {
    expect(MAX_VOICE_DURATION_MS).toBe(300_000);
    expect(MAX_VOICE_BYTES).toBe(25_000_000);
    expect([...VOICE_NOTE_MIME_ALLOWLIST]).toEqual([
      'audio/mp4',
      'audio/aac',
      'audio/webm',
      'audio/wav',
    ]);
  });
});

describe('communityVoiceApi — two-hop publish flow', () => {
  it('issueUploadUrl posts duration/size/mime and parses the signed target', async () => {
    api.post.mockResolvedValueOnce({ data: uploadTarget });
    const res = await communityVoiceApi.issueUploadUrl(WS, {
      duration_ms: 4200,
      bytes: 91234,
      mime_type: 'audio/mp4',
    });
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe(`/community/workspaces/${WS}/voice-notes/upload-url`);
    expect(body).toEqual({
      duration_ms: 4200,
      bytes: 91234,
      mime_type: 'audio/mp4',
    });
    expect(res.storage_key).toBe(uploadTarget.storage_key);
    expect(res.bucket).toBe('community-voice');
  });

  it('uploadBytes PUTs the raw bytes to the signed URL with the right content type', async () => {
    mockedAxios.put.mockResolvedValueOnce({ status: 200 });
    const bytes = new ArrayBuffer(8);
    await communityVoiceApi.uploadBytes(
      uploadTarget.upload_url,
      bytes,
      'audio/mp4',
    );
    const [url, body, config] = mockedAxios.put.mock.calls[0];
    expect(url).toBe(uploadTarget.upload_url);
    expect(body).toBe(bytes);
    expect(config?.headers?.['Content-Type']).toBe('audio/mp4');
  });

  it('uploadBytes maps a transport failure to a typed CommunityApiError', async () => {
    mockedAxios.put.mockRejectedValueOnce(axiosError(0));
    await expect(
      communityVoiceApi.uploadBytes(uploadTarget.upload_url, new ArrayBuffer(8), 'audio/mp4'),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('create posts ONLY the storage key + limits (never a waveform field) and unwraps the note', async () => {
    api.post.mockResolvedValueOnce({ data: { voice_note: view() } });
    const res = await communityVoiceApi.create(WS, {
      storage_key: uploadTarget.storage_key,
      duration_ms: 4200,
      bytes: 91234,
      mime_type: 'audio/mp4',
    });
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe(`/community/workspaces/${WS}/voice-notes`);
    expect(body).toEqual({
      storage_key: uploadTarget.storage_key,
      duration_ms: 4200,
      bytes: 91234,
      mime_type: 'audio/mp4',
    });
    // Hard gate: the backend ignores client waveform; we must not send one.
    expect(body).not.toHaveProperty('waveform');
    expect(body).not.toHaveProperty('waveform_peaks');
    expect(res.id).toBe(NOTE_ID);
  });

  it('create threads an optional cohort / conversation target', async () => {
    api.post.mockResolvedValueOnce({
      data: { voice_note: view({ cohort_id: 'co-1' }) },
    });
    await communityVoiceApi.create(WS, {
      storage_key: uploadTarget.storage_key,
      duration_ms: 1000,
      bytes: 100,
      mime_type: 'audio/aac',
      cohortId: 'co-1',
    });
    const [, body] = api.post.mock.calls[0];
    expect(body.cohort_id).toBe('co-1');
    expect(body).not.toHaveProperty('conversation_id');
  });
});

describe('communityVoiceApi — reads + delete', () => {
  it('listFeed always sends a bounded limit and threads the cursor', async () => {
    api.get.mockResolvedValue({ data: { voice_notes: [], next_cursor: null } });
    await communityVoiceApi.listFeed(WS);
    expect(api.get).toHaveBeenLastCalledWith(
      `/community/workspaces/${WS}/voice-notes`,
      expect.objectContaining({ params: { limit: String(VOICE_PAGE_LIMIT) } }),
    );

    await communityVoiceApi.listFeed(WS, { cursor: 'cur-9', cohortId: 'co-2' });
    const lastCall = api.get.mock.calls[api.get.mock.calls.length - 1];
    expect(lastCall[1].params).toEqual({
      limit: String(VOICE_PAGE_LIMIT),
      cursor: 'cur-9',
      cohort_id: 'co-2',
    });
  });

  it('getOne unwraps the envelope', async () => {
    api.get.mockResolvedValueOnce({ data: { voice_note: view() } });
    const res = await communityVoiceApi.getOne(NOTE_ID);
    expect(api.get).toHaveBeenCalledWith(
      `/community/voice-notes/${NOTE_ID}`,
      expect.any(Object),
    );
    expect(res.id).toBe(NOTE_ID);
  });

  it('remove deletes and parses the { deleted: true } envelope', async () => {
    api.delete.mockResolvedValueOnce({ data: { deleted: true } });
    const res = await communityVoiceApi.remove(NOTE_ID);
    expect(api.delete).toHaveBeenCalledWith(
      `/community/voice-notes/${NOTE_ID}`,
      expect.any(Object),
    );
    expect(res.deleted).toBe(true);
  });
});

describe('communityVoiceApi — error + contract mapping', () => {
  it('maps 401 -> unauthorized, 403 -> forbidden, 5xx -> server', async () => {
    api.get.mockRejectedValueOnce(axiosError(401));
    await expect(communityVoiceApi.getOne(NOTE_ID)).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    api.get.mockRejectedValueOnce(axiosError(403));
    await expect(communityVoiceApi.getOne(NOTE_ID)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    api.get.mockRejectedValueOnce(axiosError(503));
    await expect(communityVoiceApi.getOne(NOTE_ID)).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('re-wraps a drifted response shape as a `contract` error', async () => {
    api.get.mockResolvedValueOnce({ data: { voice_note: { id: 1 } } });
    await expect(communityVoiceApi.getOne(NOTE_ID)).rejects.toBeInstanceOf(
      CommunityApiError,
    );
    api.get.mockResolvedValueOnce({ data: { voice_note: { id: 2 } } });
    await expect(communityVoiceApi.getOne(NOTE_ID)).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('the view schema rejects an unknown extra key (strict)', () => {
    const bad = { ...view(), surprise: true } as unknown;
    expect(() => VoiceNoteViewSchema.parse(bad)).toThrow();
  });
});
