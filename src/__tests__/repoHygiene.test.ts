/**
 * #321 Opus B-321-6: a worktree's `node_modules` symlink was committed once
 * (the ignore entry `node_modules/` matches directories only), which crashed
 * the Vendor-name guard on CI and leaves every clone a dangling link. No
 * tracked path may be a symlink, and `node_modules` must never be tracked.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

describe('repository hygiene (B-321-6)', () => {
  it('tracks no symlinks', () => {
    const symlinks = git(['ls-files', '-s'])
      .split('\n')
      .filter((line) => line.startsWith('120000 '));
    expect(symlinks).toEqual([]);
  });

  it('tracks nothing under node_modules', () => {
    expect(git(['ls-files', '--', 'node_modules']).trim()).toBe('');
  });

  it('ignores node_modules as a file or symlink, not only as a directory', () => {
    const lines = readFileSync(join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    expect(lines).toContain('node_modules');
    expect(git(['check-ignore', '--no-index', '-q', 'node_modules']).trim()).toBe('');
  });
});
