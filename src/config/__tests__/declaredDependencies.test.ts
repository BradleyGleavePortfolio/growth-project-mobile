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
 *   1. every bare module specifier imported by bundled source — the repo-root
 *      `.ts`/`.tsx` modules and every `.ts`/`.tsx`/`.js`/`.jsx` file under src/
 *      — is declared in package.json,
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
 * Rule 5 also resolves npm's alias table and tokenises past global flags, since
 * `npm i`, `npm add`, `npm it`, `npm up` and `npm --prefix ./app install` are
 * all the banned command wearing a different spelling, and the last of them
 * defeats any pattern anchored to the word after `npm`.
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
 * npm's own alias table, copied from `npm/lib/utils/cmd-list.js`.
 *
 * Matching on spelling alone is not enough: `npm i`, `npm add` and `npm isntall`
 * are all `npm install`, and `npm clean-install` is `npm ci`. A guard that only
 * knows the long spellings passes a workflow that writes the short one.
 */
const NPM_ALIASES: Readonly<Record<string, string>> = {
  add: 'install',
  i: 'install',
  in: 'install',
  ins: 'install',
  inst: 'install',
  insta: 'install',
  instal: 'install',
  isnt: 'install',
  isnta: 'install',
  isntal: 'install',
  isntall: 'install',
  'clean-install': 'ci',
  ic: 'ci',
  'install-clean': 'ci',
  'isntall-clean': 'ci',
  it: 'install-test',
  cit: 'install-ci-test',
  'clean-install-test': 'install-ci-test',
  sit: 'install-ci-test',
  up: 'update',
  upgrade: 'update',
  udpate: 'update',
  unlink: 'uninstall',
  remove: 'uninstall',
  rm: 'uninstall',
  r: 'uninstall',
  un: 'uninstall',
  ddp: 'dedupe',
  run: 'run-script',
  rum: 'run-script',
  urn: 'run-script',
};

/**
 * Canonical npm commands that re-resolve the dependency graph and rewrite
 * package-lock.json. Any of these in CI defeats the point of committing a
 * lockfile: the job stops testing the tree the repo actually pins.
 *
 * `install-test` (`npm it`) installs before testing, and `update` moves ranges
 * forward by design. `uninstall` and `dedupe` rewrite the lock in place without
 * verifying it against the manifest, so they belong here for the same reason.
 */
const RESOLVES_DEPENDENCIES_AFRESH = new Set([
  'install',
  'install-test',
  'update',
  'uninstall',
  'dedupe',
]);

/**
 * Canonical npm commands that install exactly the committed lockfile and fail
 * on drift. `install-ci-test` (`npm cit`) is `npm ci` followed by `npm test`.
 */
const INSTALLS_THE_COMMITTED_LOCKFILE = new Set(['ci', 'install-ci-test']);

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
    // TSX for everything but `.ts`, so JSX parses in `.tsx`, `.jsx` and the
    // `.js` files Metro also allows it in. The one construct TSX rules out —
    // `<T>value` type assertions — is TypeScript-only syntax anyway.
    fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
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

/**
 * Metro resolves `.js` and `.jsx` as readily as `.ts`/`.tsx`, so both belong in
 * the walk. `src/screenshots/expoSqliteStub.web.js` is the current example: a
 * real bundled module — metro.config.js substitutes it for `expo-sqlite` when
 * `EXPO_PUBLIC_SCREENSHOT_MODE=1` on web — that a `.tsx?`-only walk never read.
 */
const BUNDLED_EXTENSIONS = /\.(?:[jt]sx?)$/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (BUNDLED_EXTENSIONS.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * The repo-root `.ts`/`.tsx` modules: `index.ts` (the manifest's `main`),
 * `App.tsx` — which `index.ts` reaches as `./App` and which is what pulls in
 * everything under src/ — and `App.test.tsx`, a test that `isTestFile` classifies
 * as such. A src/-only walk read none of them, which left every package reachable
 * only from here unguarded; `ENTRYPOINT_ONLY_PACKAGES` names the set.
 *
 * Root `.js` files are excluded deliberately. `babel.config.js`,
 * `metro.config.js`, `jest.setup.js` and `.eslintrc.js` are Node-side build and
 * tooling config that Metro never resolves into the app graph, and they load
 * devDependencies by design — scanning them would report build tooling as a
 * runtime dependency. Non-recursive for the same reason: src/ is walked
 * separately, and the root also holds `scripts/`, `node_modules` and `.expo`.
 */
function rootModules(): string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(REPO_ROOT, entry.name));
}

const ROOT_MODULES = rootModules();
const SRC_FILES = walk(SRC_ROOT);
const SOURCE_FILES = [...ROOT_MODULES, ...SRC_FILES];

/** Test scaffolding may lean on devDependencies; shipped code may not. */
function isTestFile(relativePath: string): boolean {
  return (
    /(?:^|[\\/])(?:__tests__|__mocks__)[\\/]/.test(relativePath) ||
    /\.(?:test|spec)\.[jt]sx?$/.test(relativePath)
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

/** Derived: packages reachable from the root modules and from no file under src/. */
const ENTRYPOINT_ONLY = [...collectImports(ROOT_MODULES).keys()]
  .filter((name) => !collectImports(SRC_FILES).has(name))
  .sort();

/**
 * The same set, written down. Every one of these was invisible to the src/-only
 * walk this suite replaces — naming two of them and implying that was all of
 * them is what this anchor exists to prevent recurring.
 *
 * The anchor is exact on purpose. Moving one of these imports into src/, or
 * adding a new root-only dependency, changes what the src/ walk alone would
 * prove, and that is a fact a reviewer should have to look at rather than a
 * number that quietly drifts.
 */
const ENTRYPOINT_ONLY_PACKAGES = [
  '@expo-google-fonts/cormorant-garamond',
  '@expo-google-fonts/inter',
  '@tanstack/react-query-persist-client',
  'expo',
  'expo-splash-screen',
  'expo-status-bar',
  'react-native-get-random-values',
];

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
 * Every token in a shell script that could be the npm command being run, with
 * npm's aliases resolved to the command they stand for.
 *
 * Tokenised rather than pattern-matched on the line, because the interesting
 * forms all defeat a `npm\s+(\w+)` match:
 *   - leading global flags — `npm --prefix ./app install`, `npm --loglevel info
 *     ci`. A pattern anchored to the word after `npm` reads `--prefix`, or
 *     nothing at all since a flag does not start with a letter, and so reports
 *     a workflow that installs as one that does not,
 *   - aliases — `npm i`, `npm add`, `npm it`, `npm up`, `npm clean-install`,
 *   - `pnpm ci` and `npm-run-all`, which contain `npm` but are not it.
 *
 * It deliberately over-collects: *every* non-flag token is resolved, not just
 * the first, so this returns flag values and package arguments (`./app` from
 * `--prefix ./app`, `left-pad` from `npm rm left-pad`) alongside the real
 * command. That is the safe direction for a guard. Identifying "the" command
 * would mean knowing which of npm's global flags take a separate value, and any
 * gap in that list is a silent miss — exactly the failure this suite exists to
 * stop. Over-collecting instead means a flag value that collides with a command
 * name (`--loglevel info`, where `info` is itself an npm alias) cannot mask the
 * real command behind it. Stray tokens are simply absent from both classified
 * sets, so they cost nothing.
 *
 * Two bounds keep the over-collection from inventing commands: scanning stops at
 * `--`, since everything after it is argv for the script rather than for npm
 * (`npm test -- --grep install` is not an install), and a `run-script` consumes
 * the script name after it (a script *named* `install` is not the command).
 */
function npmCommandTokensIn(script: string): string[] {
  const commands: string[] = [];
  for (const segment of script.replace(/#[^\n]*/g, '').split(/[\n;&|()]+/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const npmAt = tokens.indexOf('npm');
    if (npmAt === -1) continue;
    const argv = tokens.slice(npmAt + 1);
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === '--') break;
      if (token.startsWith('-')) continue;
      const canonical = NPM_ALIASES[token] ?? token;
      commands.push(canonical);
      // The next token is a script name, not a command.
      if (canonical === 'run-script') index += 1;
    }
  }
  return commands;
}

const WORKFLOW_FILES = fs.readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name));

/** Map of workflow filename -> every canonical npm command any of its steps runs. */
const WORKFLOW_NPM_COMMAND_TOKENS = new Map<string, string[]>(
  WORKFLOW_FILES.map((name) => [
    name,
    runScriptsIn(fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8')).flatMap(
      npmCommandTokensIn,
    ),
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

  it('reads JSX-bearing .js and .jsx, which Metro bundles like any other module', () => {
    // `fallbackIcon` is the line that makes this test bite. Parsed as
    // TypeScript, `<Icon glyph={...} />` is a `<T>value` type assertion and the
    // require inside it is dropped — while every import around it still comes
    // back, so the loss reads as a file that merely had one fewer dependency
    // rather than as a parse failure. Only the TSX script kind sees it, which is
    // why the choice is made by extension and not by "is this TypeScript".
    const JSX_IN_JS = [
      "import React from 'react';",
      "const { View } = require('react-native');",
      "export const fallbackIcon = <Icon glyph={require('jsx-attribute-pkg')} />;",
      'export const Card = ({ label }) => <View accessibilityLabel={label}>{label}</View>;',
      "export const lazy = () => import('jsx-dynamic-pkg');",
    ].join('\n');
    for (const fileName of ['stub.web.js', 'stub.jsx']) {
      expect(moduleSpecifiersIn(JSX_IN_JS, fileName)).toEqual([
        'react',
        'react-native',
        'jsx-attribute-pkg',
        'jsx-dynamic-pkg',
      ]);
    }
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

  it('scans the repo-root modules, not just src/', () => {
    const scanned = SOURCE_FILES.map((file) => path.relative(REPO_ROOT, file));
    // Reading main from the manifest means moving the entrypoint fails here
    // rather than silently narrowing the scan back to src/.
    expect(scanned).toContain(pkg.main);
    expect(scanned).toContain('App.tsx');
  });

  it('reaches every package that only the root modules import', () => {
    expect(ENTRYPOINT_ONLY).toEqual(ENTRYPOINT_ONLY_PACKAGES);
    // The point of reaching them: each is a real declared dependency that a
    // src/-only walk verified nothing about.
    expect(ENTRYPOINT_ONLY_PACKAGES.filter((name) => !DECLARED.has(name))).toEqual([]);
  });

  it('scans bundled .js under src/, which Metro resolves like any other module', () => {
    const scanned = SOURCE_FILES.map((file) => path.relative(REPO_ROOT, file));
    expect(scanned).toContain(path.join('src', 'screenshots', 'expoSqliteStub.web.js'));
  });

  it('excludes root build config, which loads devDependencies by design', () => {
    const scanned = SOURCE_FILES.map((file) => path.relative(REPO_ROOT, file));
    expect(scanned).not.toContain('metro.config.js');
    expect(scanned).not.toContain('babel.config.js');
    expect(scanned).not.toContain('jest.setup.js');
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

  it('reads npm commands past their flags and ignores commented-out prose', () => {
    expect(npmCommandTokensIn('npm ci')).toEqual(['ci']);
    expect(npmCommandTokensIn('npm ci --prefer-offline --no-audit')).toEqual(['ci']);
    expect(npmCommandTokensIn('npm test --if-present -- --ci')).toEqual(['test']);
    expect(npmCommandTokensIn('npm ci\nnpm run lint --if-present')).toEqual(['ci', 'run-script']);
    expect(npmCommandTokensIn('npx tsc --noEmit')).toEqual([]);
    // ci.yml documents this very rule in a comment that names `npm install`.
    expect(npmCommandTokensIn('# `npm ci`, not `npm install`: the lockfile is advisory')).toEqual([]);
  });

  it('sees the command behind leading global flags', () => {
    // A pattern anchored to the word after `npm` reads the flag, or nothing at
    // all, and reports a clean workflow.
    // The flag's value comes back too (`./app`, `mobile`) — deliberate
    // over-collection; what matters is that the command is not lost.
    expect(npmCommandTokensIn('npm --prefix ./app install')).toContain('install');
    expect(npmCommandTokensIn('npm --prefix=./app install')).toEqual(['install']);
    expect(npmCommandTokensIn('npm -w mobile install')).toContain('install');
    expect(npmCommandTokensIn('npm --silent ci')).toEqual(['ci']);
    // `--loglevel info` is the sharp case: `info` is itself an npm alias, so
    // resolving only the first non-flag token would hide the install behind it.
    expect(npmCommandTokensIn('npm --loglevel info install')).toContain('install');
    expect(npmCommandTokensIn('npm --loglevel info ci')).toContain('ci');
  });

  it('resolves npm aliases to the command they actually run', () => {
    for (const alias of ['i', 'in', 'ins', 'inst', 'instal', 'isntall', 'add']) {
      expect(npmCommandTokensIn(`npm ${alias} --no-save`)).toEqual(['install']);
    }
    for (const alias of ['ci', 'clean-install', 'ic', 'install-clean', 'isntall-clean']) {
      expect(npmCommandTokensIn(`npm ${alias}`)).toEqual(['ci']);
    }
    expect(npmCommandTokensIn('npm it')).toEqual(['install-test']);
    expect(npmCommandTokensIn('npm cit')).toEqual(['install-ci-test']);
    for (const alias of ['up', 'upgrade', 'udpate', 'update']) {
      expect(npmCommandTokensIn(`npm ${alias}`)).toEqual(['update']);
    }
    for (const alias of ['rm', 'remove', 'un', 'uninstall']) {
      // `left-pad` comes back alongside it; it matches no classified command.
      expect(npmCommandTokensIn(`npm ${alias} left-pad`)).toContain('uninstall');
    }
  });

  it('is not fooled by lookalikes, separators or script names', () => {
    // Other package managers contain the substring but are not npm.
    expect(npmCommandTokensIn('pnpm install')).toEqual([]);
    expect(npmCommandTokensIn('npm-run-all lint test')).toEqual([]);
    // A script named after a command is an argument to run-script, not a command.
    expect(npmCommandTokensIn('npm run install')).toEqual(['run-script']);
    expect(npmCommandTokensIn('npm run update:snapshots')).toEqual(['run-script']);
    // Shell separators start a new invocation.
    expect(npmCommandTokensIn('npm ci && npm run build')).toEqual(['ci', 'run-script']);
    expect(npmCommandTokensIn('npm ci; npm install')).toEqual(['ci', 'install']);
    expect(npmCommandTokensIn('npm ci | tee log')).toEqual(['ci']);
  });

  it('classifies every alias of a banned command as banned', () => {
    const banned = ['i', 'add', 'isntall', 'it', 'up', 'upgrade', 'rm', 'ddp'];
    for (const alias of banned) {
      const [canonical] = npmCommandTokensIn(`npm ${alias} --foo`);
      expect(RESOLVES_DEPENDENCIES_AFRESH.has(canonical)).toBe(true);
    }
    // ...and every alias of a clean install as clean.
    for (const alias of ['ci', 'clean-install', 'ic', 'cit', 'sit']) {
      const [canonical] = npmCommandTokensIn(`npm ${alias}`);
      expect(INSTALLS_THE_COMMITTED_LOCKFILE.has(canonical)).toBe(true);
      expect(RESOLVES_DEPENDENCIES_AFRESH.has(canonical)).toBe(false);
    }
  });

  it('finds workflows to scan (the directory read is not silently empty)', () => {
    expect(WORKFLOW_FILES).toContain('ci.yml');
    expect(WORKFLOW_NPM_COMMAND_TOKENS.get('ci.yml')).toContain('ci');
  });

  it('installs the committed lockfile with npm ci', () => {
    const installing = [...WORKFLOW_NPM_COMMAND_TOKENS.entries()]
      .filter(([, commands]) => commands.some((name) => INSTALLS_THE_COMMITTED_LOCKFILE.has(name)))
      .map(([name]) => name);
    expect(installing).not.toEqual([]);
  });

  it('never resolves dependencies afresh in any workflow', () => {
    const offenders = [...WORKFLOW_NPM_COMMAND_TOKENS.entries()].flatMap(([name, commands]) =>
      commands
        .filter((command) => RESOLVES_DEPENDENCIES_AFRESH.has(command))
        .map((command) => `${name}: npm ${command}`),
    );
    expect(offenders).toEqual([]);
  });
});
