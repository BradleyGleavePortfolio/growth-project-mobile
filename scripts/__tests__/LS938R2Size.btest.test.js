/** @jest-environment node */
const { execFileSync } = require('node:child_process');

it('LS938R2 B4: reviewed unit stays below the R30 1500-code-line automatic-failure boundary', () => {
  const numstat = execFileSync('git', [
    'diff', '--numstat', 'aee6583e7e2c70f306be93813582e88505d2d334...HEAD',
  ], { encoding: 'utf8' });
  const excluded = /(^|\/)(__tests__|__snapshots__|e2e|docs|generated)(\/|$)|\.(test|spec)\.|\.md$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
  const codeLines = numstat.trim().split('\n').reduce((total, line) => {
    const [added, deleted, path] = line.split('\t');
    if (!path || excluded.test(path) || added === '-') return total;
    return total + Number(added) + Number(deleted);
  }, 0);
  expect(codeLines).toBeLessThan(1500);
});
