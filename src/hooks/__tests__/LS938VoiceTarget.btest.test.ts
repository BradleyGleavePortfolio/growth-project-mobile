/**
 * LS-938: the unit's space adapter passes cohortId into the shared publisher.
 * Both authorization hops must name that same space, including the first upload.
 * No server request or recording is made by this controlled publisher test.
 */
jest.mock('../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../api/communityVoiceApi');
  return {
    ...actual,
    communityVoiceApi: {
      issueUploadUrl: jest.fn(),
      uploadBytes: jest.fn(),
      create: jest.fn(),
    },
  };
});

import { communityVoiceApi } from '../../api/communityVoiceApi';
import { publishVoiceNote } from '../useVoiceUpload';

it('LS938 BPF-1: upload issuance and create both name the selected space', async () => {
  const api = jest.mocked(communityVoiceApi);
  const workspace = '11111111-1111-4111-8111-111111111111';
  const space = '22222222-2222-4222-8222-222222222222';
  api.issueUploadUrl.mockResolvedValue({
    upload_url: 'https://storage.example/upload',
    storage_key: 'viewer/recording.m4a',
    expires_at: '2026-11-05T19:00:00Z',
    expires_in_seconds: 300,
    bucket: 'community-voice',
  });
  api.uploadBytes.mockResolvedValue(undefined);
  api.create.mockResolvedValue({
    id: 'note',
    workspace_id: workspace,
    cohort_id: space,
    conversation_id: null,
    author_id: 'viewer',
    url: null,
    duration_ms: 3000,
    bytes: 50000,
    mime_type: 'audio/mp4',
    has_waveform: false,
    created_at: '2026-11-05T18:00:00Z',
  });
  await publishVoiceNote(workspace, {
    uri: 'file:///recording.m4a',
    durationMs: 3000,
    bytes: 50000,
    mimeType: 'audio/mp4',
    cohortId: space,
  }, { readBytes: async () => new ArrayBuffer(8) });

  expect(api.create).toHaveBeenCalledWith(
    workspace,
    expect.objectContaining({ cohortId: space }),
    undefined,
  );
  expect(api.issueUploadUrl).toHaveBeenCalledWith(
    workspace,
    expect.objectContaining({ cohort_id: space }),
    undefined,
  );
});
