/**
 * Dependency floors (DEPS-AUDIT, 203-D42 op 1).
 *
 * A security pin on a package the app does not depend on directly lives in
 * package.json's "overrides" block, and npm ci installs whatever the lockfile
 * records. Either half can drift on its own: a lockfile regenerated without
 * the override, an override edited without the lockfile, or a second pin
 * slipped in beside the first. This suite holds both halves against one
 * table, so each floor is checked in the manifest and in every installed copy
 * the lockfile records.
 *
 * One row per pinned package: its name, the floor (the exact version the
 * override names) and the advisories that floor closes. Add a row only with
 * the override that goes with it.
 *
 * Versions are compared numerically, part by part. A string compare would put
 * 1.9.0 above 1.11.0 and pass a copy that must fail (case D5 holds that).
 */
import * as fs from 'fs';
import * as path from 'path';

type FloorRow = { name: string; floor: string; advisories: string[] };

const FLOORS: FloorRow[] = [
  {
    name: 'shell-quote',
    floor: '1.11.0',
    advisories: ['GHSA-pqg4-j6r4-53mv', 'GHSA-395f-4hp3-45gv'],
  },
];

type LockEntry = { version?: string; resolved?: string; integrity?: string };

const ROOT = path.resolve(__dirname, '..', '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  overrides?: Record<string, unknown>;
};
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockEntry>;
};

/** -1, 0 or 1: a against b, numeric part by part ("1.10.0" > "1.9.0"). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Every installed copy of `name` the lockfile records, nested ones included. */
function lockCopies(name: string): Array<[string, LockEntry]> {
  return Object.entries(lock.packages).filter(
    ([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`),
  );
}

describe('dependency floors (package.json overrides and every lockfile copy)', () => {
  test.each(FLOORS)('D1: overrides pins $name at exactly $floor', ({ name, floor }) => {
    expect(manifest.overrides?.[name]).toBe(floor);
  });

  test.each(FLOORS)('D2: every lockfile copy of $name is at or above $floor', ({ name, floor }) => {
    const copies = lockCopies(name);
    expect(copies.length).toBeGreaterThan(0);
    const below = copies
      .filter(([, entry]) => !/^\d+\.\d+\.\d+$/.test(String(entry.version)) || compareVersions(String(entry.version), floor) < 0)
      .map(([key, entry]) => `${key}@${entry.version}`);
    expect(below).toEqual([]);
  });

  test.each(FLOORS)('D3: every lockfile copy of $name resolves to its own registry tarball with a sha512 integrity', ({ name }) => {
    const base = name.split('/').pop();
    for (const [key, entry] of lockCopies(name)) {
      expect({ key, resolved: entry.resolved }).toEqual({
        key,
        resolved: `https://registry.npmjs.org/${name}/-/${base}-${entry.version}.tgz`,
      });
      expect({ key, sha512: String(entry.integrity).startsWith('sha512-') }).toEqual({ key, sha512: true });
    }
  });

  test('D4: overrides holds exactly the table names, nothing else', () => {
    expect(Object.keys(manifest.overrides ?? {}).sort()).toEqual(FLOORS.map((row) => row.name).sort());
  });

  test.each<[string, string, number]>([
    ['1.8.4', '1.11.0', -1],
    ['1.9.0', '1.11.0', -1],
    ['1.10.0', '1.11.0', -1],
    ['1.11.0', '1.11.0', 0],
    ['1.12.0', '1.11.0', 1],
  ])('D5: %s against %s compares as %i (numeric, not string)', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  test.each(FLOORS)('every row names the advisories its floor closes ($name)', ({ advisories }) => {
    expect(advisories.length).toBeGreaterThan(0);
    for (const id of advisories) expect(id).toMatch(/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
  });
});
