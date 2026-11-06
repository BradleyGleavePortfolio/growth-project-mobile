import path from 'path';
import { spawnSync } from 'child_process';

jest.setTimeout(90_000);
const root = 'src/components/community/space-chat/__tests__/';
const transform = path.resolve(__dirname, 'LS943R4KT2Transformer.cjs');
const cases = [
  ['ROW_MENU', 'spaceChatRowsKT2.test.tsx', 'a row the coach removed', 'toBeNull'],
  ['ROW_BODY', 'spaceChatRowsKT2.test.tsx', 'a row the coach removed', 'toBeNull'],
  ['VOICE_CACHE', 'LS943VoiceRefusal.btest.test.tsx', 'LS943 B1', 'toHaveBeenCalledTimes'],
  ['VOICE_403', 'LS943VoiceRefusal.btest.test.tsx', 'LS943 B1', 'toHaveBeenCalledTimes'],
  ['VOICE_404', 'LS943VoiceRefusal.btest.test.tsx', 'LS943 B1', 'toHaveBeenCalledTimes'],
  ['VOICE_MARK', 'spaceChatRowsKT2.test.tsx', 'a voice note whose lookup is refused', 'toBeNull'],
  ['VOICE_URL', 'spaceChatRowsKT2.test.tsx', 'a voice note whose lookup is refused', 'Expected: true'],
] as const;

it.each(cases)('LS943R4: removing only %s makes its registered proof red', (mutation, suite, title, failure) => {
  const result = spawnSync(process.execPath, [
    require.resolve('jest/bin/jest'), `${root}${suite}`, '--runInBand', '--no-cache', '--forceExit', '--silent',
    '--testNamePattern', title, '--transform', JSON.stringify({ '^.+\\.[jt]sx?$': transform }),
  ], {
    cwd: process.cwd(), env: { ...process.env, LS943R4_MUTATION: mutation },
    encoding: 'utf8', timeout: 60_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).not.toContain('Guard drift:');
  expect(result.stderr).not.toContain('Test suite failed to run');
  expect(result.stderr).toContain('FAIL ');
  expect(result.stderr).toContain(failure);
  expect(result.status).toBe(1);
});
