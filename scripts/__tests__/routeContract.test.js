/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mobileRoutes } = require('../route-contract/mobile');
const { backendRoutes } = require('../route-contract/backend');
const { compare, matches } = require('../route-contract/check');
const { normalize } = require('../route-contract/source');
const sha = 'a'.repeat(40);
const snapshot = (...routes) => `# backend-main ${sha}\n${routes.join('\n')}\n`;
const pr = 'https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/868';
let root;
function fixture(name, contents) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
function phone(contents) {
  fixture('services/api.ts', 'export default {}');
  fixture('api/caller.ts', `import api from '../services/api';\n${contents}`);
  return mobileRoutes(root);
}
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-contract-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('literal, generic, multiline, query and full segment parameters', () => {
  const routes = phone(`
    api.get<Result>(
      '/coach/clients?limit=10'
    );
    api.post(\`/coach/clients/\${encodeURIComponent(clientId)}/messages\`, {});
  `);
  expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
    'GET /api/coach/clients', 'POST /api/coach/clients/:id/messages',
  ]);
});
test('resolves local helpers, constants, concatenation and conditional route branches', () => {
  const routes = phone(`
    const BASE = '/messages';
    const thread = (scope: string) => scope === 'coach' ? '/coach/messages' : BASE;
    api.patch(thread(scope) + '/' + id, {});
  `);
  expect(routes.map((r) => r.path)).toEqual(['/api/coach/messages/:id', '/api/messages/:id']);
});
test('resolves imported helpers and imported literal union types', () => {
  fixture('api/helper.ts', "export const base = (id: string) => `/things/${id}`; export type Kind = 'pdf' | 'video';");
  const routes = phone(`
    import { base, Kind } from './helper';
    function upload(kind: Kind) { api.post(\`/media/\${kind}/upload-url\`, {}); }
    api.get(base(id));
  `);
  expect(routes.map((r) => r.path)).toEqual(['/api/things/:id', '/api/media/pdf/upload-url', '/api/media/video/upload-url']);
});
test('same-directory imports, aliases and request config are included', () => {
  fixture('services/api.ts', 'export default {}');
  fixture('services/caller.ts', "import renamed from './api'; const alias = renamed; alias.request({method:'PATCH',url:'/things'});");
  expect(mobileRoutes(root)).toEqual([expect.objectContaining({ method: 'PATCH', path: '/api/things' })]);
});
test('direct backend fetch is included; unclassified fetch fails closed', () => {
  expect(phone("fetch(`${env.API_URL}/invites/accept/${token}`, {method:'POST'});")[0].path).toBe('/api/invites/accept/:id');
  fixture('api/caller.ts', 'fetch(arbitraryUrl);');
  expect(() => mobileRoutes(root)).toThrow('not statically classified');
});
test('unknown URL and partial dynamic segments fail closed', () => {
  expect(() => phone('api.get(arbitraryUrl);')).toThrow('Unresolved URL');
  expect(() => phone('api.get(`/thing/prefix-${id}`);')).toThrow('partial path segment');
});
test.each(['api[method]("/things");', 'const {get} = api; get("/things");', 'const get = api.get; get("/things");'])(
  'unsupported client indirection cannot silently disappear: %s', (code) => {
    expect(() => phone(code)).toThrow(/extraction support/);
  },
);
test('test fixtures and comments are not callers', () => {
  fixture('__tests__/caller.test.ts', 'api.get("/not-a-caller");');
  expect(phone('// api.get("/comment");')).toEqual([]);
});
test('strict direction: missing caller, wrong verb and missing static segment fail', () => {
  const calls = phone("api.get('/things/new');");
  expect(compare(calls, snapshot('GET /api/things/:id'), '').missing).toEqual([]);
  expect(compare(calls, snapshot('POST /api/things/:id'), '').missing).toHaveLength(1);
  expect(compare(calls, snapshot('GET /api/things'), '').missing).toHaveLength(1);
  expect(matches({ method: 'GET', path: '/api/things/:id' }, 'GET /api/things/static')).toBe(false);
});
test('missing route cannot be hidden by a server-only route', () => {
  const calls = phone("api.post('/not-registered', {});");
  expect(compare(calls, snapshot('POST /api/exists'), '').missing).toHaveLength(1);
});
test('exact allowlist requires a removal PR and becomes an error when stale', () => {
  const calls = phone("api.get('/known-gap');");
  const entry = `GET\t/api/known-gap\tapi/caller.ts\t${pr}\texisting mismatch removed by the linked PR`;
  expect(compare(calls, snapshot('GET /api/other'), entry).missing).toEqual([]);
  expect(compare(calls, snapshot('GET /api/known-gap'), entry).stale).toHaveLength(1);
  expect(() => compare(calls, snapshot('GET /api/other'), entry.replace(pr, 'TODO'))).toThrow('Invalid allowlist');
});
test('snapshot requires reproducible main head metadata', () => {
  expect(() => compare([], 'GET /api/things\n', '')).toThrow('backend main head');
});
test('parameter normalization retains api/v1 and ignores only query/fragment', () => {
  expect(normalize('/api/v1/things/:thingId/?limit=2#top')).toBe('/api/v1/things/:id');
});
function backend(main) {
  fixture('src/main.ts', main);
  fixture('src/app.module.ts', `
    import { Module } from '@nestjs/common';
    import { FeatureModule } from './feature.module';
    @Module({ imports: [FeatureModule] }) export class AppModule {}
  `);
  fixture('src/feature.module.ts', `
    import { Module } from '@nestjs/common';
    import { ThingsController } from './things.controller';
    @Module({ controllers: [ThingsController] }) export class FeatureModule {}
  `);
  fixture('src/things.controller.ts', `
    import { Controller, Get, Post } from '@nestjs/common';
    @Controller(['things', 'v1/things']) export class ThingsController {
      @Get() list() {}
      @Post(':thingId') write() {}
    }
  `);
  return backendRoutes(root);
}
test('Nest global prefix, controller arrays, empty method paths and parameters', () => {
  expect(backend("app.setGlobalPrefix('api');")).toEqual([
    'GET /api/things', 'GET /api/v1/things', 'POST /api/things/:id', 'POST /api/v1/things/:id',
  ]);
});
test('method-specific global prefix exclusions and dormant controllers', () => {
  backend("app.setGlobalPrefix('api', {exclude:[{path:'things',method:RequestMethod.GET}]});");
  fixture('src/dormant.controller.ts', "@Controller('dormant') export class Dormant { @Get() get() {} }");
  expect(backendRoutes(root)).toEqual([
    'GET /api/v1/things', 'GET /things', 'POST /api/things/:id', 'POST /api/v1/things/:id',
  ]);
});
test('unsupported backend router/version changes fail closed', () => {
  expect(() => backend("app.enableVersioning({type:VersioningType.URI});")).toThrow('Versioned routes');
});
