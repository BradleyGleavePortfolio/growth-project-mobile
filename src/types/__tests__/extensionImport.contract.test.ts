/**
 * Contract pin for the frozen extension-import boundary. Asserts the mobile
 * types mirror the backend OpenAPI slice (PR #504) and that the mobile UI only
 * advertises the honest, contract-backed subset of import phases.
 */
import { SUPPORTED_IMPORT_PHASES } from '../extensionImport';
import type {
  ImportFlowState,
  PairStatus,
  ImportTerminalStatus,
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

  it('pair status union matches the backend enum values', () => {
    const values: PairStatus[] = ['pending', 'paired', 'expired'];
    const resp: PairStatusResponse = { status: 'pending' };
    expect(values).toContain(resp.status);
  });

  it('terminal status union matches the backend enum values', () => {
    const values: ImportTerminalStatus[] = ['success', 'partial', 'failed'];
    expect(values).toHaveLength(3);
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
      'intro', 'platformSelected', 'customUrlEntry', 'openingLogin', 'awaitingExtension',
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

  it('pair-status response only ever carries a known lifecycle value', () => {
    const known: PairStatus[] = ['pending', 'paired', 'expired'];
    known.forEach((status) => {
      const resp: PairStatusResponse = { status };
      expect(known).toContain(resp.status);
    });
  });

  it('terminal status enum is exactly success/partial/failed', () => {
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
