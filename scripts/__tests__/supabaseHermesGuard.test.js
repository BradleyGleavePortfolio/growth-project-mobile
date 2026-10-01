/**
 * Hermes guard for @supabase/* (EAS build d3db0b56 failed on supabase-js
 * 2.106.x `import(/* webpackIgnore: true *\/ OTEL_PKG)`).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../check-supabase-hermes');

const ROOT = path.resolve(__dirname, '..', '..');

describe('check-supabase-hermes', () => {
  it('the installed @supabase/* tree is Hermes-safe and supabase-js is pinned to exactly 2.105.0', () => {
    const { errors, scanned } = guard.check(ROOT);
    expect(errors).toEqual([]);
    expect(scanned).toContain('@supabase/supabase-js@2.105.0');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@supabase/supabase-js']).toBe('2.105.0');
    // every @supabase/*-js sibling resolves to the same release train
    for (const s of scanned.filter((x) => /-js@/.test(x))) expect(s).toMatch(/@2\.105\.0$/);
  });

  it.each([
    ['the 2.106.x OTEL pattern', 'const OTEL_PKG = "@opentelemetry/api"; async function f(){ return import(/* webpackIgnore: true */ /* @vite-ignore */ OTEL_PKG); }', 1],
    ['a template with an expression', 'const n="x"; import(`./${n}.js`);', 1],
    ['a concatenation', 'import("./a" + b);', 1],
    ['a literal specifier', 'import("./chunk.js").then(() => 0);', 0],
    ['an expression-free template', 'import(`./chunk.js`);', 0],
    ['static imports and require', 'import a from "a"; const b = require(c);', 0],
    ['a CJS file with a nested non-literal import', 'module.exports = function(){ return (async () => import(name))(); };', 1],
  ])('findDynamicImports: %s', (_label, code, count) => {
    expect(guard.findDynamicImports(code)).toHaveLength(count);
  });

  it.each([
    ['2.105.0', undefined, 0],
    ['2.106.0', { '.': { import: {}, require: {} } }, 1],
    ['2.106.1', { '.': { import: {}, require: {} } }, 1],
    ['2.117.1', { '.': { import: {}, require: {} } }, 1],
    ['2.117.1', { '.': { 'react-native': './dist/index.cjs', import: {} } }, 0],
    ['2.117.2', { '.': { import: {}, require: {} } }, 0],
    ['garbage', undefined, 1],
  ])('versionRule %s', (version, exportsField, count) => {
    expect(guard.versionRule({ version, exports: exportsField })).toHaveLength(count);
  });

  it('check() fails on a tree carrying the 2.106.1 dist pattern (and names the file)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgp-sb-'));
    try {
      const pkgDir = path.join(dir, 'node_modules', '@supabase', 'supabase-js');
      fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: '2.106.1', exports: { '.': { import: { default: './dist/index.mjs' } } } }));
      fs.writeFileSync(path.join(pkgDir, 'dist', 'index.mjs'), 'const OTEL_PKG="@opentelemetry/api";\nexport async function t(){ try { return await import(/* webpackIgnore: true */ OTEL_PKG); } catch { return null; } }\n');
      const { errors } = guard.check(dir);
      expect(errors.some((e) => /2\.106\.0–2\.117\.1/.test(e))).toBe(true);
      expect(errors.some((e) => /dist\/index\.mjs:2:.*non-literal dynamic import/.test(e))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
