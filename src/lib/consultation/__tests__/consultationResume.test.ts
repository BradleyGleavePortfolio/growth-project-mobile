/**
 * Resume reconciliation (Sol B-03): newer-local, newer-server, unchanged
 * server, never-synced and multiple-device cases.
 */
import { reconcileResume, serverChangedSince } from '../resume';
import type { LocalConsultationState } from '../storage';
import { fullAnswers } from '../__fixtures__/consultFixtures';

function local(over: Partial<LocalConsultationState> = {}): LocalConsultationState {
  return {
    version: 'consult-v2',
    answers: fullAnswers({ S1: '2' }),
    screenId: 'S1',
    updatedAt: '2026-09-30T19:00:00.000Z',
    editedAt: '2026-09-30T19:00:00.000Z',
    dirty: true,
    synced: { saved_at: '2026-09-30T18:00:00.000Z', revision: 3 },
    ...over,
  };
}

describe('reconcileResume', () => {
  it('no local draft: the server copy wins', () => {
    const d = reconcileResume(null, { answers: fullAnswers({ S1: '4' }), saved_at: '2026-09-30T20:00:00Z', revision: 5 });
    expect(d.source).toBe('server');
    expect(d.answers.S1).toBe('4');
    expect(d.dirty).toBe(false);
    expect(d.synced).toEqual({ saved_at: '2026-09-30T20:00:00Z', revision: 5 });
  });

  it('no server answers: the local draft wins and stays dirty', () => {
    const d = reconcileResume(local(), null);
    expect(d.source).toBe('local');
    expect(d.answers.S1).toBe('2');
    expect(d.dirty).toBe(true);
  });

  it('a clean local mirror never overrides the server (another device saved since)', () => {
    const d = reconcileResume(local({ dirty: false }), { answers: fullAnswers({ S1: '4' }), saved_at: '2026-09-30T20:00:00Z', revision: 4 });
    expect(d.source).toBe('server');
    expect(d.answers.S1).toBe('4');
    expect(d.screenId).toBe('S1');
  });

  it('unsynced local edits win when the server has not changed since this device synced', () => {
    const d = reconcileResume(local(), { answers: fullAnswers({ S1: '3' }), saved_at: '2026-09-30T18:00:00.000Z', revision: 3 });
    expect(d.source).toBe('local');
    expect(d.answers.S1).toBe('2');
    expect(d.dirty).toBe(true);
  });

  it('newer server copy from another device beats an older unsynced local draft (audit probe)', () => {
    const d = reconcileResume(
      local({ editedAt: '2026-09-29T19:00:00Z', synced: null }),
      { answers: fullAnswers({ S1: '4' }), saved_at: '2026-09-30T20:00:00Z' },
    );
    expect(d.source).toBe('server');
    expect(d.answers.S1).toBe('4');
    expect(d.dirty).toBe(false);
  });

  it('newer unsynced local edits beat an older server change, and are based on the server revision', () => {
    const d = reconcileResume(
      local({ editedAt: '2026-09-30T21:00:00Z' }),
      { answers: fullAnswers({ S1: '4' }), saved_at: '2026-09-30T20:00:00Z', revision: 4 },
    );
    expect(d.source).toBe('local');
    expect(d.answers.S1).toBe('2');
    expect(d.dirty).toBe(true);
    expect(d.synced).toEqual({ saved_at: '2026-09-30T20:00:00Z', revision: 4 });
  });

  it('compares revisions first, timestamps second', () => {
    expect(serverChangedSince({ saved_at: '2026-09-30T23:00:00Z', revision: 4 }, { answers: {}, saved_at: '2026-09-30T20:00:00Z', revision: 5 })).toBe(true);
    expect(serverChangedSince({ saved_at: '2026-09-30T19:00:00Z', revision: 5 }, { answers: {}, saved_at: '2026-09-30T20:00:00Z', revision: 5 })).toBe(false);
    expect(serverChangedSince({ saved_at: '2026-09-30T19:00:00Z', revision: null }, { answers: {}, saved_at: '2026-09-30T20:00:00Z' })).toBe(true);
    expect(serverChangedSince(null, { answers: {}, saved_at: null })).toBe(false);
  });

  it('nothing anywhere: empty', () => {
    expect(reconcileResume(null, null).source).toBe('empty');
    expect(reconcileResume(local({ answers: {} }), { answers: null }).source).toBe('empty');
  });
});
