/**
 * Contract pin for the frozen extension-import boundary. Asserts the mobile
 * types mirror the backend OpenAPI slice (PR #504) and that the mobile UI only
 * advertises the honest, contract-backed subset of import phases.
 */
import {
  PAIR_INIT_ERROR_CODES,
  READINESS_RUN_STATES,
  SUPPORTED_IMPORT_PHASES,
  UNKNOWN_PAIR_CURRENT,
  decodeImportIntentId,
  decodePairCurrentResponse,
  decodePairInitErrorCode,
  decodePairStatus,
  decodeReadiness,
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
  PairCurrentRequest,
  PairCurrentResponse,
  PairSessionRequest,
  ImportErrorEnvelope,
} from '../extensionImport';
// S7-2′ consumer-frozen pair surface, mechanically projected (see the describe
// block at the bottom of this file for provenance pins).
import fixture from '../__fixtures__/c1PairSurface.a0ea1bea.json';
// S11-C (D-S11-5, UX-03/04) readiness addendum, mechanically projected from the
// LATER backend commit that adds the optional `readiness` block to the SAME
// five pair paths. See the `S11-C readiness` describe block at the bottom of
// this file for provenance pins and
// execution/fa72efb2/mobile-readiness/tooling/extract_s11c_pair_surface_fixture.py.
import s11cFixture from '../__fixtures__/s11cPairSurface.7fdcbc04.json';

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

/**
 * S7-2′ consumer-frozen pair surface (UX-03b). The fixture is a MECHANICAL
 * projection of the backend `docs/contracts/importer-openapi.json` at
 * `2.0.0-c1-s1.1` / a0ea1bea (five pair paths + transitive schema closure; see
 * `$fixture.extraction`). These tests decode fixture-derived examples through
 * the real mobile decoders so that a contract drift on the frozen surface, or
 * a decoder that stops failing closed, breaks here first. No network, no
 * Node crypto: the source hash is pinned as a literal.
 */

type JsonSchema = {
  type?: string;
  enum?: string[];
  format?: string;
  example?: unknown;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  $ref?: string;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  items?: JsonSchema;
};

type PathItem = {
  post: {
    security?: Array<Record<string, unknown[]>>;
    requestBody?: { content: { 'application/json': { schema: JsonSchema } } };
    responses: Record<string, { content?: { 'application/json': { schema: JsonSchema } } }>;
  };
};

const PAIR_SURFACE_PATHS = [
  '/api/extension/pair/init',
  '/api/extension/pair/status',
  '/api/extension/pair/current',
  '/api/extension/pair/session',
  '/api/extension/pair/redeem',
] as const;

const schemas = fixture.components.schemas as unknown as Record<string, JsonSchema>;
const paths = fixture.paths as unknown as Record<string, PathItem>;

function resolve(ref: string): JsonSchema {
  const prefix = '#/components/schemas/';
  expect(ref.startsWith(prefix)).toBe(true);
  const name = ref.slice(prefix.length);
  const s = schemas[name];
  expect(s).toBeDefined();
  return s;
}

function schemaOf(node: JsonSchema): JsonSchema {
  return node.$ref ? resolve(node.$ref) : node;
}

/** Collect every `$ref` string in a JSON tree. */
function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

/**
 * Build a minimal example object from a schema: every REQUIRED property gets
 * its `example`, first enum member, or a type-appropriate placeholder.
 */
function exampleOf(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const p = schema.properties?.[name];
    expect(p).toBeDefined();
    if (p?.example !== undefined) out[name] = p.example;
    else if (p?.enum) out[name] = p.enum[0];
    else if (p?.format === 'uuid') out[name] = `00000000-0000-4000-8000-${name.length.toString().padStart(12, '0')}`;
    else if (p?.type === 'string') out[name] = `${name}-example`;
    else out[name] = null;
  }
  return out;
}

function successSchema(path: string): JsonSchema {
  const responses = paths[path].post.responses;
  const ok = responses['200'] ?? responses['201'];
  expect(ok?.content).toBeDefined();
  return schemaOf(ok!.content!['application/json'].schema);
}

function errorCodeEnum(path: string, status: string): { codes: string[]; required: boolean } {
  const schema = paths[path].post.responses[status]?.content?.['application/json'].schema;
  expect(schema?.allOf).toBeDefined();
  const refs = schema!.allOf!.filter((s) => s.$ref);
  expect(refs.map((s) => s.$ref)).toEqual(['#/components/schemas/ErrorEnvelope']);
  const inline = schema!.allOf!.find((s) => !s.$ref)!;
  return {
    codes: inline.properties?.code?.enum ?? [],
    required: (inline.required ?? []).includes('code'),
  };
}

describe('C1 pair surface — consumer contract (fixture c1PairSurface.a0ea1bea)', () => {
  describe('fixture provenance', () => {
    it('is projected from the parent-recorded contract artifact (sha256 + commit pinned)', () => {
      expect(fixture.$fixture.source.sha256).toBe(
        'bdb022dd6c4fb64cdf291fdde3796b99e4b23004f676b7cb46a58460526ba4e5',
      );
      expect(fixture.$fixture.source.commit).toBe('a0ea1bea92ba830d5ffb712a3dcb26e7be0a0992');
      expect(fixture.$fixture.source.artifact).toBe('docs/contracts/importer-openapi.json');
      expect(fixture.info.version).toBe('2.0.0-c1-s1.1');
      expect(fixture.openapi).toBe('3.1.0');
    });

    it('carries exactly the five frozen pair paths, all POST-only', () => {
      expect(Object.keys(paths).sort()).toEqual([...PAIR_SURFACE_PATHS].sort());
      expect(fixture.$fixture.extraction.paths).toEqual([...PAIR_SURFACE_PATHS]);
      for (const p of PAIR_SURFACE_PATHS) expect(Object.keys(paths[p])).toEqual(['post']);
    });

    it('is self-contained: every $ref resolves inside the fixture', () => {
      const refs = collectRefs(fixture);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(() => resolve(ref)).not.toThrow();
      expect(Object.keys(schemas).sort()).toEqual([...fixture.$fixture.extraction.schemas].sort());
    });

    it('declares only the bearer security scheme', () => {
      expect(Object.keys(fixture.components.securitySchemes)).toEqual(['bearer']);
    });
  });

  describe('authority split: coach routes are bearer-guarded, redeem is extension-only', () => {
    it.each(['/api/extension/pair/init', '/api/extension/pair/status', '/api/extension/pair/current', '/api/extension/pair/session'])(
      '%s requires bearer',
      (p) => {
        expect(paths[p].post.security).toEqual([{ bearer: [] }]);
      },
    );

    it('pair/redeem is unauthenticated and returns coach-bound tokens — mobile must never call it', () => {
      expect(paths['/api/extension/pair/redeem'].post.security).toBeUndefined();
      const result = successSchema('/api/extension/pair/redeem');
      expect(result.required).toEqual(expect.arrayContaining(['access_token', 'refresh_token']));
    });

    it('no coach-callable success payload carries a token', () => {
      for (const p of ['/api/extension/pair/init', '/api/extension/pair/status', '/api/extension/pair/current', '/api/extension/pair/session']) {
        const props = Object.keys(successSchema(p).properties ?? {});
        expect(props).not.toContain('access_token');
        expect(props).not.toContain('refresh_token');
      }
    });
  });

  describe('pair/init', () => {
    it('request: chosen_platform required, setup_nonce an OPTIONAL uuid (mobile sends it in the body)', () => {
      const dto = schemaOf(paths['/api/extension/pair/init'].post.requestBody!.content['application/json'].schema);
      expect(dto.required).toEqual(['chosen_platform']);
      expect(dto.properties?.setup_nonce).toMatchObject({ type: 'string', format: 'uuid' });
      const req: PairInitRequest = { chosen_platform: 'truecoach', setup_nonce: '7f1e2d3c-4b5a-4968-8776-655443322110' };
      expect(Object.keys(req).sort()).toEqual(Object.keys(dto.properties ?? {}).sort());
    });

    it('201: pairing_code + expires_at required, import_intent_id optional (legacy rows omit it)', () => {
      const result = successSchema('/api/extension/pair/init');
      expect(result.required).toEqual(['pairing_code', 'expires_at']);
      expect(result.properties?.import_intent_id).toMatchObject({ type: 'string', format: 'uuid' });
      const example = exampleOf(result) as unknown as PairInitResponse;
      expect(example.pairing_code).toMatch(/^[0-9]{6}$/);
      expect(decodeImportIntentId(example.import_intent_id)).toBeNull();
      expect(decodeImportIntentId('11111111-2222-4333-8444-555555555555')).toBe('11111111-2222-4333-8444-555555555555');
    });

    it('409 setup_nonce_conflict and 410 setup_challenge_unavailable are REQUIRED codes the mobile decoder names', () => {
      const conflict = errorCodeEnum('/api/extension/pair/init', '409');
      const gone = errorCodeEnum('/api/extension/pair/init', '410');
      expect(conflict).toEqual({ codes: ['setup_nonce_conflict'], required: true });
      expect(gone).toEqual({ codes: ['setup_challenge_unavailable'], required: true });
      expect(decodePairInitErrorCode(conflict.codes[0])).toBe('setup_nonce_conflict');
      expect(decodePairInitErrorCode(gone.codes[0])).toBe('setup_challenge_unavailable');
    });

    it('400 code_mint_failed is an OPTIONAL code (ValidationPipe 400s carry none)', () => {
      const bad = errorCodeEnum('/api/extension/pair/init', '400');
      expect(bad).toEqual({ codes: ['code_mint_failed'], required: false });
      expect(decodePairInitErrorCode('code_mint_failed')).toBe('code_mint_failed');
    });

    it('the mobile error-code set is exactly the codes the contract pins on pair/init', () => {
      const pinned = ['400', '409', '410']
        .flatMap((s) => errorCodeEnum('/api/extension/pair/init', s).codes)
        .sort();
      expect([...PAIR_INIT_ERROR_CODES].sort()).toEqual(pinned);
    });

    it.each([undefined, null, '', 'SETUP_NONCE_CONFLICT', 'expired', 'already_used', 42, {}])(
      'decodePairInitErrorCode fails closed to unknown for %p',
      (raw) => {
        expect(decodePairInitErrorCode(raw)).toBe('unknown');
      },
    );
  });

  describe('pair/status', () => {
    it('request is body-only code; result status is the closed enum with import_intent_id optional', () => {
      const dto = schemaOf(paths['/api/extension/pair/status'].post.requestBody!.content['application/json'].schema);
      expect(dto.required).toEqual(['code']);
      const result = successSchema('/api/extension/pair/status');
      expect(result.required).toEqual(['status']);
      expect(result.properties?.status.enum).toEqual(['pending', 'paired', 'expired']);
      expect(result.properties?.import_intent_id?.format).toBe('uuid');
    });

    it('every enum member decodes to itself; a non-member fails closed', () => {
      const members = successSchema('/api/extension/pair/status').properties!.status.enum!;
      for (const m of members) expect(decodePairStatus(m)).toBe(m);
      expect(decodePairStatus('bound')).toBe('unknown');
    });
  });

  describe('pair/current + pair/session (owned-setup readers)', () => {
    it('current takes an optional uuid setup_nonce; session takes a required import_intent_id', () => {
      const cur = schemaOf(paths['/api/extension/pair/current'].post.requestBody!.content['application/json'].schema);
      expect(cur.required).toBeUndefined();
      expect(cur.properties?.setup_nonce).toMatchObject({ type: 'string', format: 'uuid' });
      const ses = schemaOf(paths['/api/extension/pair/session'].post.requestBody!.content['application/json'].schema);
      expect(ses.required).toEqual(['import_intent_id']);
      const a: PairCurrentRequest = {};
      const b: PairCurrentRequest = { setup_nonce: '7f1e2d3c-4b5a-4968-8776-655443322110' };
      const c: PairSessionRequest = { import_intent_id: '11111111-2222-4333-8444-555555555555' };
      expect([a, b, c]).toHaveLength(3);
    });

    it('both return the same PairSessionResult (all three fields required, status closed enum)', () => {
      const cur = paths['/api/extension/pair/current'].post.responses['200'].content!['application/json'].schema;
      const ses = paths['/api/extension/pair/session'].post.responses['200'].content!['application/json'].schema;
      expect(cur.$ref).toBe('#/components/schemas/PairSessionResult');
      expect(ses.$ref).toBe(cur.$ref);
      const result = resolve(cur.$ref!);
      expect([...(result.required ?? [])].sort()).toEqual(['chosen_platform', 'import_intent_id', 'status']);
      expect(result.properties?.status.enum).toEqual(['pending', 'paired', 'expired']);
      expect(Object.keys(result.properties ?? {})).not.toContain('pairing_code');
    });

    it('decodePairCurrentResponse decodes a schema-derived example for every enum member', () => {
      const result = successSchema('/api/extension/pair/current');
      for (const status of result.properties!.status.enum!) {
        const example = { ...exampleOf(result), status } as unknown as PairCurrentResponse;
        const decoded = decodePairCurrentResponse(example);
        expect(decoded.status).toBe(status);
        expect(decoded.importIntentId).toBe(example.import_intent_id);
        expect(decoded.chosenPlatform).toBe(example.chosen_platform);
      }
    });

    it('an unrecognised status decodes to unknown while keeping the correlation fields', () => {
      const example: Record<string, unknown> = { ...exampleOf(successSchema('/api/extension/pair/current')), status: 'bound' };
      const decoded = decodePairCurrentResponse(example);
      expect(decoded.status).toBe('unknown');
      expect(decoded.importIntentId).toBe(example.import_intent_id);
    });

    it.each<[string, unknown]>([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'paired'],
      ['an array', [{ status: 'paired' }]],
      ['an empty object', {}],
      ['a missing import_intent_id', { status: 'paired', chosen_platform: 'truecoach' }],
      ['an empty import_intent_id', { import_intent_id: '', status: 'paired', chosen_platform: 'truecoach' }],
      ['a missing chosen_platform', { import_intent_id: 'ii-1', status: 'paired' }],
      ['a missing status', { import_intent_id: 'ii-1', chosen_platform: 'truecoach' }],
      ['a non-string status', { import_intent_id: 'ii-1', status: 1, chosen_platform: 'truecoach' }],
    ])('fails closed to UNKNOWN_PAIR_CURRENT for %s (never paired)', (_label, raw) => {
      const decoded = decodePairCurrentResponse(raw);
      expect(decoded).toEqual(UNKNOWN_PAIR_CURRENT);
      expect(decoded.status).not.toBe('paired');
    });

    it('UNKNOWN_PAIR_CURRENT is frozen and codeless', () => {
      expect(Object.isFrozen(UNKNOWN_PAIR_CURRENT)).toBe(true);
      expect(UNKNOWN_PAIR_CURRENT).toEqual({ status: 'unknown', importIntentId: null, chosenPlatform: null });
    });
  });

  describe('import_intent_id decoding', () => {
    it.each<[unknown]>([[undefined], [null], [''], [42], [{}], [[]]])('drops %p to null', (raw) => {
      expect(decodeImportIntentId(raw)).toBeNull();
    });

    it('returns the server string verbatim, never coerced', () => {
      expect(decodeImportIntentId('ii-0001')).toBe('ii-0001');
    });
  });
});

/**
 * S11-C (D-S11-5, UX-03/04) readiness addendum — consumer contract for the
 * `readiness` block backend PR #560 added to `PairSessionResult` at head
 * `7fdcbc044dba1747d0db2f2750ced951f3b6b752`. Mechanically projected the same
 * way as the C1 fixture above (see `s11cFixture.$fixture.extraction`), over
 * the SAME five pair paths, from a LATER commit than the frozen C1 surface.
 * Decodes fixture-derived examples through decodeReadiness /
 * decodePairCurrentResponse so a contract drift on this later slice, or a
 * decoder that stops failing closed, breaks here first.
 */
describe('S11-C readiness — consumer contract (fixture s11cPairSurface.7fdcbc04)', () => {
  const s11cSchemas = s11cFixture.components.schemas as unknown as Record<string, JsonSchema>;
  const s11cPaths = s11cFixture.paths as unknown as Record<string, PathItem>;

  function s11cResolve(ref: string): JsonSchema {
    const prefix = '#/components/schemas/';
    expect(ref.startsWith(prefix)).toBe(true);
    const name = ref.slice(prefix.length);
    const s = s11cSchemas[name];
    expect(s).toBeDefined();
    return s;
  }

  describe('fixture provenance', () => {
    it('is projected from the S11-C backend commit (sha256 + commit pinned), same five pair paths as C1', () => {
      expect(s11cFixture.$fixture.source.commit).toBe('7fdcbc044dba1747d0db2f2750ced951f3b6b752');
      expect(s11cFixture.$fixture.source.artifact).toBe('docs/contracts/importer-openapi.json');
      expect(s11cFixture.openapi).toBe('3.1.0');
      expect(Object.keys(s11cPaths).sort()).toEqual([...PAIR_SURFACE_PATHS].sort());
    });

    it('adds exactly one new schema (PairReadiness) to the C1 closure', () => {
      const c1Names = new Set(fixture.$fixture.extraction.schemas as string[]);
      const s11cNames = s11cFixture.$fixture.extraction.schemas as string[];
      const added = s11cNames.filter((n) => !c1Names.has(n));
      expect(added).toEqual(['PairReadiness']);
    });
  });

  describe('PairSessionResult.readiness', () => {
    it('is OPTIONAL on PairSessionResult — absence is a valid, honest reading (not known)', () => {
      const result = s11cResolve('#/components/schemas/PairSessionResult');
      expect(result.required).toEqual(['import_intent_id', 'status', 'chosen_platform']);
      expect(result.properties?.readiness).toBeDefined();
      expect((result.required ?? []).includes('readiness')).toBe(false);
    });

    it('PairReadiness requires run, source_declared and declared_platforms (declared_platforms nullable)', () => {
      const readiness = s11cResolve('#/components/schemas/PairReadiness');
      expect([...(readiness.required ?? [])].sort()).toEqual(
        ['declared_platforms', 'run', 'source_declared'].sort(),
      );
      expect(readiness.properties?.run.enum).toEqual(['none', 'open', 'terminal']);
      expect(readiness.properties?.declared_platforms).toMatchObject({ nullable: true, type: 'number' });
    });

    it('the mobile ReadinessRunState union mirrors the closed backend enum exactly', () => {
      const readiness = s11cResolve('#/components/schemas/PairReadiness');
      expect([...READINESS_RUN_STATES].sort()).toEqual([...readiness.properties!.run.enum!].sort());
    });
  });

  describe('decodeReadiness — strict parse, fails closed to undefined (never false/0/a fabricated member)', () => {
    it.each(['none', 'open', 'terminal'] as const)(
      'decodes a well-formed block for run=%s',
      (run) => {
        const declared = run === 'none' ? null : 2;
        const decoded = decodeReadiness({ run, source_declared: run !== 'none', declared_platforms: declared });
        expect(decoded).toEqual({ run, sourceDeclared: run !== 'none', declaredPlatforms: declared });
      },
    );

    it.each<[string, unknown]>([
      ['undefined (absent block)', undefined],
      ['null', null],
      ['a string', 'none'],
      ['an array', []],
      ['an unrecognised run value', { run: 'live', source_declared: true, declared_platforms: 1 }],
      ['a missing run', { source_declared: true, declared_platforms: 1 }],
      ['a non-string run', { run: 1, source_declared: true, declared_platforms: 1 }],
      ['a non-boolean source_declared', { run: 'open', source_declared: 'yes', declared_platforms: 1 }],
      ['a missing source_declared', { run: 'open', declared_platforms: 1 }],
      ['a non-numeric non-null declared_platforms', { run: 'open', source_declared: true, declared_platforms: '2' }],
      ['a NaN declared_platforms', { run: 'open', source_declared: true, declared_platforms: NaN }],
      ['a missing declared_platforms', { run: 'open', source_declared: true }],
    ])('fails closed to undefined for %s (never a lifecycle reading)', (_label, raw) => {
      expect(decodeReadiness(raw)).toBeUndefined();
    });

    it('never decodes to a truthy-but-wrong shape — the return is exactly undefined or a DecodedReadiness', () => {
      const decoded = decodeReadiness('garbage');
      expect(decoded).toBeUndefined();
      expect(decoded).not.toBe(false);
      expect(decoded).not.toBe(0);
    });
  });

  describe('decodePairCurrentResponse folds a valid readiness block in and fails closed on a malformed one', () => {
    const base = { import_intent_id: 'ii-1', status: 'paired', chosen_platform: 'truecoach' };

    it('absent readiness — decoded reading has no readiness key at all (not known, never false/zero)', () => {
      const decoded = decodePairCurrentResponse(base);
      expect(decoded.status).toBe('paired');
      expect('readiness' in decoded).toBe(false);
    });

    it('present + well-formed readiness is folded into the decoded reading verbatim (field renamed to camelCase)', () => {
      const decoded = decodePairCurrentResponse({
        ...base,
        readiness: { run: 'open', source_declared: true, declared_platforms: 3 },
      });
      expect(decoded.readiness).toEqual({ run: 'open', sourceDeclared: true, declaredPlatforms: 3 });
    });

    it('malformed readiness never discards an otherwise-valid setup reading — it just omits readiness', () => {
      const decoded = decodePairCurrentResponse({ ...base, readiness: { run: 'somewhere-else' } });
      expect(decoded.status).toBe('paired');
      expect(decoded.importIntentId).toBe('ii-1');
      expect('readiness' in decoded).toBe(false);
    });

    it('a readiness block attached to an otherwise-invalid payload never survives — the whole reading fails closed', () => {
      const decoded = decodePairCurrentResponse({
        status: 'paired',
        readiness: { run: 'open', source_declared: true, declared_platforms: 3 },
        // import_intent_id and chosen_platform missing — contract requires both.
      });
      expect(decoded).toEqual(UNKNOWN_PAIR_CURRENT);
      expect('readiness' in decoded).toBe(false);
    });

    it('run="none" with declared_platforms=null decodes and renders as a genuinely known "none" reading', () => {
      const decoded = decodePairCurrentResponse({
        ...base,
        readiness: { run: 'none', source_declared: false, declared_platforms: null },
      });
      expect(decoded.readiness).toEqual({ run: 'none', sourceDeclared: false, declaredPlatforms: null });
    });

    it('decodes an example built from every enum member of the S11-C fixture schema', () => {
      const readinessSchema = s11cResolve('#/components/schemas/PairReadiness');
      for (const run of readinessSchema.properties!.run.enum!) {
        const declared = run === 'none' ? null : 1;
        const decoded = decodePairCurrentResponse({
          ...base,
          readiness: { run, source_declared: run !== 'none', declared_platforms: declared },
        });
        expect(decoded.readiness?.run).toBe(run);
      }
    });
  });
});
