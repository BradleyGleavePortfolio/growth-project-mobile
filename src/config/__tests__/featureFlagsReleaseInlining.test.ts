/**
 * Release-bundle inlining guard for the feature-flag readers.
 *
 * `babel-preset-expo` inlines ONLY literal `process.env.EXPO_PUBLIC_<NAME>`
 * member expressions when the bundler caller is production
 * (`caller.isDev === false`). A computed `process.env[key]` lookup is left
 * untouched, and React Native's runtime `process.env` is empty, so every
 * flag read that way silently resolves to its fallback in a release build —
 * EAS env cannot turn it on AND a hard-`false` kill switch cannot be flipped.
 *
 * This suite transforms the real flag modules with the real preset in
 * production-caller mode and then evaluates the transformed code with an
 * EMPTY runtime `process.env`, so it proves the value is baked in at build
 * time (transform-only evidence; a whole-app `expo export` is a separate,
 * non-CI check).
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseSync, transformSync, traverse, types as t } from '@babel/core';
import type { TransformOptions } from '@babel/core';

const CONFIG_DIR = path.join(__dirname, '..');
const FILES = ['featureFlags.ts', 'aiGatewayFlags.ts'] as const;

type Env = Record<string, string | undefined>;

function withEnv<T>(env: Env, fn: () => T): T {
  const saved: Env = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function transformRelease(source: string, filename: string, env: Env): string {
  return withEnv(env, () => {
    const out = transformSync(source, {
      filename,
      babelrc: false,
      configFile: false,
      presets: [['babel-preset-expo', {}]],
      // Mirrors what Metro passes for a production native bundle.
      caller: {
        name: 'metro',
        bundler: 'metro',
        platform: 'android',
        isDev: false,
        isServer: false,
        isNodeModule: false,
        engine: 'hermes',
      } as unknown as TransformOptions['caller'],
    });
    if (!out?.code) throw new Error(`babel produced no code for ${filename}`);
    return out.code;
  });
}

/**
 * Evaluate transformed CommonJS with an EMPTY `process.env` — the situation
 * on device. Only the flag modules are loaded; `import type` was erased.
 */
function evaluate(code: string): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  const fakeProcess = { env: {} as Env };
  const fakeRequire = (id: string) => {
    throw new Error(`unexpected runtime require(${id})`);
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(
    'module',
    'exports',
    'require',
    'process',
    '__DEV__',
    'globalThis',
    code,
  );
  fn(module, module.exports, fakeRequire, fakeProcess, false, {
    __DEV__: false,
  });
  return module.exports;
}

const sources = Object.fromEntries(
  FILES.map((f) => [f, fs.readFileSync(path.join(CONFIG_DIR, f), 'utf8')]),
) as Record<(typeof FILES)[number], string>;

/**
 * Count `process.env[<anything>]` COMPUTED member reads in real code. Parsing
 * to an AST (TypeScript syntax, no transforms) means the prose in comments —
 * which legitimately explains why `process.env[key]` is unsafe — can never
 * trip the guard, and a computed read can never hide behind formatting.
 */
function countComputedProcessEnvReads(source: string, filename: string): number {
  const ast = parseSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    parserOpts: { plugins: ['typescript'] },
  });
  if (!ast) throw new Error(`babel produced no AST for ${filename}`);
  let computed = 0;
  traverse(ast, {
    MemberExpression(p) {
      const { object, computed: isComputed } = p.node;
      if (
        isComputed &&
        t.isMemberExpression(object) &&
        t.isIdentifier(object.object, { name: 'process' }) &&
        !object.computed &&
        t.isIdentifier(object.property, { name: 'env' })
      ) {
        computed += 1;
      }
    },
  });
  return computed;
}

describe('feature-flag readers survive release inlining', () => {
  it('control: the preset does NOT inline a computed process.env[key] lookup', () => {
    const control = [
      "const key = 'EXPO_PUBLIC_FF_CONTROL';",
      'export const dynamic = process.env[key];',
      'export const literal = process.env.EXPO_PUBLIC_FF_CONTROL;',
    ].join('\n');
    const code = transformRelease(control, path.join(CONFIG_DIR, 'control.ts'), {
      EXPO_PUBLIC_FF_CONTROL: 'true',
    });
    expect(code).toMatch(/process\.env\[key\]/);
    expect(code).toMatch(/"true"/);
    expect(evaluate(code)).toMatchObject({ dynamic: undefined, literal: 'true' });
  });

  it('control: the AST guard counts real computed reads and ignores comments', () => {
    const withRead = [
      '// a comment mentioning process.env[key] must not count',
      '/* nor a block comment: process.env["X"] */',
      "const key = 'EXPO_PUBLIC_FF_CONTROL';",
      'export const a = process.env[key];',
      'export const b = process.env.EXPO_PUBLIC_FF_CONTROL;',
    ].join('\n');
    expect(countComputedProcessEnvReads(withRead, 'control.ts')).toBe(1);
    const commentsOnly = [
      '// process.env[key]',
      '/** process.env[key] */',
      'export const literal = process.env.EXPO_PUBLIC_FF_CONTROL;',
    ].join('\n');
    expect(countComputedProcessEnvReads(commentsOnly, 'control.ts')).toBe(0);
  });

  it.each(FILES)('%s has no computed process.env lookup in source', (file) => {
    expect(countComputedProcessEnvReads(sources[file], path.join(CONFIG_DIR, file))).toBe(0);
  });

  it.each(FILES)(
    '%s: every EXPO_PUBLIC_ key the reader accepts is a literal process.env read',
    (file) => {
      const src = sources[file];
      const keys = new Set(
        Array.from(
          src.matchAll(/(?:readFlag|envBool)\(\s*'(EXPO_PUBLIC_[A-Z0-9_]+)'/g),
          (m) => m[1],
        ),
      );
      expect(keys.size).toBeGreaterThan(0);
      for (const key of keys) {
        expect(src).toMatch(new RegExp(`\\b${key}:\\s*process\\.env\\.${key}\\b`));
      }
    },
  );

  it.each(FILES)(
    '%s: release transform leaves no process.env.EXPO_PUBLIC_* reference behind',
    (file) => {
      const code = transformRelease(sources[file], path.join(CONFIG_DIR, file), {
        EXPO_PUBLIC_FF_EXTENSION_IMPORT: 'true',
        EXPO_PUBLIC_FF_AI_GATEWAY: 'true',
      });
      expect(code).not.toMatch(/process\.env\.EXPO_PUBLIC_/);
      expect(code).not.toMatch(/process\.env\[/);
      expect(code).not.toMatch(/expo\/virtual\/env/);
    },
  );

  describe('featureFlags.ts — value is baked in at build time, runtime env ignored', () => {
    const build = (env: Env) =>
      evaluate(
        transformRelease(sources['featureFlags.ts'], path.join(CONFIG_DIR, 'featureFlags.ts'), {
          EXPO_PUBLIC_FF_EXTENSION_IMPORT: undefined,
          EXPO_PUBLIC_FF_IMPORT_REVIEW: undefined,
          ...env,
        }),
      ).featureFlags as Record<string, boolean>;

    it('missing → hard-false kill switches stay OFF', () => {
      const flags = build({});
      expect(flags.extensionImport).toBe(false);
      expect(flags.importReview).toBe(false);
    });

    it('"true" / "1" → ON only for the flag that was set (independence)', () => {
      const flags = build({ EXPO_PUBLIC_FF_EXTENSION_IMPORT: 'true' });
      expect(flags.extensionImport).toBe(true);
      expect(flags.importReview).toBe(false);
      expect(build({ EXPO_PUBLIC_FF_IMPORT_REVIEW: '1' }).importReview).toBe(true);
    });

    it('"false" / "0" / "off" → OFF', () => {
      for (const v of ['false', '0', 'off', 'no']) {
        expect(build({ EXPO_PUBLIC_FF_EXTENSION_IMPORT: v }).extensionImport).toBe(false);
      }
    });

    it('malformed / empty → fallback (OFF for a hard-false flag)', () => {
      for (const v of ['', ' ', 'maybe', 'TRUEISH', 'yes please']) {
        expect(build({ EXPO_PUBLIC_FF_EXTENSION_IMPORT: v }).extensionImport).toBe(false);
      }
    });

    it('all-off env leaves every hard-false flag OFF (no accidental enablement)', () => {
      const flags = build({});
      for (const k of ['extensionImport', 'importReview', 'bloodwork', 'romanChat']) {
        expect({ [k]: flags[k] }).toEqual({ [k]: false });
      }
    });
  });

  describe('aiGatewayFlags.ts — same contract', () => {
    const build = (env: Env) =>
      evaluate(
        transformRelease(
          sources['aiGatewayFlags.ts'],
          path.join(CONFIG_DIR, 'aiGatewayFlags.ts'),
          {
            EXPO_PUBLIC_FF_AI_GATEWAY: undefined,
            EXPO_PUBLIC_FF_AI_COACH_BRIEF_DRAFT: undefined,
            EXPO_PUBLIC_FF_AI_SOURCE_BADGE: undefined,
            ...env,
          },
        ),
      ).aiGatewayFlags as {
        aiGatewayEnabled: boolean;
        capabilities: Record<string, boolean>;
        showSourceBadge: boolean;
      };

    it('missing → master OFF in release, capabilities OFF, badge ON (defaults preserved)', () => {
      const f = build({});
      expect(f.aiGatewayEnabled).toBe(false);
      expect(Object.values(f.capabilities).every((v) => v === false)).toBe(true);
      expect(f.showSourceBadge).toBe(true);
    });

    it('true/1 → ON; false/malformed → OFF; flags independent', () => {
      expect(build({ EXPO_PUBLIC_FF_AI_GATEWAY: 'true' }).aiGatewayEnabled).toBe(true);
      expect(build({ EXPO_PUBLIC_FF_AI_GATEWAY: '1' }).aiGatewayEnabled).toBe(true);
      expect(build({ EXPO_PUBLIC_FF_AI_GATEWAY: 'false' }).aiGatewayEnabled).toBe(false);
      expect(build({ EXPO_PUBLIC_FF_AI_GATEWAY: 'nope' }).aiGatewayEnabled).toBe(false);
      const f = build({ EXPO_PUBLIC_FF_AI_COACH_BRIEF_DRAFT: 'true' });
      expect(f.aiGatewayEnabled).toBe(false);
      expect(f.capabilities.coach_brief_draft).toBe(true);
      expect(build({ EXPO_PUBLIC_FF_AI_SOURCE_BADGE: 'false' }).showSourceBadge).toBe(false);
    });
  });
});
