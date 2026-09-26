/**
 * S12-B3 contract pin + fail-closed decoder tests for the scout import status
 * and reconstruct roster reads. The fixture is a mechanical projection of the
 * backend contract artifact at landed commit 54be96f1 (see
 * execution/fa72efb2/s12b3/tooling/extract_s12b3_status_surface_fixture.py);
 * every closed enum the mobile decoder recognises must equal the fixture's.
 */
import fixture from '../__fixtures__/s12b3ScoutStatusSurface.54be96f1.json';
import {
  CLAIMED_STATUSES,
  LEGACY_TERMINAL_STATUSES,
  ROSTER_PERSON_STATES,
  RUN_MODES,
  RUN_PHASES,
  RUN_READ_STATUSES,
  RUN_REASON_CODES,
  SERVER_TERMINAL_STATUSES,
  decodeIsoTime,
  decodeRosterPage,
  decodeRunStatus,
  isTerminal,
} from '../importRunStatus';

type Schema = { properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }>; required: string[] };
const schemas = fixture.components.schemas as unknown as Record<string, Schema>;
const status = schemas.ScoutImportStatusResult;

const INTENT = '5b0c1c7e-7c64-4d8e-9d44-3f1f4b0d2a11';

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent_id: INTENT,
    status: 'running',
    entity_counts: [],
    started_at: '2026-09-26T10:00:00.000Z',
    completed_at: null,
    mode: 'server',
    phase: 'transferring',
    accepted_start_at: '2026-09-26T10:00:00.000Z',
    deadline_at: '2026-09-26T11:00:00.000Z',
    last_observed_at: null,
    execution_epoch: 1,
    claimed_status: null,
    reason_code: null,
    families: [],
    ...over,
  };
}

describe('S12-B3 contract pin (54be96f1)', () => {
  it('pins the projected source artifact and paths', () => {
    expect(fixture.$fixture.source.commit).toBe('54be96f18c314cae35d1e5d3000af9f06d693d81');
    expect(fixture.$fixture.source.sha256).toBe('889d25c6a529512596b01ba6554bbf4038ca7f33fdc66f6c9c14118b44dc53f4');
    expect(fixture.$fixture.source.contract_version).toBe('2.0.0-c1-s2.0');
    expect(Object.keys(fixture.paths).sort()).toEqual(['/api/scout/import/status', '/api/scout/reconstruct/roster']);
  });

  it('status/mode/phase/reason_code/claimed_status enums equal the contract', () => {
    expect([...RUN_READ_STATUSES]).toEqual(status.properties.status.enum);
    expect([...RUN_MODES]).toEqual(status.properties.mode.enum);
    expect([...RUN_PHASES]).toEqual(status.properties.phase.enum);
    expect([...RUN_REASON_CODES]).toEqual(status.properties.reason_code.enum);
    expect([...CLAIMED_STATUSES]).toEqual(status.properties.claimed_status.enum);
  });

  it('legacy + server terminal subsets together cover every non-running status', () => {
    const terminals = new Set<string>([...LEGACY_TERMINAL_STATUSES, ...SERVER_TERMINAL_STATUSES]);
    expect([...terminals].sort()).toEqual(RUN_READ_STATUSES.filter((s) => s !== 'running').sort());
    expect(SERVER_TERMINAL_STATUSES as readonly string[]).not.toContain('success');
  });

  it('every field the decoder reads is required in the contract', () => {
    for (const f of ['intent_id', 'status', 'mode', 'phase', 'reason_code', 'claimed_status', 'completed_at', 'started_at']) {
      expect(status.required).toContain(f);
    }
  });

  it('roster person state enum and roster_bridge_pending are pinned', () => {
    expect([...ROSTER_PERSON_STATES]).toEqual(schemas.ScoutRosterPersonDto.properties.state.enum);
    expect(schemas.ScoutRosterResult.required).toEqual(
      expect.arrayContaining(['intent_id', 'accounting', 'persons', 'page', 'roster_bridge_pending']),
    );
  });

  it('import/status takes intent_id as its only (query) parameter', () => {
    const params = (fixture.paths['/api/scout/import/status'].get as { parameters: { name: string; in: string }[] }).parameters;
    expect(params.map((p) => [p.name, p.in])).toEqual([['intent_id', 'query']]);
  });
});

describe('decodeRunStatus — fail closed', () => {
  it('decodes a server open run verbatim', () => {
    expect(decodeRunStatus(body(), INTENT)).toEqual({
      intentId: INTENT,
      status: 'running',
      mode: 'server',
      phase: 'transferring',
      reasonCode: null,
      claimedStatus: null,
      completedAt: null,
      startedAt: '2026-09-26T10:00:00.000Z',
    });
  });

  it.each(SERVER_TERMINAL_STATUSES)('keeps server terminal %s', (s) => {
    expect(decodeRunStatus(body({ status: s, phase: null }), INTENT)?.status).toBe(s);
  });

  it.each(LEGACY_TERMINAL_STATUSES)('keeps legacy terminal %s', (s) => {
    expect(decodeRunStatus(body({ status: s, mode: 'legacy', phase: null }), INTENT)?.status).toBe(s);
  });

  it('a server row claiming `success` is not a status the server can emit → unknown', () => {
    expect(decodeRunStatus(body({ status: 'success' }), INTENT)?.status).toBe('unknown');
  });

  it.each(['complete', 'blocked', 'cancelled', 'timed_out'])('a legacy row claiming %s → unknown', (s) => {
    expect(decodeRunStatus(body({ status: s, mode: 'legacy' }), INTENT)?.status).toBe('unknown');
  });

  it.each([['garbled'], [42], [null], [undefined], [{}]])('unrecognised status %p → unknown (never success)', (s) => {
    expect(decodeRunStatus(body({ status: s }), INTENT)?.status).toBe('unknown');
  });

  it.each([['hybrid'], [null], [7]])('unknown mode %p → status unknown', (m) => {
    const r = decodeRunStatus(body({ mode: m, status: 'complete' }), INTENT);
    expect(r?.status).toBe('unknown');
    expect(r?.mode).toBe('unknown');
  });

  it('null phase/reason stay null (not known), unrecognised become explicit unknown', () => {
    expect(decodeRunStatus(body({ phase: null }), INTENT)?.phase).toBeNull();
    expect(decodeRunStatus(body({ phase: 'teleporting' }), INTENT)?.phase).toBe('unknown');
    expect(decodeRunStatus(body({ reason_code: 'new_code' }), INTENT)?.reasonCode).toBe('unknown');
    const absent = body();
    delete absent.reason_code;
    delete absent.phase;
    const r = decodeRunStatus(absent, INTENT);
    expect(r?.reasonCode).toBeNull();
    expect(r?.phase).toBeNull();
  });

  it('whole reading is unknown for a non-object, missing intent, or a different intent', () => {
    expect(decodeRunStatus(null, INTENT)).toBeUndefined();
    expect(decodeRunStatus([], INTENT)).toBeUndefined();
    expect(decodeRunStatus('running', INTENT)).toBeUndefined();
    expect(decodeRunStatus(body({ intent_id: undefined }), INTENT)).toBeUndefined();
    expect(decodeRunStatus(body({ intent_id: 'another-intent' }), INTENT)).toBeUndefined();
  });

  it('times are kept only when they parse', () => {
    expect(decodeIsoTime('2026-09-26T10:00:00.000Z')).toBe('2026-09-26T10:00:00.000Z');
    expect(decodeIsoTime('not a date')).toBeNull();
    expect(decodeIsoTime(0)).toBeNull();
    expect(decodeIsoTime(null)).toBeNull();
  });

  it('isTerminal is false for running and unknown', () => {
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('unknown')).toBe(false);
    expect(isTerminal('failed')).toBe(true);
  });
});

describe('decodeRosterPage — fail closed', () => {
  const page = (over: Record<string, unknown> = {}) => ({
    intent_id: INTENT,
    accounting: { staged: 3, reconstructed: 2, skipped: 1, failed: 0 },
    persons: [
      {
        id: 'p-1',
        state: 'InvitePending',
        source_platform: 'examplesource',
        source_person_id: 'src-1',
        display_name: 'Jordan Ellis',
        created_at: '2026-09-26T10:00:00.000Z',
        updated_at: '2026-09-26T10:00:00.000Z',
      },
    ],
    page: { limit: 50, next_cursor: null, has_more: false },
    roster_bridge_pending: true,
    ...over,
  });

  it('decodes a page keeping only id, display name and state (no provenance)', () => {
    const r = decodeRosterPage(page(), INTENT);
    expect(r).toEqual({
      intentId: INTENT,
      accounting: { staged: 3, reconstructed: 2, skipped: 1, failed: 0, unclassified: null },
      persons: [{ id: 'p-1', displayName: 'Jordan Ellis', state: 'InvitePending' }],
      nextCursor: null,
      hasMore: false,
      rosterBridgePending: true,
    });
    expect(JSON.stringify(r)).not.toMatch(/examplesource|src-1/);
  });

  it('unknown state → unknown member; blank name → null; row without id dropped', () => {
    const r = decodeRosterPage(
      page({ persons: [{ id: 'p-2', state: 'Ghost', display_name: '  ' }, { state: 'InvitePending' }] }),
      INTENT,
    );
    expect(r?.persons).toEqual([{ id: 'p-2', displayName: null, state: 'unknown' }]);
  });

  it('malformed accounting drops the accounting block only (never zeros)', () => {
    const r = decodeRosterPage(page({ accounting: { staged: 3, reconstructed: null, skipped: 1, failed: 0 } }), INTENT);
    expect(r).toBeDefined();
    expect(r?.accounting).toBeUndefined();
  });

  it('S11-E unclassified: zero classified + 5 unclassified decodes verbatim (never folded or zeroed)', () => {
    const r = decodeRosterPage(
      page({ accounting: { staged: 0, reconstructed: 0, skipped: 0, failed: 0, unclassified: 5 } }),
      INTENT,
    );
    expect(r?.accounting).toEqual({ staged: 0, reconstructed: 0, skipped: 0, failed: 0, unclassified: 5 });
  });

  it('unclassified absent (older server) → null, the four counts still decode', () => {
    const r = decodeRosterPage(page(), INTENT);
    expect(r?.accounting?.unclassified).toBeNull();
    expect(r?.accounting?.staged).toBe(3);
  });

  it.each([[-1], [1.5], ['5'], [null], [{}]])('malformed unclassified %p → null only; never 0, never voids the block', (bad) => {
    const r = decodeRosterPage(
      page({ accounting: { staged: 3, reconstructed: 2, skipped: 1, failed: 0, unclassified: bad } }),
      INTENT,
    );
    expect(r?.accounting).toEqual({ staged: 3, reconstructed: 2, skipped: 1, failed: 0, unclassified: null });
  });

  it('extra accounting fields are tolerated and not surfaced', () => {
    const r = decodeRosterPage(
      page({ accounting: { staged: 3, reconstructed: 2, skipped: 1, failed: 0, unclassified: 2, future_bucket: 9 } }),
      INTENT,
    );
    expect(r?.accounting).toEqual({ staged: 3, reconstructed: 2, skipped: 1, failed: 0, unclassified: 2 });
  });

  it('roster_bridge_pending absent / non-boolean → null (not known)', () => {
    expect(decodeRosterPage(page({ roster_bridge_pending: undefined }), INTENT)?.rosterBridgePending).toBeNull();
    expect(decodeRosterPage(page({ roster_bridge_pending: 'yes' }), INTENT)?.rosterBridgePending).toBeNull();
  });

  it('has_more without a cursor never pages', () => {
    const r = decodeRosterPage(page({ page: { limit: 50, next_cursor: null, has_more: true } }), INTENT);
    expect(r?.hasMore).toBe(false);
    const r2 = decodeRosterPage(page({ page: { limit: 50, next_cursor: 'c1', has_more: true } }), INTENT);
    expect(r2?.hasMore).toBe(true);
    expect(r2?.nextCursor).toBe('c1');
  });

  it('structurally invalid or other-intent pages are unknown', () => {
    expect(decodeRosterPage(page({ intent_id: 'other' }), INTENT)).toBeUndefined();
    expect(decodeRosterPage(page({ persons: 'x' }), INTENT)).toBeUndefined();
    expect(decodeRosterPage(page({ page: null }), INTENT)).toBeUndefined();
    expect(decodeRosterPage(undefined, INTENT)).toBeUndefined();
  });
});
