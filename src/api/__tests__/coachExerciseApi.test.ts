/**
 * coachExerciseApi — contract + transport tests.
 *
 * Pins that the response schemas mirror the backend DTO and are strict: an
 * extra/unknown field fails validation and surfaces as a `contract`
 * CommunityApiError (never silently passing malformed data into React state),
 * an HTTP failure is classified into the typed error kinds, and the create body
 * only carries the storage_key/media_mime when media is attached.
 */
import axios from 'axios';
import { coachExerciseApi } from '../coachExerciseApi';
import { CommunityApiError } from '../communityApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
};

const ISO = '2026-06-17T12:00:00.000Z';

function validMove() {
  return {
    id: 'move-1',
    coach_id: 'coach-1',
    name: 'Standing forward fold',
    instructions: 'Hinge at the hips.',
    media_kind: 'video',
    media_url: 'https://signed.example/move.mp4',
    media_mime: 'video/mp4',
    created_at: ISO,
    archived_at: null,
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('coachExerciseApi — contract validation', () => {
  it('parses a valid library list', async () => {
    api.get.mockResolvedValue({ data: { coach_exercises: [validMove()] } });
    const page = await coachExerciseApi.list();
    expect(page.coach_exercises).toHaveLength(1);
    expect(page.coach_exercises[0]?.name).toBe('Standing forward fold');
  });

  it('rejects an unknown field on the move (strict) as a contract error', async () => {
    api.get.mockResolvedValue({
      data: { coach_exercises: [{ ...validMove(), surprise: true }] },
    });
    await expect(coachExerciseApi.list()).rejects.toBeInstanceOf(CommunityApiError);
    await expect(coachExerciseApi.list()).rejects.toMatchObject({ kind: 'contract' });
  });

  it('parses the media upload target', async () => {
    api.post.mockResolvedValue({
      data: {
        upload_url: 'https://storage.example/put',
        storage_key: 'coach-1/move.mp4',
        expires_at: ISO,
        expires_in_seconds: 300,
        bucket: 'coach-exercise',
      },
    });
    const t = await coachExerciseApi.issueMediaUploadUrl({
      bytes: 100,
      mime_type: 'video/mp4',
    });
    expect(t.storage_key).toBe('coach-1/move.mp4');
  });
});

describe('coachExerciseApi — create body shaping', () => {
  it('omits storage_key/media_mime for a media-less move', async () => {
    api.post.mockResolvedValue({ data: { coach_exercise: validMove() } });
    await coachExerciseApi.create({
      name: 'Box breathing',
      instructions: 'calm',
      media_kind: 'none',
    });
    const body = api.post.mock.calls[0]?.[1];
    expect(body).toEqual({
      name: 'Box breathing',
      instructions: 'calm',
      media_kind: 'none',
    });
  });

  it('includes storage_key + media_mime when media is attached', async () => {
    api.post.mockResolvedValue({ data: { coach_exercise: validMove() } });
    await coachExerciseApi.create({
      name: 'Fold',
      instructions: '',
      media_kind: 'video',
      storage_key: 'coach-1/move.mp4',
      media_mime: 'video/mp4',
    });
    const body = api.post.mock.calls[0]?.[1];
    expect(body).toMatchObject({
      storage_key: 'coach-1/move.mp4',
      media_mime: 'video/mp4',
    });
  });
});

describe('coachExerciseApi — transport error classification', () => {
  it('classifies a 403 as forbidden', async () => {
    const err = Object.assign(new Error('nope'), {
      isAxiosError: true,
      response: { status: 403 },
    });
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    api.get.mockRejectedValue(err);
    await expect(coachExerciseApi.list()).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    });
  });
});
