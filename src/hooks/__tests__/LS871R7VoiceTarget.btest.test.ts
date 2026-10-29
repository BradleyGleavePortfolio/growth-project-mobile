import { communityVoiceApi } from '../../api/communityVoiceApi';
import { publishVoiceNote } from '../useVoiceUpload';

afterEach(() => { jest.restoreAllMocks(); });

it('LS871R7 BPF-1: the space target is sent when requesting a voice upload URL', async () => {
  const workspace = '11111111-1111-4111-8111-111111111111';
  const cohort = '22222222-2222-4222-8222-222222222222';
  const target = {
    upload_url: 'https://storage.example/put/recording',
    storage_key: 'author/recording.m4a',
    expires_at: '2026-10-29T03:00:00.000Z',
    expires_in_seconds: 300,
    bucket: 'community-voice',
  };
  const issue = jest.spyOn(communityVoiceApi, 'issueUploadUrl').mockResolvedValue(target);
  jest.spyOn(communityVoiceApi, 'uploadBytes').mockResolvedValue(undefined);
  jest.spyOn(communityVoiceApi, 'create').mockResolvedValue({
    id: 'voice-1',
    workspace_id: workspace,
    cohort_id: cohort,
    conversation_id: null,
    author_id: 'author',
    url: 'https://signed.example/recording.m4a',
    duration_ms: 3000,
    bytes: 100,
    mime_type: 'audio/mp4',
    has_waveform: false,
    created_at: '2026-10-29T02:00:00.000Z',
  });
  await publishVoiceNote(workspace, {
    uri: 'file:///recording.m4a',
    durationMs: 3000,
    bytes: 100,
    mimeType: 'audio/mp4',
    cohortId: cohort,
  }, { readBytes: async () => new ArrayBuffer(100) });
  expect(issue).toHaveBeenCalledWith(workspace, expect.objectContaining({
    cohort_id: cohort,
  }));
});
