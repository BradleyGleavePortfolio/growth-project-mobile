import path from 'path';
import { spawnSync } from 'child_process';
import fs from 'fs';

jest.setTimeout(90_000);
const suite = 'src/components/community/space-chat/__tests__/spaceChatKT2.test.tsx';
const transformer = path.resolve(__dirname, 'LS942KT2Transformer.cjs');
const title = 'a read refused with 403';
function proofWithMutation(mutation: string) {
  return spawnSync(process.execPath, [
    require.resolve('jest/bin/jest'), suite, '--runInBand', '--no-cache', '--silent',
    '--testNamePattern', title,
    '--transform', JSON.stringify({ '^.+\\.[jt]sx?$': transformer }),
  ], {
    cwd: process.cwd(), env: { ...process.env, LS942_MUTATION: mutation },
    encoding: 'utf8', timeout: 60_000,
  });
}

it('LS942 control: the registered read proof catches removal of the no-access status flag', () => {
  const result = proofWithMutation('READ_FLAG');
  expect(result.error).toBeUndefined();
  expect(result.stderr).toContain('Expected: true');
  expect(result.status).toBe(1);
});

it('LS942 B2: the registered read proof must catch removal of the cached read, sheet and reply no-access guards', () => {
  // Verify the representative mutations still target the current guard sites.
  const source = fs.readFileSync(path.resolve(__dirname, '../useSpaceChat.ts'), 'utf8');
  expect(source).toContain('return (t: SpaceReplyTarget) => noAccess ||');
  expect(source).toContain('heldId && !noAccess ? messages.find');
  expect(source).toContain('(noAccess ? undefined : messages.find');
  const result = proofWithMutation('READ_CACHE');
  expect(result.error).toBeUndefined();
  expect(result.stderr).toContain('Tests:');
  // A surviving security mutation means the registered title is not evidence
  // for its claimed cached-content, open-sheet and reply-mode protection.
  expect(result.status).toBe(1);
});
