/**
 * workoutAutosaveApi contract-drift tests (MWB-4).
 *
 * The whole point of the Zod-at-the-boundary layer is that a drifted backend
 * shape (an extra key, a wrong type, a malformed timestamp, a non-hex lock
 * token) fails LOUDLY as a `contract` error here rather than feeding malformed
 * data into React state. These tests pin that contract from both directions:
 *   - the OUTGOING batch is rejected locally before it leaves the device, and
 *   - the INCOMING 200 / 409 bodies are parsed strictly.
 *
 * We mock the shared axios instance (`../services/api`) so no real network
 * fires; each test drives a specific HTTP outcome and asserts the classified
 * error kind + the parsed conflict payload.
 */

import axios from 'axios';

jest.mock('axios');
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { patch: jest.fn(), post: jest.fn(), get: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  patch: jest.Mock;
  post: jest.Mock;
  get: jest.Mock;
};

import {
  AutosaveBatchSchema,
  AutosaveConflictSchema,
  AutosaveOpSchema,
  AutosaveResponseSchema,
  UpsertExerciseRowSchema,
  workoutAutosaveApi,
  WorkoutAutosaveApiError,
  __byteLengthUtf8ForTest,
  type AutosaveBatch,
} from '../workoutAutosaveApi';

const VALID_TOKEN = 'a1b2c3d4e5f60718';
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function validBatch(overrides: Partial<AutosaveBatch> = {}): AutosaveBatch {
  return {
    base_revision_index: 0,
    lock_token: VALID_TOKEN,
    cause: 'autosave',
    ops: [
      {
        op: 'upsert_exercise',
        payload: {
          exercise_external_id: 'ex-1',
          order: 1,
          sets: 3,
          reps_or_duration_seconds: 10,
          weight_lbs: null,
          rest_seconds: 60,
          superset_group_id: null,
          notes: null,
        },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // The error normaliser calls axios.isCancel + axios.isAxiosError. With the
  // module auto-mocked, install typed jest mocks via `jest.mocked` (no
  // double-cast — R0 grep clean). isCancel treats an `ERR_CANCELED`/cancel flag
  // as a cancel; isAxiosError keys off the conventional `isAxiosError` flag.
  jest.mocked(axios.isCancel).mockImplementation(
    (e: unknown): e is import('axios').Cancel =>
      Boolean(
        (e as { __CANCEL__?: boolean; code?: string })?.__CANCEL__ ||
          (e as { code?: string })?.code === 'ERR_CANCELED',
      ),
  );
  jest.mocked(axios.isAxiosError).mockImplementation(
    (e: unknown): e is import('axios').AxiosError =>
      Boolean((e as { isAxiosError?: boolean })?.isAxiosError),
  );
});

function axiosErrorWith(status: number, data: unknown): unknown {
  return { isAxiosError: true, response: { status, data } };
}

describe('strict request schemas reject drift', () => {
  it('UpsertExerciseRowSchema rejects an unknown extra field', () => {
    const res = UpsertExerciseRowSchema.safeParse({
      exercise_external_id: 'ex-1',
      order: 1,
      sets: 3,
      reps_or_duration_seconds: 10,
      surprise: 'nope',
    });
    expect(res.success).toBe(false);
  });

  it('UpsertExerciseRowSchema rejects a non-integer sets value', () => {
    const res = UpsertExerciseRowSchema.safeParse({
      exercise_external_id: 'ex-1',
      order: 1,
      sets: 3.5,
      reps_or_duration_seconds: 10,
    });
    expect(res.success).toBe(false);
  });

  it('AutosaveOpSchema requires a uuid row_id for remove_exercise', () => {
    expect(
      AutosaveOpSchema.safeParse({ op: 'remove_exercise', row_id: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(
      AutosaveOpSchema.safeParse({ op: 'remove_exercise', row_id: VALID_UUID })
        .success,
    ).toBe(true);
  });

  it('AutosaveBatchSchema rejects a non-hex lock_token', () => {
    expect(
      AutosaveBatchSchema.safeParse(validBatch({ lock_token: 'ZZZZ' })).success,
    ).toBe(false);
  });

  it('AutosaveBatchSchema rejects an empty ops array', () => {
    expect(AutosaveBatchSchema.safeParse(validBatch({ ops: [] })).success).toBe(
      false,
    );
  });

  it('AutosaveBatchSchema rejects an extra top-level key', () => {
    const bad = { ...validBatch(), client_edit_id: 'x' } as unknown;
    expect(AutosaveBatchSchema.safeParse(bad).success).toBe(false);
  });
});

describe('strict response schemas reject drift', () => {
  it('AutosaveResponseSchema rejects a non-ISO saved_at', () => {
    expect(
      AutosaveResponseSchema.safeParse({
        head_revision_index: 1,
        lock_token: VALID_TOKEN,
        saved_at: 'yesterday',
      }).success,
    ).toBe(false);
  });

  it('AutosaveResponseSchema accepts a well-formed body', () => {
    expect(
      AutosaveResponseSchema.safeParse({
        head_revision_index: 1,
        lock_token: VALID_TOKEN,
        saved_at: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('AutosaveConflictSchema requires a known error literal', () => {
    expect(
      AutosaveConflictSchema.safeParse({
        error: 'something_else',
        head_revision_index: 2,
        lock_token: VALID_TOKEN,
      }).success,
    ).toBe(false);
  });
});

describe('autosave() outgoing guard', () => {
  it('throws a local contract error before sending an invalid batch', async () => {
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k1',
        body: validBatch({ lock_token: 'nothex' }),
      }),
    ).rejects.toMatchObject({ kind: 'contract' });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('throws a contract error when ops exceed the 64KB byte cap', async () => {
    const bigNotes = 'x'.repeat(400);
    const ops = Array.from({ length: 200 }, (_, i) => ({
      op: 'upsert_exercise' as const,
      payload: {
        exercise_external_id: `ex-${i}`,
        order: i + 1,
        sets: 3,
        reps_or_duration_seconds: 10,
        weight_lbs: null,
        rest_seconds: 60,
        superset_group_id: null,
        notes: bigNotes,
      },
    }));
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k1',
        body: validBatch({ ops }),
      }),
    ).rejects.toMatchObject({ kind: 'contract' });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('sends the Idempotency-Key header and returns a parsed 200', async () => {
    api.patch.mockResolvedValueOnce({
      data: {
        head_revision_index: 5,
        lock_token: VALID_TOKEN,
        saved_at: '2026-01-01T00:00:00.000Z',
      },
    });
    const res = await workoutAutosaveApi.autosave({
      planId: 'p1',
      idempotencyKey: 'idem-123',
      body: validBatch(),
    });
    expect(res.head_revision_index).toBe(5);
    expect(api.patch).toHaveBeenCalledWith(
      '/workout-plans/p1/autosave',
      expect.any(Object),
      { headers: { 'Idempotency-Key': 'idem-123' } },
    );
  });

  it('throws a contract error when the 200 body shape drifts', async () => {
    api.patch.mockResolvedValueOnce({
      data: { head_revision_index: 5, lock_token: VALID_TOKEN }, // missing saved_at
    });
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      }),
    ).rejects.toMatchObject({ kind: 'contract' });
  });
});

describe('autosave() error classification', () => {
  it('classifies a 409 as conflict and parses the conflict body', async () => {
    api.patch.mockRejectedValueOnce(
      axiosErrorWith(409, {
        error: 'autosave_lock_stale',
        head_revision_index: 7,
        lock_token: VALID_TOKEN,
      }),
    );
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      }),
    ).rejects.toMatchObject({
      kind: 'conflict',
      conflict: { head_revision_index: 7, lock_token: VALID_TOKEN },
    });
  });

  it('still yields a conflict (no payload) when the 409 body is malformed', async () => {
    api.patch.mockRejectedValueOnce(axiosErrorWith(409, { garbage: true }));
    try {
      await workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkoutAutosaveApiError);
      const e = err as WorkoutAutosaveApiError;
      expect(e.kind).toBe('conflict');
      expect(e.conflict).toBeUndefined();
    }
  });

  it('classifies a 404 as gone and a 403 as forbidden', async () => {
    api.patch.mockRejectedValueOnce(axiosErrorWith(404, {}));
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      }),
    ).rejects.toMatchObject({ kind: 'gone' });

    api.patch.mockRejectedValueOnce(axiosErrorWith(403, {}));
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('classifies a no-response failure as network', async () => {
    api.patch.mockRejectedValueOnce({ isAxiosError: true, response: undefined });
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      }),
    ).rejects.toMatchObject({ kind: 'network', isNetwork: true });
  });

  it('classifies a 5xx as server', async () => {
    api.patch.mockRejectedValueOnce(axiosErrorWith(503, {}));
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      }),
    ).rejects.toMatchObject({ kind: 'server' });
  });

  it('classifies a CanceledError (signal abort) as aborted, not a transport error', async () => {
    // An axios cancel surfaces via isCancel; the normaliser must map it to the
    // distinct `aborted` kind so the hook keeps the batch for replay rather
    // than treating a deliberate unmount-abort as an offline/server failure.
    api.patch.mockRejectedValueOnce({ __CANCEL__: true, message: 'canceled' });
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      }),
    ).rejects.toMatchObject({ kind: 'aborted', isAborted: true });
  });

  it('classifies an ERR_CANCELED axios error as aborted', async () => {
    api.patch.mockRejectedValueOnce({
      isAxiosError: true,
      code: 'ERR_CANCELED',
      message: 'canceled',
    });
    await expect(
      workoutAutosaveApi.autosave({
        planId: 'p1',
        idempotencyKey: 'k',
        body: validBatch(),
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('autosave() threads the AbortSignal', () => {
  it('passes the caller signal through to the axios request config', async () => {
    api.patch.mockResolvedValueOnce({
      data: {
        head_revision_index: 2,
        lock_token: VALID_TOKEN,
        saved_at: '2026-01-01T00:00:00.000Z',
      },
    });
    const controller = new AbortController();
    await workoutAutosaveApi.autosave({
      planId: 'p1',
      idempotencyKey: 'idem-sig',
      body: validBatch(),
      signal: controller.signal,
    });
    expect(api.patch).toHaveBeenCalledWith(
      '/workout-plans/p1/autosave',
      expect.any(Object),
      {
        headers: { 'Idempotency-Key': 'idem-sig' },
        signal: controller.signal,
      },
    );
  });
});

describe('byteLengthUtf8', () => {
  it('counts ASCII as 1 byte and multibyte correctly', () => {
    expect(__byteLengthUtf8ForTest('abc')).toBe(3);
    expect(__byteLengthUtf8ForTest('é')).toBe(2); // U+00E9
    expect(__byteLengthUtf8ForTest('€')).toBe(3); // U+20AC
    expect(__byteLengthUtf8ForTest('😀')).toBe(4); // surrogate pair
  });
});
