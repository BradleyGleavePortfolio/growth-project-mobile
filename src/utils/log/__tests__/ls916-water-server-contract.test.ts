import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import ts from 'typescript';
import api, { waterApi } from '../../../services/api';
import { forgetSaveKeys, withSaveKey } from '../saveKey';

// Exact backend1198 source snapshots, not a proposed server implementation:
// https://github.com/BradleyGleavePortfolio/growth-project-backend/blob/be847235baf62aadd502c7333dea70be20f7f039/src/water/water.controller.ts
// https://github.com/BradleyGleavePortfolio/growth-project-backend/blob/be847235baf62aadd502c7333dea70be20f7f039/src/water/water.service.ts
// Only Nest decorators/DI and the database are replaced. Both actual handler
// methods execute unchanged; the request includes the phone's real header.
function serverClass(file: string, name: string, imports: Record<string, unknown> = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/ls916', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  });
  const out: Record<string, unknown> = {};
  const decorators = new Proxy({}, { get: () => () => () => undefined });
  vm.runInNewContext(compiled.outputText, {
    exports: out, Date,
    require: (id: string) => imports[id] ?? decorators,
  });
  return out[name] as new (...args: any[]) => any;
}

afterEach(() => jest.restoreAllMocks());

it('LS-916 B4: retrying one water add with its same key produces only one server row on companion1198', async () => {
  forgetSaveKeys();
  const rows: Array<Record<string, unknown>> = [];
  const WaterService = serverClass('water.service.ts.txt', 'WaterService');
  const service = new WaterService({
    waterLog: { create: jest.fn(async ({ data }) => {
      const row = { ...data, id: `water-${rows.length + 1}` };
      rows.push(row);
      return row;
    }) },
  });
  const WaterController = serverClass('water.controller.ts.txt', 'WaterController', {
    './water.service': { WaterService },
  });
  const controller = new WaterController(service);
  const headers: string[] = [];
  let loseFirstReply = true;
  jest.spyOn(api, 'post').mockImplementation(async (_url, data, config) => {
    const key = config?.headers?.['Idempotency-Key'] as string;
    headers.push(key);
    const saved = await controller.logWater({
      user: { id: 'viewer' }, headers: { 'idempotency-key': key },
    }, data);
    if (loseFirstReply) {
      loseFirstReply = false;
      throw new Error('Connection lost after server commit');
    }
    return { data: saved } as never;
  });
  const add = () => withSaveKey(['water', '2026-10-30', 237],
    (key) => waterApi.log({ amount_ml: 237, date: '2026-10-30' }, key));
  await expect(add()).rejects.toThrow('after server commit');
  await add();
  expect(headers).toHaveLength(2);
  expect(headers[0]).toMatch(/^pfl_[\da-f-]{36}$/i);
  expect(headers[1]).toBe(headers[0]); // Phone transport is correct.
  expect(rows).toHaveLength(1); // The companion route must actually honor it.
});
