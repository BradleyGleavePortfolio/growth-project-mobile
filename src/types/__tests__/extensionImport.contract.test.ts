/**
 * Contract pin for the frozen extension-import boundary. Asserts the mobile
 * types mirror the backend OpenAPI slice (PR #504) and that the mobile UI only
 * advertises the honest, contract-backed subset of import phases.
 */
import {
  SUPPORTED_IMPORT_PHASES,
  decodePairStatus,
  decodeTerminalStatus,
} from '../extensionImport';
import type {
  ImportFlowState,
  PairStatus,
  DecodedPairStatus,
  ImportTerminalStatus,
  DecodedTerminalStatus,
  PairInitRequest,
  PairInitResponse,
  PairStatusRequest,
  PairStatusResponse,
  ImportErrorEnvelope,
} from '../extensionImport';

describe('extensionImport contract', () => {
  it('supported phases are exactly the honest funnel subset (no complete/progress claims)', () => {
    expect([...SUPPORTED_IMPORT_PHASES]).toEqual([
      'intro',
      'customUrlEntry',
      'openingLogin',
      'awaitingExtension',
      'failed',
    ]);
  });

  it('does NOT advertise deferred/uncontracted phases as supported', () => {
    const deferred = ['pairing', 'paired', 'learning', 'importing', 'partial', 'complete', 'cancelled'];
    deferred.forEach((phase) => {
      expect(SUPPORTED_IMPORT_PHASES as readonly string[]).not.toContain(phase);
    });
  });

  it('pair status union mirrors the backend closed enum (pending/paired/expired)', () => {
    const values: PairStatus[] = ['pending', 'paired', 'expired'];
    expect(values).toHaveLength(3);
  });

  it('pair-status wire field is a raw string decoded through decodePairStatus', () => {
    const resp: PairStatusResponse = { status: 'pending' };
    expect(decodePairStatus(resp.status)).toBe('pending');
  });

  it('terminal status union mirrors the backend closed enum (success/partial/failed)', () => {
    const values: ImportTerminalStatus[] = ['success', 'partial', 'failed'];
    expect(values).toHaveLength(3);
  });

  it.each(['pending', 'paired', 'expired'] as const)(
    'decodePairStatus preserves the known lifecycle value: %s',
    (raw) => {
      expect(decodePairStatus(raw)).toBe(raw);
    },
  );

  it.each(['completed', 'PAIRED', 'linked', '', 'pending ', 'unknown', 'null'])(
    'decodePairStatus maps an unknown/future/garbled value to "unknown" (never a lifecycle): %s',
    (raw) => {
      expect(decodePairStatus(raw)).toBe('unknown');
    },
  );

  it.each(['success', 'partial', 'failed'] as const)(
    'decodeTerminalStatus preserves the known terminal value: %s',
    (raw) => {
      expect(decodeTerminalStatus(raw)).toBe(raw);
    },
  );

  it.each(['done', 'complete', 'SUCCESS', 'succeeded', '', 'partial ', 'unknown'])(
    'decodeTerminalStatus maps an unknown/future terminal value to "unknown" (never success/complete): %s',
    (raw) => {
      expect(decodeTerminalStatus(raw)).toBe('unknown');
    },
  );

  it('an unknown status never decodes to a paired/complete/success reading', () => {
    const forbidden = ['paired', 'success'];
    expect(forbidden).not.toContain(decodePairStatus('a-server-value-we-never-shipped'));
    expect(forbidden).not.toContain(decodeTerminalStatus('a-server-value-we-never-shipped'));
  });

  it('decodePairStatus is total and idempotent — the unknown sentinel never re-promotes to a lifecycle member', () => {
    const decoded = new Set<DecodedPairStatus>(['pending', 'paired', 'expired', 'unknown']);
    ['pending', 'paired', 'expired', 'unknown', 'PAIRED', 'completed', '', 'x'].forEach((raw) => {
      const once = decodePairStatus(raw);
      expect(decoded.has(once)).toBe(true);
      // Re-decoding a decoded value must be stable: a second pass never drifts
      // 'unknown' (or any member) into a different lifecycle reading.
      expect(decodePairStatus(once)).toBe(once);
    });
  });

  it('decodeTerminalStatus is total and idempotent across known and unknown inputs', () => {
    const decoded = new Set<DecodedTerminalStatus>(['success', 'partial', 'failed', 'unknown']);
    ['success', 'partial', 'failed', 'unknown', 'SUCCESS', 'done', '', 'z'].forEach((raw) => {
      const once = decodeTerminalStatus(raw);
      expect(decoded.has(once)).toBe(true);
      expect(decodeTerminalStatus(once)).toBe(once);
    });
  });

  it('pair-init response mirrors the server-authoritative expiry contract', () => {
    const r: PairInitResponse = { pairing_code: '142856', expires_at: '2026-07-14T18:35:00.000Z' };
    expect(r.pairing_code).toMatch(/^[0-9]{6}$/);
    expect(Number.isNaN(Date.parse(r.expires_at))).toBe(false);
  });

  it('error envelope mirrors the truthful backend shape', () => {
    const e: ImportErrorEnvelope = {
      statusCode: 410,
      error: 'Gone',
      message: 'Invalid pairing code.',
      path: '/api/extension/pair/redeem',
      timestamp: '2026-07-14T18:35:00.000Z',
      code: 'expired',
    };
    expect(e.statusCode).toBe(410);
    expect(e.code).toBe('expired');
  });

  it('flow state model is a discriminated union keyed on phase', () => {
    const s: ImportFlowState = { phase: 'awaitingExtension', platformId: 'truecoach' };
    expect(s.phase).toBe('awaitingExtension');
  });

  it('pair-init request carries only a lowercase platform slug', () => {
    const req: PairInitRequest = { chosen_platform: 'truecoach' };
    expect(req.chosen_platform).toMatch(/^[a-z0-9_-]+$/);
  });

  it('each supported phase constructs a valid state carrying its own fields', () => {
    const states: ImportFlowState[] = [
      { phase: 'intro' },
      { phase: 'customUrlEntry', url: 'https://x.example.com', valid: true },
      { phase: 'openingLogin', platformId: 'everfit', loginUrl: 'https://x.example.com' },
      { phase: 'awaitingExtension', platformId: 'everfit' },
      { phase: 'failed', message: "We couldn't open that site." },
    ];
    const phases = states.map((s) => s.phase);
    expect(phases).toEqual([...SUPPORTED_IMPORT_PHASES]);
  });

  it('SUPPORTED_IMPORT_PHASES contains no completion/progress-claiming phase', () => {
    const claims = ['complete', 'importing', 'learning', 'partial', 'paired'];
    claims.forEach((c) => expect(SUPPORTED_IMPORT_PHASES as readonly string[]).not.toContain(c));
  });

  it('every supported phase is a real member of the ImportFlowState union', () => {
    const known = new Set([
      'intro', 'customUrlEntry', 'openingLogin', 'awaitingExtension',
      'pairing', 'paired', 'learning', 'importing', 'partial', 'complete', 'failed', 'cancelled',
    ]);
    SUPPORTED_IMPORT_PHASES.forEach((p) => expect(known.has(p)).toBe(true));
  });

  it('error envelope message may be a string array for validation failures', () => {
    const e: ImportErrorEnvelope = {
      statusCode: 400,
      error: 'Bad Request',
      message: ['chosen_platform must be a string', 'chosen_platform should not be empty'],
      path: '/api/extension/pair/init',
      timestamp: '2026-07-14T18:35:00.000Z',
    };
    expect(Array.isArray(e.message)).toBe(true);
    expect(e.code).toBeUndefined();
    expect(e.request_id).toBeUndefined();
  });

  it('pair-status wire accepts any string but decodes each known value back to itself', () => {
    const known: PairStatus[] = ['pending', 'paired', 'expired'];
    known.forEach((status) => {
      const resp: PairStatusResponse = { status };
      expect(decodePairStatus(resp.status)).toBe(status);
    });
  });

  it('terminal status known-value set is exactly success/partial/failed', () => {
    const values: ImportTerminalStatus[] = ['success', 'partial', 'failed'];
    expect(new Set(values).size).toBe(3);
    expect(values).toContain('partial');
  });

  it('error envelope carries an optional domain code + correlation id when present', () => {
    const e: ImportErrorEnvelope = {
      statusCode: 409,
      error: 'Conflict',
      message: 'That pairing code was already used.',
      path: '/api/extension/pair/redeem',
      timestamp: '2026-07-14T18:35:00.000Z',
      code: 'already_used',
      request_id: 'req_abc123',
    };
    expect(e.code).toBe('already_used');
    expect(e.request_id).toBe('req_abc123');
  });

  it('supported phases are frozen at exactly five honest funnel steps', () => {
    expect(SUPPORTED_IMPORT_PHASES).toHaveLength(5);
  });

  it('pair-status request carries the code the client is polling', () => {
    const req: PairStatusRequest = { code: '142856' };
    expect(req.code).toMatch(/^[0-9]{6}$/);
  });

  it('the failed flow state always carries a human-facing message', () => {
    const s: ImportFlowState = { phase: 'failed', message: "We couldn't open that site." };
    expect(s.phase).toBe('failed');
    expect(typeof s.message).toBe('string');
    expect(s.message.length).toBeGreaterThan(0);
  });
});
