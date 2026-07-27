/**
 * Dependency-declaration guard (M5-A).
 *
 * `zod` was imported by production modules (the Zod boundary schemas) while
 * appearing in NEITHER `dependencies` NOR `devDependencies`. It only resolved
 * because npm hoisted `expo → @expo/cli → zod` to the top level, and CI ran
 * `npm install`, under which the lockfile is advisory. `npm ls zod` reported it
 * as `extraneous`. The failure mode was invisible in CI and fatal at runtime: if
 * @expo/cli widened to zod v4 or dropped the dependency, the Metro bundle would
 * break on device while every CI job stayed green.
 *
 * This suite pins the fix and generalises it, so the NEXT undeclared transitive
 * import fails here instead of on a coach's phone:
 *   1. every bare module specifier imported anywhere under src/ is declared in
 *      package.json,
 *   2. zod specifically is a production dependency at the version that is
 *      actually installed,
 *   3. package-lock.json records zod as a root dependency (so `npm ci` installs
 *      it deliberately rather than as a hoisting side effect),
 *   4. CI installs with `npm ci`, which hard-fails on lockfile/package.json
 *      drift, rather than `npm install`, which silently repairs it.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

const pkg = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lock = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'),
) as { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> };
const ci = fs.readFileSync(
  path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
  'utf8',
);

/**
 * Specifiers that legitimately resolve without a package.json entry: Node
 * builtins used by build/test tooling.
 */
const RESOLVED_WITHOUT_DECLARATION = new Set([
  'fs',
  'path',
  'os',
  'crypto',
  'util',
  'child_process',
]);

/**
 * Deliberate, documented exceptions — an undeclared import that is SAFE only
 * because its absence is handled. Adding an entry here is a review decision,
 * not a way to silence the guard.
 *
 * `react-native-mmkv` is require()'d inside a try/catch in storage/mmkv.ts as
 * an optional native module; when it is absent (Expo Go, Jest, and today every
 * build, since it is not in package.json) the module falls back to the
 * AsyncStorage shim. Declaring it is a separate decision with a native-build
 * consequence, so it is NOT bundled into this dependency-hygiene fix.
 */
const OPTIONAL_UNDECLARED = new Set(['react-native-mmkv']);

/** Reduce an import specifier to the package name npm would have to install. */
function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const SOURCE_FILES = walk(SRC_ROOT);

/** Comments hold prose that looks like an import; strip them before matching. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const IMPORT_STATEMENT_RE =
  /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Map of package name → the src files that import it. */
function collectImports(files: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    const specifiers = [
      ...text.matchAll(IMPORT_STATEMENT_RE),
      ...text.matchAll(SIDE_EFFECT_IMPORT_RE),
      ...text.matchAll(REQUIRE_RE),
    ];
    for (const match of specifiers) {
      const name = packageNameOf(match[1]);
      if (!name) continue;
      if (RESOLVED_WITHOUT_DECLARATION.has(name)) continue;
      if (OPTIONAL_UNDECLARED.has(name)) continue;
      const rel = path.relative(REPO_ROOT, file);
      const seen = found.get(name);
      if (seen) {
        if (!seen.includes(rel)) seen.push(rel);
      } else {
        found.set(name, [rel]);
      }
    }
  }
  return found;
}

const IMPORTED = collectImports(SOURCE_FILES);
const DECLARED = new Set([
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.devDependencies),
]);

describe('every package imported under src/ is declared in package.json', () => {
  it('finds source files to scan (the walker is not silently empty)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(IMPORTED.has('react')).toBe(true);
  });

  it('has no undeclared package imports', () => {
    const undeclared = [...IMPORTED.entries()]
      .filter(([name]) => !DECLARED.has(name))
      .map(([name, files]) => `${name} (imported by ${files[0]})`);
    expect(undeclared).toEqual([]);
  });
});

describe('zod is a declared production dependency', () => {
  it('is listed in dependencies, not devDependencies', () => {
    expect(pkg.dependencies.zod).toBe('^3.25.76');
    expect(pkg.devDependencies.zod).toBeUndefined();
  });

  it('matches the version the lockfile actually installs', () => {
    expect(lock.packages['node_modules/zod']?.version).toBe('3.25.76');
  });

  it('is a root dependency in the lockfile, not only a hoisted transitive', () => {
    expect(lock.packages['']?.dependencies?.zod).toBe('^3.25.76');
  });

  it('is imported by the production schema boundary it exists to serve', () => {
    expect(IMPORTED.get('zod')).toEqual(
      expect.arrayContaining([
        path.join('src', 'api', 'apiCall.ts'),
        path.join('src', 'types', 'importReview.ts'),
      ]),
    );
  });
});

describe('CI installs deterministically', () => {
  it('runs npm ci', () => {
    expect(ci).toMatch(/^\s+run: npm ci$/m);
  });

  it('never falls back to a lockfile-repairing npm install', () => {
    expect(ci).not.toMatch(/^\s+run: npm install\b/m);
  });
});
