#!/usr/bin/env node
/**
 * Hermes release-bundle guard for @supabase/* (EAS build d3db0b56).
 *
 * @supabase/supabase-js 2.106.x ships `import(/* webpackIgnore: true *\/ OTEL_PKG)`
 * in dist/index.mjs, a dynamic import() with a NON-literal specifier. Metro
 * keeps it and Hermes (hermesc, createBundleReleaseJsAndAssets) rejects it:
 * "Invalid expression encountered". 2.105.0 is clean; 2.117.2 adds a
 * "react-native" export condition pointing at index.cjs (the upstream fix).
 *
 * Fails (exit 1) when:
 *   1. any JS file (.js/.mjs/.cjs, excluding nested node_modules, maps and
 *      .d.ts) of an installed @supabase/* package contains `import(<expr>)`
 *      whose argument is not a string literal / expression-free template; or
 *   2. @supabase/supabase-js resolves to >=2.106.0 <2.117.2 and its "."
 *      export has no "react-native" condition.
 *
 *   node scripts/check-supabase-hermes.js [--root <dir>]   (default: repo root)
 * Long-term path: upgrade to >=2.117.2 (react-native condition) and drop the pin.
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node script */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const JS_EXT = /\.(c|m)?js$/;

function listJsFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (JS_EXT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function isLiteralSpecifier(arg) {
  if (!arg) return false;
  if (arg.type === 'StringLiteral') return true;
  if (arg.type === 'TemplateLiteral') return arg.expressions.length === 0;
  return false;
}

/** Returns [{line, column, snippet}] for each non-literal dynamic import(). */
function findDynamicImports(code) {
  const ast = parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowImportExportEverywhere: true,
    errorRecovery: true,
    createImportExpressions: false,
  });
  const hits = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Import') {
      if (!isLiteralSpecifier(node.arguments[0])) hits.push(node);
    } else if (node.type === 'ImportExpression') {
      if (!isLiteralSpecifier(node.source)) hits.push(node);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key.endsWith('Comments')) continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
    }
  };
  visit(ast.program);
  return hits.map((n) => ({
    line: n.loc.start.line,
    column: n.loc.start.column,
    snippet: code.slice(n.start, Math.min(n.end, n.start + 120)).replace(/\s+/g, ' '),
  }));
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? m.slice(1, 4).map(Number) : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function versionRule(pkg) {
  const v = parseVersion(pkg.version);
  if (!v) return [`@supabase/supabase-js: unreadable version ${JSON.stringify(pkg.version)}`];
  const inBadRange = cmp(v, [2, 106, 0]) >= 0 && cmp(v, [2, 117, 2]) < 0;
  const dot = pkg.exports && pkg.exports['.'];
  const hasRn = !!(dot && typeof dot === 'object' && Object.prototype.hasOwnProperty.call(dot, 'react-native'));
  return inBadRange && !hasRn
    ? [`@supabase/supabase-js@${pkg.version} is in 2.106.0–2.117.1 without a "react-native" export condition (Hermes-incompatible dynamic import); pin 2.105.0 or upgrade to >=2.117.2`]
    : [];
}

function check(root) {
  const scope = path.join(root, 'node_modules', '@supabase');
  const errors = [];
  const scanned = [];
  if (!fs.existsSync(scope)) return { errors: [`${scope} not found (run npm ci)`], scanned };
  for (const name of fs.readdirSync(scope)) {
    const dir = path.join(scope, name);
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    scanned.push(`@supabase/${name}@${pkg.version}`);
    if (name === 'supabase-js') errors.push(...versionRule(pkg));
    for (const file of listJsFiles(dir)) {
      let hits;
      try {
        hits = findDynamicImports(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        errors.push(`${path.relative(root, file)}: could not parse (${e.message}); failing closed`);
        continue;
      }
      for (const h of hits) {
        errors.push(`${path.relative(root, file)}:${h.line}:${h.column} non-literal dynamic import() breaks Hermes: ${h.snippet}`);
      }
    }
  }
  return { errors, scanned };
}

module.exports = { check, findDynamicImports, versionRule, isLiteralSpecifier };

if (require.main === module) {
  const i = process.argv.indexOf('--root');
  const root = i > 0 ? path.resolve(process.argv[i + 1]) : path.resolve(__dirname, '..');
  const { errors, scanned } = check(root);
  if (errors.length) {
    errors.forEach((e) => console.error(`check-supabase-hermes: ${e}`));
    process.exit(1);
  }
  console.log(`check-supabase-hermes: OK (${scanned.join(', ')})`);
}
