import path from 'path';
import { spawnSync } from 'child_process';

jest.setTimeout(90_000);
const suite = 'src/components/community/space-chat/__tests__/spaceChatKT2.test.tsx';
const transformer = path.resolve(__dirname, 'LS942R4KT2Transformer.cjs');
const read = 'a read refused with.*mid-visit';
const block = 'a block also ends reply mode';

it.each([
  ['NONE', read, 0],
  ['READ_REPLY', read, 1],
  ['READ_HELD', read, 1],
  ['READ_ACTION', read, 1],
  ['NONE', block, 0],
  ['BLOCK_AUTHOR', block, 1],
] as const)('LS942R4 individual guard %s / %s returns %s', (mutation, title, status) => {
  const result = spawnSync(process.execPath, [
    require.resolve('jest/bin/jest'), suite, '--runInBand', '--no-cache', '--silent',
    '--testNamePattern', title,
    '--transform', JSON.stringify({ '^.+\\.[jt]sx?$': transformer }),
  ], {
    cwd: process.cwd(),
    env: { ...process.env, LS942R4_MUTATION: mutation, LS942_MUTATION: '' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toContain('Tests:');
  expect(result.stderr).not.toContain('Reviewer mutation no longer targets its guard');
  expect(result.status).toBe(status);
});
