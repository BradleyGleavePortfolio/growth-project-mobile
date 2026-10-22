/**
 * communityVoiceApi — the Studio contract (backend #1122 "Contract for the
 * phone"; OPERATOR RULING 6304777236): the strict view takes the six new keys
 * and still parses today's shape; peaks are clamped and never sent empty.
 */
import api from '../../services/api';
import { communityVoiceApi, VoiceNoteViewSchema, wirePeaks } from '../communityVoiceApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
const post = jest.mocked(api.post);

const today = {
  id: 'vn-1', workspace_id: 'ws-1', cohort_id: null, conversation_id: null, author_id: 'u-1', url: null,
  duration_ms: 4000, bytes: 10, mime_type: 'audio/mp4', has_waveform: false, created_at: '2026-10-21T10:00:00.000Z',
};
const studio = {
  ...today, has_waveform: true, author_name: 'Sam Ortiz', author_is_coach: true,
  waveform_peaks: [0.1, 0.9], heard_at: null, message_id: null, parent_message_id: null,
};

beforeEach(() => {
  post.mockReset();
});

describe('VoiceNoteViewSchema', () => {
  it('parses today’s note exactly as before (server not deployed)', () => {
    expect(VoiceNoteViewSchema.parse(today)).toEqual(today);
  });
  it('parses the six Studio keys', () => {
    expect(VoiceNoteViewSchema.parse(studio)).toEqual(studio);
  });
  it('stays strict: an unknown key is still a contract error', () => {
    expect(() => VoiceNoteViewSchema.parse({ ...studio, extra: 1 })).toThrow();
  });
});

describe('create', () => {
  it('sends clamped peaks (max 64) and omits them when there are none', async () => {
    post.mockResolvedValue({ data: { voice_note: studio } });
    const base = { storage_key: 'u-1/a', duration_ms: 4000, bytes: 10, mime_type: 'audio/mp4' as const };
    await communityVoiceApi.create('ws-1', { ...base, waveformPeaks: [-1, 0.5, 2, Number.NaN] });
    expect(post.mock.calls[0][1]).toEqual({ ...base, waveform_peaks: [0, 0.5, 1, 0] });
    await communityVoiceApi.create('ws-1', { ...base, waveformPeaks: [] });
    expect(post.mock.calls[1][1]).toEqual(base);
    expect(wirePeaks(Array.from({ length: 80 }, () => 0.5))).toHaveLength(64);
  });
});
