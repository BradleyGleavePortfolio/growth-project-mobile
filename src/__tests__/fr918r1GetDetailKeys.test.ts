/**
 * FR-918R1 (LO-918 B1, class test). Exercise details' read (getDetail) falls
 * back to /exercises on a catalog 404 only for a key /exercises can hold:
 * a `seed:` id, an ExerciseDB number id ("0025") or a v2 `exr_` id. A name
 * slug (what Watch video sends for a saved routine's exercise with no library
 * id) and a library uuid are catalog-only: /exercises answers them with a 500
 * (503 with no ExerciseDB key), so the catalog's 404 is kept and Exercise
 * details shows W3 "No details for this exercise yet." instead of the
 * connection words.
 */
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

import { exerciseCatalogApi } from '../api/exerciseCatalog';
import { catalogKey } from '../utils/workout/exerciseId';

const notFound = { response: { status: 404 } };
const libraryRow = (id: string) => ({
  data: {
    id, name: 'barbell bench press', bodyPart: 'chest', target: 'pectorals',
    equipment: 'barbell', secondaryMuscles: [], instructions: ['Press.'], gifUrl: '', video_url: null,
  },
});

beforeEach(() => mockGet.mockReset());

describe('getDetail keeps the catalog 404 for a catalog-only key', () => {
  it.each([
    ['a routine exercise name slug', catalogKey('routine:r1/barbell-bench-press', 'Barbell Bench Press')],
    ['a one-word name slug', catalogKey('ex_abc123', 'Plank')],
    ['a slug with digits', catalogKey('manual:x', '90/90 Hip Switch')],
    ['a library uuid', '3f1c2b9e-8d4a-4c1b-9e2f-0a1b2c3d4e5f'],
  ])('%s (%s) never calls /exercises', async (_label, key) => {
    mockGet.mockImplementation((url: string) => Promise.reject(
      url.startsWith('/exercise-catalog/') ? notFound : { response: { status: 500 } },
    ));
    await expect(exerciseCatalogApi.getDetail(key)).rejects.toMatchObject(notFound);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(`/exercise-catalog/${encodeURIComponent(key)}`);
  });
});

describe('getDetail still falls back for a key /exercises holds', () => {
  it.each([
    ['a seed id', 'seed:push-001', '/exercises/seed%3Apush-001'],
    ['an ExerciseDB number id', '0025', '/exercises/0025'],
    ['an ExerciseDB v2 id', 'exr_41n2hxnFMotsXTj3', '/exercises/exr_41n2hxnFMotsXTj3'],
  ])('%s (%s)', async (_label, key, fallbackUrl) => {
    mockGet.mockRejectedValueOnce(notFound);
    mockGet.mockResolvedValueOnce(libraryRow(key));
    const response = await exerciseCatalogApi.getDetail(key);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenLastCalledWith(fallbackUrl);
    expect(response.data).toMatchObject({ id: key, name: 'Barbell bench press', instructions: ['Press.'] });
  });

  it('a failed (not missing) catalog read never falls back, whatever the key', async () => {
    for (const key of ['barbell-bench-press', 'seed:push-001', '0025']) {
      mockGet.mockReset();
      mockGet.mockRejectedValueOnce({ response: { status: 503 } });
      await expect(exerciseCatalogApi.getDetail(key)).rejects.toMatchObject({ response: { status: 503 } });
      expect(mockGet).toHaveBeenCalledTimes(1);
    }
  });
});
