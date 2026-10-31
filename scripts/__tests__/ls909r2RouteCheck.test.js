/** CI-only reviewer probe on the scratch merge; never merge this file. */
const path = require('path');
const { execFileSync } = require('child_process');

test('LS-909R2 actual route-contract checker at head merged with main exits zero', () => {
  const root = path.resolve(__dirname, '../..');
  const output = execFileSync(process.execPath, ['scripts/route-contract/check.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(output).toMatch(/Route contract: \d+ callers, 0 missing,/);
}, 130000);
