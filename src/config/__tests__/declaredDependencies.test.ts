/**
 * Dependency-declaration guard (M5-A).
 *
 * `zod` used to be imported by production modules (the Zod boundary schemas)
 * while appearing in NEITHER `dependencies` NOR `devDependencies`. It resolved
 * only because `@expo/cli` declares `zod@^3.25.76` and npm deduped that copy up
 * to the top level, and CI ran `npm install`, under which the lockfile is
 * advisory. Nothing flagged it: the package WAS required by something in the
 * tree, so `npm ls zod` listed it healthily nested under `expo -> @expo/cli`
 * and never as `extraneous`. The tree looked correct while our own manifest
 * asked for nothing. The failure mode was invisible in CI and fatal at runtime:
 * if @expo/cli had widened to zod v4 or dropped the dependency, the Metro
 * bundle would have broken on device while every CI job stayed green.
 *
 * The same shape of bug applies to `@types/node`, which `tsconfig.json` names
 * in `compilerOptions.types` — `tsc --noEmit` cannot run without it — yet
 * nothing declared it either.
 *
 * This suite pins those fixes and generalises them, so the NEXT undeclared
 * transitive import fails here instead of on a coach's phone:
 *   1. every bare module specifier imported by bundled source — the root
 *      entrypoints (`index.ts`, `App.tsx`) and everything under src/ — is
 *      declared in package.json,
 *   2. every package imported by non-test source is a production dependency,
 *      not a devDependency — this is what makes zod's declaration a *runtime*
 *      one rather than a build-time one,
 *   3. package-lock.json records zod as a root dependency at the manifest's
 *      range, resolved to a published tarball, so `npm ci` installs it
 *      deliberately rather than as a hoisting side effect,
 *   4. every `compilerOptions.types` entry has a declared `@types/*` package,
 *   5. no workflow resolves dependencies afresh: CI installs with `npm ci`,
 *      which hard-fails on lockfile/package.json drift, rather than
 *      `npm install`, which silently repairs it.
 *
 * Both scans read the field they care about instead of the whole file, for the
 * same reason. Module specifiers come from the TypeScript parser; install
 * commands come from the value of each workflow's `run:` key. (`ci.yml`
 * explains rule 5 in comments that name `npm install` directly above the step
 * that runs `npm ci` — a scan of raw workflow text reports the repo's own
 * documentation as a violation.)
 *
 * Specifiers are collected with the TypeScript parser rather than regexes.
 * The regex scanner this replaces missed three import forms that production
 * code uses every day: multi-line named imports (its `from` matcher could not
 * cross a newline, which hid every `react-native-reanimated`,
 * `react-native-webview` and `@react-native-community/datetimepicker` import
 * in the repo), bare `import('pkg')` (the only `expo-crypto` and
 * `@supabase/supabase-js` edges in several modules), and any `require()` that
 * was not alone on its line — while still matching import-shaped prose inside
 * comments and string literals. A guard with blind spots is worse than no
 * guard, because it reads as coverage. The parser has neither blind spot: it
 * sees exactly the specifiers Metro will resolve, and nothing that lives
 * inside a comment, a string, a template literal or a regex.
 */
import * as fs from 'fs';
import { builtinModules } from 'module';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const WORKFLOW_DIR = path.join(REPO_ROOT, '.github', 'workflows');

function readJson<T>(...segments: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...segments), 'utf8')) as T;
}

const pkg = readJson<{
  main: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}>('package.json');

type LockEntry = {
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const lock = readJson<{ packages: Record<string, LockEntry> }>('package-lock.json');
const lockRoot = lock.packages[''];

const tsconfig = readJson<{ compilerOptions: { types: string[] } }>('tsconfig.json');

const NODE_BUILTINS = new Set(builtinModules);

/**
 * npm subcommands that re-resolve the dependency graph and rewrite
 * package-lock.json. Any of these in CI defeats the point of committing a
 * lockfile: the job stops testing the tree the repo actually pins.
 */
const LOCKFILE_REWRITING_SUBCOMMANDS = new Set(['install', 'i', 'add']);

/**
 * Deliberate, documented exceptions — an undeclared import that is SAFE only
 * because its absence is handled. Adding an entry here is a review decision,
 * not a way to silence the guard.
 *
 * `react-native-mmkv` is require()'d inside a try/catch in storage/mmkv.ts as
 * an optional native-module probe. It is absent from package.json today, so
 * the probe always throws and every build takes the AsyncStorage fallback.
 * Declaring it would change which native modules the app links, so that is a
 * separate decision and is NOT bundled into this dependency-hygiene fix.
 */
const OPTIONAL_UNDECLARED = new Set(['react-native-mmkv']);

/**
 * Real [package, importing file] pairs that the regex scanner this suite
 * replaced could not see. The first three packages have no single-line import
 * anywhere in the repo, so they were invisible outright; the last two are
 * reached from these particular modules only through bare `import('pkg')`.
 *
 * Without these anchors a future scanner regression would shrink the sample
 * silently and "no undeclared imports" would stay green while proving less
 * and less.
 */
const PARSER_ONLY_IMPORT_SITES: ReadonlyArray<readonly [string, string]> = [
  ['react-native-reanimated', path.join('src', 'components', 'onboarding', 'PermanenceMarker.tsx')],
  ['react-native-webview', path.join('src', 'screens', 'coach', 'CreditPackCheckoutScreen.tsx')],
  [
    '@react-native-community/datetimepicker',
    path.join('src', 'screens', 'coach', 'payments', 'contents', 'PushConfirmModal.tsx'),
  ],
  ['expo-crypto', path.join('src', 'security', 'biometric-lock.service.ts')],
  ['@supabase/supabase-js', path.join('src', 'utils', 'supabaseAuth.ts')],
];

/** Reduce an import specifier to the package name npm would have to install. */
function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  // `node:` is unambiguous, and newer builtins (node:test, node:sea) are
  // reachable under no other name — so trust the prefix rather than the list.
  if (specifier.startsWith('node:')) return null;
  const segments = specifier.split('/');
  const name = specifier.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
  if (!name || NODE_BUILTINS.has(name)) return null;
  return name;
}

/**
 * Every module specifier the bundler has to resolve for this source: static
 * imports and re-exports (however many lines they span), `import x =
 * require('y')`, dynamic `import('y')`, and `require('y')`.
 */
function moduleSpecifiersIn(source: string, fileName: string): string[] {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  function take(node: ts.Node | undefined): void {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      take(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      take(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) take(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return specifiers;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * The repo-root `.ts`/`.tsx` files. `package.json` main is `index.ts`, which
 * imports `App.tsx`, which is what pulls in everything under src/ — so a
 * src/-only walk skipped the two modules the bundle actually starts from, and
 * the packages they alone import (`expo`, `react-native-get-random-values`)
 * were unguarded. Non-recursive: the root also holds node_modules and .expo.
 */
function rootEntrypoints(): string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(REPO_ROOT, entry.name));
}

const SOURCE_FILES = [...rootEntrypoints(), ...walk(SRC_ROOT)];

/** Test scaffolding may lean on devDependencies; shipped code may not. */
function isTestFile(relativePath: string): boolean {
  return (
    /(?:^|[\\/])(?:__tests__|__mocks__)[\\/]/.test(relativePath) ||
    /\.(?:test|spec)\.tsx?$/.test(relativePath)
  );
}

/** Map of package name -> the bundled source files (repo-relative) importing it. */
function collectImports(files: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of files) {
    const relative = path.relative(REPO_ROOT, file);
    for (const specifier of moduleSpecifiersIn(fs.readFileSync(file, 'utf8'), file)) {
      const name = packageNameOf(specifier);
      if (!name || OPTIONAL_UNDECLARED.has(name)) continue;
      const seen = found.get(name);
      if (!seen) found.set(name, [relative]);
      else if (!seen.includes(relative)) seen.push(relative);
    }
  }
  return found;
}

const IMPORTED = collectImports(SOURCE_FILES);
const DECLARED = new Set([
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.devDependencies),
]);

/**
 * The `run:` scripts in a workflow, inline or block-scalar (`run: |`).
 *
 * Only the value of the `run:` key is collected, never the surrounding file.
 * That is what keeps documentation out of the result: ci.yml explains this very
 * rule in comments that name `npm install` directly above the step that runs
 * `npm ci`, so scanning the raw file reports the repo's own docs as a breach.
 */
function runScriptsIn(workflow: string): string[] {
  const lines = workflow.split('\n');
  const scripts: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const [, indent, head] = match;
    if (!/^[|>]/.test(head.trim())) {
      scripts.push(head);
      continue;
    }
    // Block scalar: the script is every following line indented past the key.
    const body: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      if (next.trim() !== '' && !next.slice(indent.length).startsWith(' ')) break;
      body.push(next);
      index += 1;
    }
    scripts.push(body.join('\n'));
  }
  return scripts;
}

/**
 * The npm subcommands a shell script invokes, ignoring anything after a `#`.
 * Only the subcommand is returned, never its flags: the property under test is
 * *which* command runs, so `npm ci --prefer-offline` has to read the same as a
 * bare `npm ci` rather than failing an equality check on the whole line.
 */
function npmSubcommandsIn(script: string): string[] {
  return script
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .flatMap((line) => [...line.matchAll(/\bnpm\s+([a-z][a-z-]*)/g)].map((match) => match[1]));
}

const WORKFLOW_FILES = fs.readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name));

/** Map of workflow filename -> every npm subcommand any of its steps runs. */
const WORKFLOW_NPM_SUBCOMMANDS = new Map<string, string[]>(
  WORKFLOW_FILES.map((name) => [
    name,
    runScriptsIn(fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8')).flatMap(npmSubcommandsIn),
  ]),
);

describe('the import scanner sees every form the codebase actually uses', () => {
  const FIXTURE = [
    'import Animated, {',
    '  useSharedValue,',
    '  type SharedValue,',
    "} from 'multiline-pkg';",
    "import 'side-effect-pkg';",
    "export { Thing } from 'reexport-pkg';",
    "export type { Shape } from 'type-reexport-pkg';",
    "import legacy = require('import-equals-pkg');",
    "import Local from './local';",
    'async function load() {',
    "  const mod = await import('dynamic-pkg');",
    "  const cjs = require('require-pkg');",
    '  const nested = require(',
    "    'multiline-require-pkg',",
    '  );',
    '  return [mod, cjs, nested, legacy, Local, Animated, useSharedValue];',
    '}',
    "// import { fake } from 'line-comment-pkg';",
    "/* require('block-comment-pkg') */",
    "/** Docs: await import('docblock-pkg') */",
    'const prose = "import { fake } from \'double-quoted-string-pkg\'";',
    "const templated = `await import('template-literal-pkg')`;",
    "const pattern = /require\\('regex-literal-pkg'\\)/;",
    "const runtimeName = 'computed-only-pkg';",
    'const computed = () => import(runtimeName);',
    'export { load, prose, templated, pattern, computed };',
  ].join('\n');

  it('reads multi-line, dynamic and require specifiers, and nothing else', () => {
    expect(moduleSpecifiersIn(FIXTURE, 'fixture.ts')).toEqual([
      'multiline-pkg',
      'side-effect-pkg',
      'reexport-pkg',
      'type-reexport-pkg',
      'import-equals-pkg',
      './local',
      'dynamic-pkg',
      'require-pkg',
      'multiline-require-pkg',
    ]);
  });

  it('reduces specifiers to installable package names and drops builtins', () => {
    expect(packageNameOf('@supabase/supabase-js/dist/module')).toBe('@supabase/supabase-js');
    expect(packageNameOf('expo-crypto')).toBe('expo-crypto');
    expect(packageNameOf('./relative')).toBeNull();
    expect(packageNameOf('path')).toBeNull();
    expect(packageNameOf('node:child_process')).toBeNull();
  });
});

describe('every package imported by bundled source is declared in package.json', () => {
  it('finds source files to scan (the walker is not silently empty)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(IMPORTED.has('react')).toBe(true);
  });

  it('scans the root entrypoints the bundle starts from, not just src/', () => {
    const scanned = SOURCE_FILES.map((file) => path.relative(REPO_ROOT, file));
    // Reading main from the manifest means moving the entrypoint fails here
    // rather than silently narrowing the scan back to src/.
    expect(scanned).toContain(pkg.main);
    expect(scanned).toContain('App.tsx');
    // Imported by index.ts and by no file under src/, so a src/-only walk
    // proved nothing about them.
    expect(IMPORTED.get('react-native-get-random-values')).toContain('index.ts');
    expect(IMPORTED.get('expo')).toContain('index.ts');
  });

  it('attributes the multi-line and dynamic import sites only a parser can see', () => {
    const unseen = PARSER_ONLY_IMPORT_SITES.filter(
      ([name, file]) => !(IMPORTED.get(name) ?? []).includes(file),
    ).map(([name, file]) => `${name} <- ${file}`);
    expect(unseen).toEqual([]);
  });

  it('has no undeclared package imports', () => {
    const undeclared = [...IMPORTED.entries()]
      .filter(([name]) => !DECLARED.has(name))
      .map(([name, files]) => `${name} (imported by ${files[0]})`);
    expect(undeclared).toEqual([]);
  });

  it('ships no runtime import that is only a devDependency', () => {
    const devOnlyAtRuntime = [...IMPORTED.entries()].flatMap(([name, files]) => {
      if (pkg.dependencies[name] || !pkg.devDependencies[name]) return [];
      const shipped = files.find((file) => !isTestFile(file));
      return shipped ? [`${name} (imported by ${shipped})`] : [];
    });
    expect(devOnlyAtRuntime).toEqual([]);
  });
});

describe('zod is a direct runtime dependency', () => {
  it('is declared in dependencies, not devDependencies', () => {
    // The range itself is deliberately not asserted. Rule 14 expects Dependabot
    // to bump it, and a test that must be hand-edited on every patch bump
    // teaches people to edit tests rather than read them.
    expect(Object.keys(pkg.dependencies)).toContain('zod');
    expect(pkg.devDependencies.zod).toBeUndefined();
  });

  it('is a root lockfile dependency at the manifest range, so npm ci installs it deliberately', () => {
    const declared = pkg.dependencies.zod;
    expect(typeof declared).toBe('string');
    expect(lockRoot.dependencies?.zod).toBe(declared);
    expect(lockRoot.devDependencies?.zod).toBeUndefined();
  });

  it('resolves to a published tarball rather than a hoisting side effect', () => {
    const entry = lock.packages['node_modules/zod'];
    expect(entry?.resolved).toMatch(
      /^https:\/\/registry\.npmjs\.org\/zod\/-\/zod-\d+\.\d+\.\d+\.tgz$/,
    );
    expect(entry?.integrity).toMatch(/^sha512-/);
    expect(entry?.dev).toBeUndefined();
  });

  it('is imported by the production schema boundary it exists to serve', () => {
    const importers = IMPORTED.get('zod') ?? [];
    expect(importers.filter((file) => !isTestFile(file))).toEqual(
      expect.arrayContaining([
        path.join('src', 'api', 'apiCall.ts'),
        path.join('src', 'types', 'importReview.ts'),
      ]),
    );
  });
});

describe('typecheck tooling types are declared', () => {
  it('declares an @types package for every tsconfig compilerOptions.types entry', () => {
    const missing = tsconfig.compilerOptions.types
      .map((name) => (name.startsWith('@types/') ? name : `@types/${name}`))
      .filter((name) => !DECLARED.has(name));
    expect(missing).toEqual([]);
  });

  it('pins @types/node in the lockfile root so npm ci installs it deliberately', () => {
    const declared = pkg.devDependencies['@types/node'];
    expect(typeof declared).toBe('string');
    expect(lockRoot.devDependencies?.['@types/node']).toBe(declared);
  });
});

describe('CI installs deterministically', () => {
  it('reads run: scripts inline and block-scalar, and no surrounding prose', () => {
    const FIXTURE = [
      'jobs:',
      '  verify:',
      '    steps:',
      '      - name: Install deps',
      '        # `npm ci`, not `npm install`: the lockfile is otherwise advisory',
      '        run: npm ci --prefer-offline',
      '      - name: Many things',
      '        run: |',
      '          npm run lint',
      '',
      '          npx tsc --noEmit',
      '      - uses: actions/checkout@v6',
    ].join('\n');
    expect(runScriptsIn(FIXTURE)).toEqual([
      'npm ci --prefer-offline',
      ['          npm run lint', '', '          npx tsc --noEmit'].join('\n'),
    ]);
  });

  it('reads npm subcommands past their flags and ignores commented-out prose', () => {
    expect(npmSubcommandsIn('npm ci')).toEqual(['ci']);
    expect(npmSubcommandsIn('npm ci --prefer-offline --no-audit')).toEqual(['ci']);
    expect(npmSubcommandsIn('npm test --if-present -- --ci')).toEqual(['test']);
    expect(npmSubcommandsIn('npm ci\nnpm run lint --if-present')).toEqual(['ci', 'run']);
    expect(npmSubcommandsIn('npx tsc --noEmit')).toEqual([]);
    // ci.yml documents this very rule in a comment that names `npm install`.
    expect(npmSubcommandsIn('# `npm ci`, not `npm install`: the lockfile is advisory')).toEqual([]);
  });

  it('finds workflows to scan (the directory read is not silently empty)', () => {
    expect(WORKFLOW_FILES).toContain('ci.yml');
    expect(WORKFLOW_NPM_SUBCOMMANDS.get('ci.yml')).toContain('ci');
  });

  it('installs the committed lockfile with npm ci', () => {
    const installing = [...WORKFLOW_NPM_SUBCOMMANDS.entries()]
      .filter(([, subcommands]) => subcommands.includes('ci'))
      .map(([name]) => name);
    expect(installing).not.toEqual([]);
  });

  it('never resolves dependencies afresh in any workflow', () => {
    const offenders = [...WORKFLOW_NPM_SUBCOMMANDS.entries()].flatMap(([name, subcommands]) =>
      subcommands
        .filter((subcommand) => LOCKFILE_REWRITING_SUBCOMMANDS.has(subcommand))
        .map((subcommand) => `${name}: npm ${subcommand}`),
    );
    expect(offenders).toEqual([]);
  });
});
