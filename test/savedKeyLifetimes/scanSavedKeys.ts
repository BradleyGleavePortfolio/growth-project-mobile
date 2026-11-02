/**
 * Test-only helper for src/__tests__/savedKeyLifetimes.test.ts (KT-13 in KNOWN_TRAPS.md).
 *
 * Reads every non-test file under src/ with the TypeScript parser and lists each place the app reads,
 * writes or removes a saved key: AsyncStorage, expo-secure-store (directly or through
 * services/secureStorage) and the three storage/mmkv namespaces.
 *
 * The scan fails closed. It follows every binding that holds a store, whatever its spelling: a default,
 * named or namespace import, a re-export (an index file, `export { default } from`), require(),
 * import(), an alias (`const s = AsyncStorage`), a destructured method (`const { setItem } = ...`), an
 * object that holds the store, a parameter the store is handed to, useAsyncStorage(key). Each use of it
 * either names its key or is reported:
 *   - keys are read through literals, templates, `+`, local and imported consts, key functions (every
 *     value they can return), `.map` / `for of` over key lists, bulk calls (multiSet, setMany, removeMany)
 *     and wrapper functions that hand a key parameter to storage (each caller, through re-exports, default
 *     imports and callbacks, becomes the site). Dynamic parts become `*`.
 *   - a use it cannot read is a site with key '*' and method `unsupported: <why>` (case 1 of the test goes
 *     red and names the file and line), or, inside a method handed to a library, an adapter (case 3).
 * Only removals whose key cannot be read are left out: a sweep over keys read elsewhere saves nothing.
 */
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

export type Store = 'async' | 'secure-store' | 'prefs' | 'cache' | 'secure';
export interface KeySite {
  file: string;
  line: number;
  store: Store;
  /** The storage method at the end of the path (a wrapper's own storage call); `unsupported: <why>` if unread. */
  method: string;
  /** The key with every dynamic part as `*`; '*' alone means it could not be read. */
  key: string;
}

const ROOT = path.resolve(__dirname, '../..');
const SKIP_DIRS = new Set(['__tests__', '__mocks__', '__fixtures__', 'node_modules']);
const ASYNC_MODULE = '@react-native-async-storage/async-storage';
const SECURE_MODULE = 'expo-secure-store';
const PERSISTER_MODULE = '@tanstack/query-async-storage-persister';
/** The storage layers themselves (their callers are the sites): the stores each exports and its keyless exports. */
const LAYERS: Record<string, { stores: Record<string, Store>; keyless: string[] }> = {
  'src/storage/mmkv.ts': {
    stores: { prefsStorage: 'prefs', cacheStorage: 'cache', secureStorage: 'secure' },
    keyless: ['asMmkvModule', 'isMmkvAvailable', 'clearAllStorage'],
  },
  'src/services/secureStorage.ts': { stores: { secureStorage: 'secure-store' }, keyless: ['__resetSecureStorageForTests'] },
};
/** Store methods by how they take keys. A store method in none of these is reported. */
const KEY_METHODS = new Set([
  'getItem', 'setItem', 'removeItem', 'mergeItem', 'getItemAsync', 'setItemAsync',
  'deleteItemAsync', 'getString', 'getStringAsync', 'set', 'delete',
]);
const KEY_LIST_METHODS = new Set(['multiGet', 'multiRemove', 'getMany', 'removeMany']);
const PAIR_METHODS = new Set(['multiSet', 'multiMerge', 'setMany', 'mergeMany']);
const KEYLESS_METHODS = new Set([
  'getAllKeys', 'clear', 'clearNamespace', 'flushGetRequests', 'isAvailableAsync', 'canUseBiometricAuthentication',
]);
const REMOVALS = /^(removeItem|deleteItemAsync|delete|multiRemove|removeMany)$/;
/** expo-secure-store's option constants (WHEN_UNLOCKED, ...) are not storage calls. */
const CONSTANT = /^[A-Z][A-Z0-9_]*$/;
const LIST_METHODS = new Set(['map', 'forEach', 'filter', 'some', 'every', 'flatMap']);
const MAX = 64;
const MAX_ROUNDS = 6;

type Fn = ts.FunctionLikeDeclaration;
interface Import { from: string; name: string }
interface Parsed { rel: string; sf: ts.SourceFile; text: string; imports: Map<string, Import> }

const parsed = new Map<string, Parsed | null>();

function resolveModule(fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.join(path.dirname(fromRel), spec);
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) {
    if (fs.existsSync(path.join(ROOT, base + ext))) return (base + ext).split(path.sep).join('/');
  }
  return null;
}

function parse(rel: string): Parsed | null {
  if (parsed.has(rel)) return parsed.get(rel)!;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const kind = rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const text = String(fs.readFileSync(abs, 'utf8'));
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const imports = new Map<string, Import>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
    const from = (st.moduleSpecifier as ts.StringLiteral).text;
    const c = st.importClause;
    if (c.name) imports.set(c.name.text, { from, name: 'default' });
    const b = c.namedBindings;
    if (b && ts.isNamespaceImport(b)) imports.set(b.name.text, { from, name: '*' });
    if (b && ts.isNamedImports(b)) {
      for (const el of b.elements) {
        if (!el.isTypeOnly) imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
      }
    }
  }
  const p = { rel, sf, text, imports };
  parsed.set(rel, p);
  return p;
}

// ─── Names: what an identifier is declared as, through imports and re-exports ───────────────────────────

/** What a name resolves to. `path` walks a destructuring (`const { a: { b } } = x` is ['a', 'b']). */
type Target =
  | { k: 'ext'; from: string; name: string }
  | { k: 'layer'; rel: string; name: string }
  | { k: 'ns'; p: Parsed }
  | { k: 'decl'; p: Parsed; node: ts.Node; path: string[] };

function propName(n: ts.PropertyName | ts.BindingName): string | null {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isPrivateIdentifier(n)) return n.text;
  if (ts.isComputedPropertyName(n)) return literalOf(n.expression);
  return null;
}

function literalOf(e: ts.Expression): string | null {
  e = unwrap(e);
  return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e) ? e.text : null;
}

function bindingPath(b: ts.BindingName, name: string): string[] | null {
  if (ts.isIdentifier(b)) return b.text === name ? [] : null;
  for (const [i, el] of b.elements.entries()) {
    if (ts.isOmittedExpression(el)) continue;
    const inner = bindingPath(el.name, name);
    if (!inner) continue;
    if (el.dotDotDotToken) return ['...', ...inner];
    const key = ts.isObjectBindingPattern(b)
      ? (el.propertyName ? propName(el.propertyName) : propName(el.name)) ?? '?'
      : `#${i}`;
    return [key, ...inner];
  }
  return null;
}

/** The declaration of `name` seen from `at`: a parameter, a local, a top-level declaration or an import. */
function resolveName(name: string, at: ts.Node, p: Parsed): Target | null {
  for (let a: ts.Node | undefined = at; a; a = a.parent) {
    if (ts.isFunctionLike(a)) {
      for (const q of (a as Fn).parameters ?? []) {
        const route = bindingPath(q.name, name);
        if (route) return { k: 'decl', p, node: q, path: route };
      }
      if ((ts.isFunctionExpression(a) || ts.isClassExpression(a)) && a.name?.text === name) {
        return { k: 'decl', p, node: a, path: [] };
      }
    }
    if ((ts.isForOfStatement(a) || ts.isForInStatement(a) || ts.isForStatement(a)) && a.initializer &&
      ts.isVariableDeclarationList(a.initializer)) {
      for (const d of a.initializer.declarations) {
        const route = bindingPath(d.name, name);
        if (route) return { k: 'decl', p, node: d, path: route };
      }
    }
    if (ts.isCatchClause(a) && a.variableDeclaration && bindingPath(a.variableDeclaration.name, name)) {
      return { k: 'decl', p, node: a.variableDeclaration, path: [] };
    }
    const statements = (a as { statements?: ts.NodeArray<ts.Statement> }).statements;
    for (const st of statements ?? []) {
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name?.text === name) {
        return { k: 'decl', p, node: st, path: [] };
      }
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        const route = bindingPath(d.name, name);
        if (route) return { k: 'decl', p, node: d, path: route };
      }
    }
  }
  const imp = p.imports.get(name);
  return imp ? resolveImport(p, imp) : null;
}

function resolveImport(p: Parsed, imp: Import, seen = new Set<string>()): Target | null {
  if (!imp.from.startsWith('.')) return { k: 'ext', from: imp.from, name: imp.name };
  const rel = resolveModule(p.rel, imp.from);
  if (!rel) return null;
  if (LAYERS[rel]) return { k: 'layer', rel, name: imp.name };
  const tp = parse(rel);
  if (!tp) return null;
  return imp.name === '*' ? { k: 'ns', p: tp } : resolveExport(tp, imp.name, seen);
}

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);

/** The declaration behind one export of a file: its own, or through `export { x } from` and `export * from`. */
function resolveExport(p: Parsed, name: string, seen = new Set<string>()): Target | null {
  const id = `${p.rel}#${name}`;
  if (seen.has(id)) return null;
  seen.add(id);
  const stars: string[] = [];
  for (const st of p.sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      if (!st.exportClause) {
        if (from) stars.push(from);
        continue;
      }
      if (ts.isNamespaceExport(st.exportClause)) {
        if (st.exportClause.name.text === name && from) return resolveImport(p, { from, name: '*' }, seen);
        continue;
      }
      for (const el of st.exportClause.elements) {
        if (el.name.text !== name || el.isTypeOnly) continue;
        const local = (el.propertyName ?? el.name).text;
        return from ? resolveImport(p, { from, name: local }, seen) : resolveName(local, st, p);
      }
    } else if (ts.isExportAssignment(st)) {
      if (!st.isExportEquals && name === 'default') return { k: 'decl', p, node: st, path: [] };
    } else if (hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
      if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
        if (isDefault ? name === 'default' : st.name?.text === name) return { k: 'decl', p, node: st, path: [] };
      }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const route = bindingPath(d.name, name);
          if (route) return { k: 'decl', p, node: d, path: route };
        }
      }
    }
  }
  for (const from of stars) {
    if (!from.startsWith('.')) {
      if (from === ASYNC_MODULE || from === SECURE_MODULE) return { k: 'ext', from, name };
      continue;
    }
    const r = resolveImport(p, { from, name }, seen);
    if (r) return r;
  }
  return null;
}

/** Every name a file exports (its own and through `export *`). */
function exportNames(p: Parsed, seen = new Set<string>()): string[] {
  if (seen.has(p.rel)) return [];
  seen.add(p.rel);
  const out: string[] = [];
  for (const st of p.sf.statements) {
    if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
      if (!st.exportClause) {
        const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : '';
        const rel = resolveModule(p.rel, from);
        const tp = rel && !LAYERS[rel] ? parse(rel) : null;
        if (tp) out.push(...exportNames(tp, seen));
        else if (from === ASYNC_MODULE || from === SECURE_MODULE || (rel && LAYERS[rel])) out.push('default');
      } else if (ts.isNamespaceExport(st.exportClause)) out.push(st.exportClause.name.text);
      else for (const el of st.exportClause.elements) if (!el.isTypeOnly) out.push(el.name.text);
    } else if (ts.isExportAssignment(st)) out.push('default');
    else if (hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(st, ts.SyntaxKind.DefaultKeyword)) out.push('default');
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.push(st.name.text);
      else if (ts.isVariableStatement(st)) {
        const names = (b: ts.BindingName): string[] => ts.isIdentifier(b) ? [b.text]
          : b.elements.flatMap((el) => ts.isOmittedExpression(el) ? [] : names(el.name));
        for (const d of st.declarationList.declarations) out.push(...names(d.name));
      }
    }
  }
  return out;
}

// ─── Origins: which values are a store, a store's method, or hold one ───────────────────────────────────

type Origin =
  | { k: 'store'; store: Store }
  | { k: 'module' }
  | { k: 'method'; store: Store; method: string }
  | { k: 'hook' }
  | { k: 'holder'; props: Map<string, Origin> }
  | { k: 'ns'; p: Parsed };
type Env = Map<ts.Node, Origin>;
const EMPTY: Env = new Map();
const ASYNC_STORE: Origin = { k: 'store', store: 'async' };
const SECURE_STORE: Origin = { k: 'store', store: 'secure-store' };

const knownMethod = (m: string) =>
  KEY_METHODS.has(m) || KEY_LIST_METHODS.has(m) || PAIR_METHODS.has(m) || KEYLESS_METHODS.has(m);

/** A member of a storage value. 'unsupported' is a member the scan cannot read (a method's own bind or call). */
function member(o: Origin, name: string): Origin | null | 'unsupported' {
  switch (o.k) {
    case 'store': return CONSTANT.test(name) ? null : { k: 'method', store: o.store, method: name };
    case 'module':
      if (name === 'default') return ASYNC_STORE;
      if (name === 'useAsyncStorage') return { k: 'hook' };
      return knownMethod(name) ? { k: 'method', store: 'async', method: name } : null;
    case 'holder': return o.props.get(name) ?? null;
    case 'ns': return originOfTarget(resolveExport(o.p, name), EMPTY);
    default: return 'unsupported';
  }
}

function originOfExt(from: string, name: string): Origin | null {
  if (from === ASYNC_MODULE) {
    if (name === 'default') return ASYNC_STORE;
    if (name === '*') return { k: 'module' };
    return name === 'useAsyncStorage' ? { k: 'hook' } : null;
  }
  if (from === SECURE_MODULE) {
    if (name === '*' || name === 'default') return SECURE_STORE;
    return CONSTANT.test(name) ? null : { k: 'method', store: 'secure-store', method: name };
  }
  return null;
}

function layerOrigin(rel: string, name: string): Origin | null {
  const layer = LAYERS[rel];
  if (name === '*') {
    return { k: 'holder', props: new Map(Object.entries(layer.stores).map(([n, s]) => [n, { k: 'store', store: s }])) };
  }
  const store = layer.stores[name];
  if (store) return { k: 'store', store };
  // Any other export of a storage layer is reported where it is called (it may take a key).
  return layer.keyless.includes(name) ? null : { k: 'method', store: 'async', method: `${name} of ${rel}` };
}

const nsCache = new Map<string, boolean>();
function nsHasStorage(p: Parsed): boolean {
  if (nsCache.has(p.rel)) return nsCache.get(p.rel)!;
  nsCache.set(p.rel, false);
  const has = exportNames(p).some((n) => !!originOfTarget(resolveExport(p, n), EMPTY));
  nsCache.set(p.rel, has);
  return has;
}

const originCache = new Map<ts.Node, Origin | null>();
function baseOrigin(t: Extract<Target, { k: 'decl' }>, env: Env, depth: number): Origin | null {
  const n = t.node;
  if (ts.isParameter(n)) return env.get(n) ?? null;
  const cacheable = env.size === 0;
  if (cacheable && originCache.has(n)) return originCache.get(n)!;
  if (cacheable) originCache.set(n, null);
  let o: Origin | null = null;
  if (ts.isVariableDeclaration(n) && n.initializer) o = originOf(n.initializer, t.p, env, depth + 1);
  else if (ts.isExportAssignment(n)) o = originOf(n.expression, t.p, env, depth + 1);
  if (cacheable) originCache.set(n, o);
  return o;
}

function originOfTarget(t: Target | null, env: Env, depth = 0): Origin | null {
  if (!t || depth > 16) return null;
  if (t.k === 'ext') return originOfExt(t.from, t.name);
  if (t.k === 'layer') return layerOrigin(t.rel, t.name);
  if (t.k === 'ns') return nsHasStorage(t.p) ? { k: 'ns', p: t.p } : null;
  let o = baseOrigin(t, env, depth);
  for (const step of t.path) {
    if (!o) return null;
    const m = member(o, step);
    o = m === 'unsupported' ? null : m;
  }
  return o;
}

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
  return e;
}

/** The module a `require('x')` or `import('x')` call loads. */
function moduleCall(e: ts.CallExpression, p: Parsed): string | null {
  const callee = e.expression;
  const isRequire = ts.isIdentifier(callee) && callee.text === 'require' && !resolveName('require', e, p);
  if (callee.kind !== ts.SyntaxKind.ImportKeyword && !isRequire) return null;
  return e.arguments[0] ? literalOf(e.arguments[0]) : null;
}

function originOfModule(spec: string, p: Parsed): Origin | null {
  if (spec === ASYNC_MODULE) return { k: 'module' };
  if (spec === SECURE_MODULE) return SECURE_STORE;
  const rel = resolveModule(p.rel, spec);
  if (!rel) return null;
  if (LAYERS[rel]) return layerOrigin(rel, '*');
  const tp = parse(rel);
  return tp && nsHasStorage(tp) ? { k: 'ns', p: tp } : null;
}

const LOGICAL = new Set([
  ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken,
]);
const COMPARE = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
]);

/** What a value is, storage-wise (null: not storage). */
function originOf(e: ts.Expression, p: Parsed, env: Env, depth = 0): Origin | null {
  e = unwrap(e);
  if (depth > 16) return null;
  if (ts.isIdentifier(e)) return originOfTarget(resolveName(e.text, e, p), env, depth + 1);
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
    const name = ts.isPropertyAccessExpression(e) ? e.name.text : literalOf(e.argumentExpression);
    const o = name === null ? null : originOf(e.expression, p, env, depth + 1);
    const m = o && name !== null ? member(o, name) : null;
    return m === 'unsupported' ? null : m;
  }
  if (ts.isCallExpression(e)) {
    const spec = moduleCall(e, p);
    return spec ? originOfModule(spec, p) : null;
  }
  if (ts.isObjectLiteralExpression(e)) {
    const props = new Map<string, Origin>();
    for (const q of e.properties) {
      const o = ts.isShorthandPropertyAssignment(q) ? originOfTarget(resolveName(q.name.text, q, p), env, depth + 1)
        : ts.isPropertyAssignment(q) ? originOf(q.initializer, p, env, depth + 1) : null;
      const n = q.name ? propName(q.name) : null;
      if (o && n !== null) props.set(n, o);
    }
    return props.size ? { k: 'holder', props } : null;
  }
  if (ts.isConditionalExpression(e)) {
    return originOf(e.whenTrue, p, env, depth + 1) ?? originOf(e.whenFalse, p, env, depth + 1);
  }
  if (ts.isBinaryExpression(e) && LOGICAL.has(e.operatorToken.kind)) {
    return originOf(e.right, p, env, depth + 1) ?? originOf(e.left, p, env, depth + 1);
  }
  return null;
}

/** The local module a value is (its namespace): `import * as w`, `require('./w')`, `await import('./w')`, an alias. */
function nsOfExpr(e: ts.Expression, p: Parsed, depth = 0): Parsed | null {
  e = unwrap(e);
  if (depth > 8) return null;
  if (ts.isIdentifier(e)) return nsOfTarget(resolveName(e.text, e, p), depth + 1);
  if (!ts.isCallExpression(e)) return null;
  const spec = moduleCall(e, p);
  const rel = spec ? resolveModule(p.rel, spec) : null;
  return rel && !LAYERS[rel] ? parse(rel) : null;
}
function nsOfTarget(t: Target | null, depth = 0): Parsed | null {
  if (!t) return null;
  if (t.k === 'ns') return t.p;
  if (t.k !== 'decl' || t.path.length || !ts.isVariableDeclaration(t.node) || !t.node.initializer) return null;
  return nsOfExpr(t.node.initializer, t.p, depth);
}

/** The function a name, `ns.name` or `ns['name']` refers to, with its file. */
function fnOfTarget(t: Target | null): { fn: Fn; p: Parsed } | null {
  if (!t || t.k !== 'decl') return null;
  const n = t.node;
  if (t.path.length) {
    // `const { save } = await import('./w')`, `const { save } = require('./w')`, `const { save } = w`
    const ns = t.path.length === 1 ? nsOfTarget({ ...t, path: [] }) : null;
    return ns ? fnOfTarget(resolveExport(ns, t.path[0])) : null;
  }
  if (ts.isFunctionDeclaration(n)) return { fn: n, p: t.p };
  const init = ts.isVariableDeclaration(n) && n.initializer ? unwrap(n.initializer)
    : ts.isExportAssignment(n) ? unwrap(n.expression) : null;
  return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? { fn: init, p: t.p } : null;
}

/** `ns.name` or `ns['name']`: the member's name ('' when chosen at run time), or null for any other node. */
function memberName(e: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e)) return literalOf(e.argumentExpression) ?? '';
  return null;
}

function calleeFn(callee: ts.Expression, p: Parsed): { fn: Fn; p: Parsed } | null {
  callee = unwrap(callee);
  if (ts.isIdentifier(callee)) return fnOfTarget(resolveName(callee.text, callee, p));
  const name = memberName(callee);
  if (name && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
    const ns = nsOfExpr(callee.expression, p);
    if (ns) return fnOfTarget(resolveExport(ns, name));
  }
  return null;
}

// ─── Keys: every key an expression can be ───────────────────────────────────────────────────────────────

/** A wrapper parameter seen while reading a key: `\u00a7<n>` stands for it. */
const params: Array<{ fn: Fn; index: number; p: Parsed }> = [];
const P = /^\u00a7(\d+)$/;

function cross(parts: string[][]): string[] {
  let out = [''];
  for (const alts of parts) {
    const next: string[] = [];
    for (const a of out) for (const b of alts) next.push(a + b);
    out = next.slice(0, MAX);
  }
  return out.map((k) => k.replace(/\u00a7\d+/g, '*').replace(/\*+/g, '*'));
}

interface Found { node: ts.Node; p: Parsed }

/** Nearest declaration of `name` seen from `at`, for reading keys: a local, a parameter, or an import. */
function lookup(name: string, at: ts.Node, p: Parsed, env: Map<ts.Node, string[]>): Found | string[] {
  for (let a: ts.Node | undefined = at; a; a = a.parent) {
    if (ts.isFunctionLike(a)) {
      const fn = a as Fn;
      const i = fn.parameters.findIndex((q) => ts.isIdentifier(q.name) && q.name.text === name);
      if (i >= 0) {
        const bound = env.get(fn.parameters[i]);
        if (bound) return bound;
        const call = fn.parent;
        if (i === 0 && call && ts.isCallExpression(call) && call.arguments[0] === fn &&
          ts.isPropertyAccessExpression(call.expression) && LIST_METHODS.has(call.expression.name.text)) {
          return elements(call.expression.expression, p, env);
        }
        params.push({ fn, index: i, p });
        return [`\u00a7${params.length - 1}`];
      }
    }
    if (ts.isForOfStatement(a) && ts.isVariableDeclarationList(a.initializer) &&
      a.initializer.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)) {
      return elements(a.expression, p, env);
    }
    const statements = (a as { statements?: ts.NodeArray<ts.Statement> }).statements;
    for (const st of statements ?? []) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === name) return { node: st, p };
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return changedKeys(d, p, env) ?? (d.initializer ? { node: d.initializer, p } : ['*']);
      }
    }
  }
  const imp = p.imports.get(name);
  const t = imp ? resolveImport(p, imp) : null;
  if (t?.k !== 'decl' || t.path.length) return ['*'];
  if (ts.isVariableDeclaration(t.node)) return changedKeys(t.node, t.p, new Map()) ?? (t.node.initializer ? { node: t.node.initializer, p: t.p } : ['*']);
  if (ts.isExportAssignment(t.node)) return { node: t.node.expression, p: t.p };
  return { node: t.node, p: t.p };
}

const isAssign = (k: ts.SyntaxKind) => k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
/** Methods that change the array, object, map or set they are called on. */
const MUTATORS = new Set(['push', 'unshift', 'splice', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear']);
const OBJECT_WRITERS = new Set(['assign', 'defineProperty', 'defineProperties']);

/** A reference that changes its binding or what the binding holds: `k = `, `k += `, `k++`, `K.a = `, `K.push()`, ... */
function writesTo(id: ts.Identifier): boolean {
  const ref = climb(id);
  let n: ts.Node = ref;
  let last: string | null = null;
  while (n.parent && (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) &&
    n.parent.expression === n) {
    last = memberName(n.parent);
    n = climb(n.parent);
  }
  const par = n.parent;
  if (!par) return false;
  if (ts.isBinaryExpression(par) && isAssign(par.operatorToken.kind) && par.left === n) return true;
  if ((ts.isPrefixUnaryExpression(par) || ts.isPostfixUnaryExpression(par)) &&
    (par.operator === ts.SyntaxKind.PlusPlusToken || par.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  if ((ts.isForOfStatement(par) || ts.isForInStatement(par)) && par.initializer === n) return true;
  if (n !== ref) {
    if (ts.isDeleteExpression(par)) return true;
    if (ts.isCallExpression(par) && par.expression === n && last !== null && MUTATORS.has(last)) return true;
  }
  if (n === ref && ts.isCallExpression(par) && par.arguments[0] === n) {
    const callee = unwrap(par.expression);
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'Object' && OBJECT_WRITERS.has(callee.name.text)) return true;
  }
  // A destructuring assignment target: `[k] = ...`, `({ k } = ...)`, `for ([k] of ...)`
  let t: ts.Node = n;
  while (t.parent && (ts.isArrayLiteralExpression(t.parent) || ts.isObjectLiteralExpression(t.parent) ||
    ts.isShorthandPropertyAssignment(t.parent) || ts.isSpreadElement(t.parent) || ts.isSpreadAssignment(t.parent) ||
    (ts.isPropertyAssignment(t.parent) && t.parent.initializer === t) || ts.isParenthesizedExpression(t.parent))) t = t.parent;
  if (t === n || !t.parent) return false;
  const top = t.parent;
  return (ts.isBinaryExpression(top) && top.operatorToken.kind === ts.SyntaxKind.EqualsToken && top.left === t) ||
    ((ts.isForOfStatement(top) || ts.isForInStatement(top)) && top.initializer === t);
}

/** How a key binding changes after its first value: not at all, only by `push`/`unshift` (their arguments), or any. */
type Change = { k: 'none' } | { k: 'appends'; args: ts.Expression[] } | { k: 'any' };
const changeCache = new Map<ts.Node, Change>();
function changeOf(d: ts.VariableDeclaration, p: Parsed): Change {
  if (!ts.isIdentifier(d.name)) return { k: 'none' };
  const known = changeCache.get(d);
  if (known) return known;
  const name = d.name.text;
  let scope: ts.Node = d;
  while (scope.parent && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) scope = scope.parent;
  const args: ts.Expression[] = [];
  let any = false;
  eachRef(scope, (id) => {
    if (any || id.text !== name || !writesTo(id)) return;
    const t = resolveName(name, id, p);
    if (t?.k !== 'decl' || t.node !== d) return;
    const at = climb(id).parent;
    const call = at?.parent;
    if (at && ts.isPropertyAccessExpression(at) && (at.name.text === 'push' || at.name.text === 'unshift') &&
      call && ts.isCallExpression(call) && call.expression === at) args.push(...call.arguments);
    else any = true;
  });
  const c: Change = any ? { k: 'any' } : args.length ? { k: 'appends', args } : { k: 'none' };
  changeCache.set(d, c);
  return c;
}

/**
 * What a key binding can hold (null: its first value only). A binding that changes after its first value is read as
 * any key ('*'), except a list built by `push`/`unshift`, read as its first elements and everything added.
 */
function changedKeys(d: ts.VariableDeclaration, p: Parsed, env: Map<ts.Node, string[]>): string[] | null {
  const c = changeOf(d, p);
  if (c.k === 'none') return null;
  const init = d.initializer ? unwrap(d.initializer) : null;
  if (c.k === 'any' || !init || !ts.isArrayLiteralExpression(init) || reading.has(d)) return ['*'];
  reading.add(d); // a list that adds its own elements is read as any key
  try {
    return [...elements(init, p, env), ...c.args.flatMap((a) => (ts.isSpreadElement(a) ? elements(a.expression, p, env) : keys(a, p, env)))];
  } finally {
    reading.delete(d);
  }
}
const reading = new Set<ts.Node>();
/** Every key an array expression holds (array literals, spreads, consts). */
function elements(e: ts.Expression, p: Parsed, env: Map<ts.Node, string[]>, depth = 0): string[] {
  e = unwrap(e);
  if (depth > 8) return ['*'];
  if (ts.isArrayLiteralExpression(e)) {
    return e.elements.flatMap((el) =>
      ts.isSpreadElement(el) ? elements(el.expression, p, env, depth + 1) : keys(el, p, env, depth + 1));
  }
  if (ts.isIdentifier(e)) {
    const f = lookup(e.text, e, p, env);
    return Array.isArray(f) ? f : ts.isExpression(f.node) ? elements(f.node, f.p, env, depth + 1) : ['*'];
  }
  return ['*'];
}

function isNothing(e: ts.Expression): boolean {
  e = unwrap(e);
  return e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined');
}

/**
 * Every value a function can return: each `return` in its body (inside if, switch, loops and try too, but
 * not in nested functions), or the arrow's expression. A `return` with no value or null names no key.
 */
function returned(fn: Fn): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression && !isNothing(n.expression)) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  fn.body.statements.forEach(visit);
  return out;
}

/** Every key an expression can be, with dynamic parts as `*`. */
function keys(e: ts.Expression, p: Parsed, env: Map<ts.Node, string[]>, depth = 0): string[] {
  e = unwrap(e);
  if (depth > 8) return ['*'];
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isTemplateExpression(e)) {
    const parts: string[][] = [[e.head.text]];
    for (const span of e.templateSpans) {
      const v = keys(span.expression, p, env, depth + 1);
      parts.push(v.some((k) => k.includes('*') || P.test(k)) ? ['*'] : v, [span.literal.text]);
    }
    return cross(parts);
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return cross([keys(e.left, p, env, depth + 1), keys(e.right, p, env, depth + 1)]);
  }
  if (ts.isConditionalExpression(e)) {
    // `ready ? key : null` waits for an id; the null side is no key.
    return [e.whenTrue, e.whenFalse].filter((b) => !isNothing(b)).flatMap((b) => keys(b, p, env, depth + 1));
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return keys(e.right, p, env, depth + 1);
  }
  if (ts.isIdentifier(e)) {
    const f = lookup(e.text, e, p, env);
    if (Array.isArray(f)) return f;
    return ts.isExpression(f.node) && !ts.isFunctionLike(f.node) ? keys(f.node, f.p, env, depth + 1) : ['*'];
  }
  const prop = ts.isPropertyAccessExpression(e) ? e.name.text
    : ts.isElementAccessExpression(e) ? literalOf(e.argumentExpression) : null;
  if ((ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) && ts.isIdentifier(e.expression) && prop !== null) {
    const f = lookup(e.expression.text, e, p, env);
    const obj = !Array.isArray(f) && ts.isObjectLiteralExpression(f.node) ? f.node : null;
    const q = obj?.properties.find(
      (x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && propName(x.name) === prop);
    return q && !Array.isArray(f) ? keys(q.initializer, f.p, env, depth + 1) : ['*'];
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && /^use(Memo|Callback)$/.test(e.expression.text)) {
    const fn = e.arguments[0];
    const rets = fn && ts.isFunctionLike(fn) ? returned(fn as Fn) : [];
    return rets.length ? rets.flatMap((r) => keys(r, p, env, depth + 1)) : ['*'];
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const f = lookup(e.expression.text, e, p, env);
    if (Array.isArray(f) || !ts.isFunctionLike(f.node)) return ['*'];
    const fn = f.node as Fn;
    const rets = returned(fn);
    if (!rets.length) return ['*'];
    const inner = new Map(env);
    fn.parameters.forEach((q, i) => {
      const arg = e.arguments[i];
      const v = arg ? keys(arg, p, env, depth + 1) : ['*'];
      inner.set(q, v.map((k) => (P.test(k) ? '*' : k)));
    });
    return rets.flatMap((r) => keys(r, f.p, inner, depth + 1));
  }
  return ['*'];
}

/** The keys of a bulk save: `[[key, value], ...]`, or setMany's `{ key: value }`. */
function pairKeys(e: ts.Expression, p: Parsed): string[] {
  e = unwrap(e);
  if (ts.isArrayLiteralExpression(e)) {
    return e.elements.flatMap((el) => {
      const pair = ts.isSpreadElement(el) ? null : unwrap(el);
      const first = pair && ts.isArrayLiteralExpression(pair) ? pair.elements[0] : undefined;
      return first && !ts.isSpreadElement(first) ? keys(first, p, new Map()) : ['*'];
    });
  }
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.flatMap((q) => {
      if (q.name && ts.isComputedPropertyName(q.name)) return keys(q.name.expression, p, new Map());
      const n = q.name ? propName(q.name) : null;
      return n === null ? ['*'] : [n];
    });
  }
  return ['*'];
}

/** A wrapper callable by name; a method handed to a library (an adapter) has none. */
function fnName(fn: Fn): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? (hasModifier(fn, ts.SyntaxKind.DefaultKeyword) ? 'default' : null);
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isExportAssignment(parent)) return 'default';
  return null;
}

// ─── The walk ───────────────────────────────────────────────────────────────────────────────────────────

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listFiles(rel, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.d\.ts$|\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Every module a file loads: its imports (side-effect ones too), re-exports, `require()` and `import()` calls. */
function specsOf(p: Parsed): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n)) {
      const spec = moduleCall(n, p);
      if (spec) out.push(spec);
    }
    ts.forEachChild(n, visit);
  };
  visit(p.sf);
  return out;
}

/**
 * The app's own files outside src/: the entry (package.json "main", index.ts) and every file it loads, step by step,
 * that is not under src/ (App.tsx and whatever App.tsx loads from the root). src/ is listed in full.
 */
function entryFiles(): string[] {
  let main = 'index.ts';
  try {
    const pkg = JSON.parse(String(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))) as { main?: string };
    if (typeof pkg.main === 'string') main = pkg.main;
  } catch {
    // no package.json: the default entry
  }
  const start = fs.existsSync(path.join(ROOT, main)) ? main : resolveModule('package.json', `./${main.replace(/\.[jt]sx?$/, '')}`);
  const out: string[] = [];
  const queue = start ? [start] : [];
  while (queue.length) {
    const rel = queue.shift()!;
    if (out.includes(rel) || rel.startsWith('src/') || rel.startsWith('node_modules/')) continue;
    const p = parse(rel);
    if (!p) continue;
    out.push(rel);
    for (const spec of specsOf(p)) {
      const next = resolveModule(rel, spec);
      if (next) queue.push(next);
    }
  }
  return out;
}

/** An identifier that refers to a binding (not a declaration's own name, a property name or a type). */
function isRef(id: ts.Identifier): boolean {
  const par = id.parent;
  if (!par) return false;
  if (ts.isPropertyAccessExpression(par)) return par.expression === id;
  if (ts.isQualifiedName(par) || ts.isMetaProperty(par) || ts.isLabeledStatement(par) ||
    ts.isBreakOrContinueStatement(par)) return false;
  if (ts.isExportSpecifier(par)) {
    if (par.parent.parent.moduleSpecifier) return false;
    return (par.propertyName ?? par.name) === id;
  }
  if (ts.isShorthandPropertyAssignment(par)) return par.name === id;
  const named = par as { name?: ts.Node; propertyName?: ts.Node };
  return named.name !== id && named.propertyName !== id;
}

function eachRef(root: ts.Node, cb: (id: ts.Identifier) => void): void {
  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) ||
      ts.isImportDeclaration(n) || ts.isImportEqualsDeclaration(n)) return;
    if (ts.isIdentifier(n)) {
      if (isRef(n)) cb(n);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
}

/** Climb through parentheses, casts and await to the node whose parent uses the value. */
function climb(n: ts.Node): ts.Node {
  while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) ||
    ts.isNonNullExpression(n.parent) || ts.isSatisfiesExpression(n.parent) ||
    ts.isTypeAssertionExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
  return n;
}

const storeOfOrigin = (o: Origin): Store =>
  o.k === 'store' || o.k === 'method' ? o.store
    : o.k === 'holder' ? storeOfOrigin([...o.props.values()][0]) : 'async';

export interface Scan {
  sites: KeySite[];
  /** Wrapper functions found: `file:function#param` (their callers were read as sites). */
  wrappers: string[];
  /** `file:line` of storage calls inside a method handed to a library, keyed by that library. */
  adapters: string[];
}

export function scanSavedKeys(): Scan {
  const sites: KeySite[] = [];
  type Via = { store: Store; method: string };
  interface Wrapper { id: string; p: Parsed; fn: Fn; name: string; index: number; vias: Via[] }
  const wrappers = new Map<string, Wrapper>();
  const pending: Wrapper[] = [];
  const adapters = new Set<string>();
  const followed = new Set<string>();
  const lineOf = (p: Parsed, at: ts.Node) => p.sf.getLineAndCharacterOfPosition(at.getStart(p.sf)).line + 1;

  const unsupported = (p: Parsed, at: ts.Node, store: Store, why: string) => {
    sites.push({ file: p.rel, line: lineOf(p, at), store, method: `unsupported: ${why}`, key: '*' });
  };

  const record = (p: Parsed, at: ts.Node, via: Via, found: string[], round = 0) => {
    const line = lineOf(p, at);
    for (const k of found) {
      const m = P.exec(k);
      const w = m ? params[Number(m[1])] : null;
      const name = w ? fnName(w.fn) : null;
      if (w && name && round < MAX_ROUNDS) {
        const id = `${w.p.rel}:${name}#${w.index}`;
        const known = wrappers.get(id);
        if (!known) {
          const fresh: Wrapper = { id, p: w.p, fn: w.fn, name, index: w.index, vias: [via] };
          wrappers.set(id, fresh);
          pending.push(fresh);
        } else if (!known.vias.some((v) => v.store === via.store && v.method === via.method)) {
          known.vias.push(via);
        }
        continue;
      }
      if (w && !name) {
        adapters.add(`${p.rel}:${line}`);
        continue;
      }
      // A removal the scan cannot read is a sweep over keys read elsewhere.
      if ((k === '*' || m) && REMOVALS.test(via.method)) continue;
      sites.push({ file: p.rel, line, ...via, key: m ? '*' : k });
    }
  };

  const methodSites = (p: Parsed, call: ts.CallExpression, store: Store, method: string) => {
    const via = { store, method };
    const arg = call.arguments[0];
    if (KEYLESS_METHODS.has(method)) return;
    if (!arg || ts.isSpreadElement(arg)) return unsupported(p, call, store, `${method} with no key the scan can read`);
    if (KEY_METHODS.has(method)) return record(p, call, via, keys(arg, p, new Map()));
    if (KEY_LIST_METHODS.has(method)) return record(p, call, via, elements(arg, p, new Map()));
    if (PAIR_METHODS.has(method)) return record(p, call, via, pairKeys(arg, p));
    unsupported(p, call, store, `${method} is a storage call the scan does not know`);
  };

  /** One use of a storage value: it names its key, hands the value on to a use that does, or is reported. */
  const use = (ref: ts.Node, o: Origin, p: Parsed, env: Env, depth = 0): void => {
    const n = climb(ref);
    const par = n.parent;
    const no = (why: string) => unsupported(p, n, storeOfOrigin(o), why);
    if (depth > 16) return no('a chain too long to follow');
    if (!par) return;
    if ((ts.isPropertyAccessExpression(par) || ts.isElementAccessExpression(par)) && par.expression === n) {
      const name = ts.isPropertyAccessExpression(par) ? par.name.text : literalOf(par.argumentExpression);
      if (name === null) return no('a member chosen at run time');
      const m = member(o, name);
      if (m === 'unsupported') return no(`${name} of a storage method`);
      if (m) use(par, m, p, env, depth + 1);
      return;
    }
    if (ts.isCallExpression(par) && par.expression === n) {
      if (o.k === 'method') return methodSites(p, par, o.store, o.method);
      if (o.k === 'hook') {
        const arg = par.arguments[0];
        return record(p, par, { store: 'async', method: 'useAsyncStorage' }, arg ? keys(arg, p, new Map()) : ['*']);
      }
      return no('a store called as a function');
    }
    if ((ts.isCallExpression(par) || ts.isNewExpression(par)) && par.arguments?.some((a) => a === n)) {
      const i = par.arguments.indexOf(n as ts.Expression);
      const callee = unwrap(par.expression);
      if (o.k === 'method' && i === 0 && ts.isPropertyAccessExpression(callee) &&
        LIST_METHODS.has(callee.name.text) && KEY_METHODS.has(o.method)) {
        return record(p, par, { store: o.store, method: o.method }, elements(callee.expression, p, new Map()));
      }
      const target = ts.isCallExpression(par) ? calleeFn(callee, p) : null;
      const q = target?.fn.parameters[i];
      if (target && q && !q.dotDotDotToken && target.fn.body) {
        const id = `${target.p.rel}:${target.fn.pos}:${i}:${JSON.stringify(o, (k, v) => (k === 'p' ? v.rel : v instanceof Map ? [...v] : v))}`;
        if (followed.has(id)) return;
        followed.add(id);
        const inner: Env = new Map([[q, o]]);
        eachRef(target.fn.body, (x) => {
          const t = resolveName(x.text, x, target.p);
          if (!t || originOfTarget(t, EMPTY)) return; // read by the file's own walk
          const o2 = originOfTarget(t, inner);
          if (o2) use(x, o2, target.p, inner, depth + 1);
        });
        return;
      }
      return no('handed to a function the scan cannot follow');
    }
    if (ts.isVariableDeclaration(par) && par.initializer === n) return; // an alias or a destructure: read where used
    if (ts.isShorthandPropertyAssignment(par) || (ts.isPropertyAssignment(par) && par.initializer === n)) {
      const obj = par.parent;
      const host = climb(obj).parent;
      if (ts.isVariableDeclaration(host) && climb(obj) === host.initializer) return; // a holder: read where used
      const call = obj.parent;
      if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) &&
        p.imports.get(call.expression.text)?.from === PERSISTER_MODULE) return; // its key is read below
      return no('kept in an object the scan cannot follow');
    }
    if (ts.isExportAssignment(par) || ts.isExportSpecifier(par)) return; // its importers are read
    if (ts.isExpressionStatement(par) || ts.isTypeOfExpression(par) || ts.isVoidExpression(par)) return;
    if (ts.isPrefixUnaryExpression(par) && par.operator === ts.SyntaxKind.ExclamationToken) return;
    if (ts.isBinaryExpression(par) && COMPARE.has(par.operatorToken.kind)) return;
    if ((ts.isIfStatement(par) || ts.isWhileStatement(par)) && par.expression === n) return;
    if (ts.isConditionalExpression(par) && par.condition === n) return;
    if ((ts.isBinaryExpression(par) && LOGICAL.has(par.operatorToken.kind)) || ts.isConditionalExpression(par)) {
      return use(par, o, p, env, depth + 1);
    }
    no('used in a way the scan cannot follow');
  };

  const files = [...listFiles('src'), ...entryFiles()].map(parse).filter((p): p is Parsed => !!p);
  const storageImport = (p: Parsed) => [...p.imports.values()].some((imp) => !!originOfTarget(resolveImport(p, imp), EMPTY));
  for (const p of files) {
    if (LAYERS[p.rel]) continue;
    const relevant = p.text.includes(ASYNC_MODULE) || p.text.includes(SECURE_MODULE) ||
      /\brequire\(|\bimport\(/.test(p.text) || storageImport(p);
    if (relevant) {
      eachRef(p.sf, (id) => {
        const o = originOfTarget(resolveName(id.text, id, p), EMPTY);
        if (o) use(id, o, p, EMPTY);
      });
      // A store loaded in place: `require('x').default.setItem(...)`, `(await import('x')).default.setItem(...)`
      const inline = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const spec = moduleCall(n, p);
          const o = spec ? originOfModule(spec, p) : null;
          if (o) use(n, o, p, EMPTY);
        }
        ts.forEachChild(n, inline);
      };
      inline(p.sf);
    }
    if (!p.text.includes(PERSISTER_MODULE)) continue;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) &&
        p.imports.get(n.expression.text)?.from === PERSISTER_MODULE) {
        const opts = n.arguments[0];
        const keyProp = opts && ts.isObjectLiteralExpression(opts)
          ? opts.properties.find((q) => q.name?.getText() === 'key') : undefined;
        if (keyProp) {
          const init = ts.isShorthandPropertyAssignment(keyProp)
            ? keyProp.name : (keyProp as ts.PropertyAssignment).initializer;
          record(p, n, { store: 'async', method: 'getItem' }, keys(init, p, new Map()));
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(p.sf);
  }

  // Callers of a wrapper hand it the key. Every reference to a wrapper (direct, through re-exports, a
  // default import under another name, `ns.fn`, a list callback) is read; any other use is reported.
  const wrapperUse = (ref: ts.Node, w: Wrapper, p: Parsed, round: number) => {
    const n = climb(ref);
    const par = n.parent;
    const each = (fn: (via: Via) => void) => w.vias.forEach(fn);
    if (ts.isCallExpression(par) && par.expression === n) {
      const upto = par.arguments.slice(0, w.index + 1);
      if (upto.some(ts.isSpreadElement)) return each((v) => unsupported(p, par, v.store, `${w.name} called with a spread`));
      const arg = par.arguments[w.index];
      const init = w.fn.parameters[w.index]?.initializer;
      if (arg) return each((v) => record(p, par, v, keys(arg, p, new Map()), round));
      if (init) return each((v) => record(p, par, v, keys(init, w.p, new Map()), round));
      return each((v) => unsupported(p, par, v.store, `${w.name} called with no key`));
    }
    if (ts.isCallExpression(par) && par.arguments[0] === n && w.index === 0) {
      const list = par.expression;
      if (ts.isPropertyAccessExpression(list) && LIST_METHODS.has(list.name.text)) {
        return each((v) => record(p, par, v, elements(list.expression, p, new Map()), round));
      }
    }
    if (ts.isExportSpecifier(par) || ts.isExportAssignment(par)) return; // its importers are read
    each((v) => unsupported(p, n, v.store, `${w.name} (it saves the key it is given) used as a value`));
  };
  // Which files a round reads: a wrapper's home and every file that loads a module exposing one of the batch's
  // wrappers (directly, through re-exports at any depth, by import, require() or import()).
  const loadsCache = new Map<string, string[]>();
  const loads = (p: Parsed) => {
    if (!loadsCache.has(p.rel)) {
      loadsCache.set(p.rel, [...new Set(specsOf(p).map((spec) => resolveModule(p.rel, spec)).filter((r): r is string => !!r))]);
    }
    return loadsCache.get(p.rel)!;
  };
  const exposesCache = new Map<string, Set<string>>();
  /** The files whose exports a module hands on (itself, its re-exports and the imports it exports again). */
  const exposes = (rel: string): Set<string> => {
    const known = exposesCache.get(rel);
    if (known) return known;
    const out = new Set<string>([rel]);
    exposesCache.set(rel, out);
    const p = parse(rel);
    if (!p || LAYERS[rel]) return out;
    const exported = new Set<string>();
    const hand = (from: string) => {
      const next = resolveModule(rel, from);
      if (next) for (const r of exposes(next)) out.add(r);
    };
    for (const st of p.sf.statements) {
      if (ts.isExportDeclaration(st)) {
        if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) hand(st.moduleSpecifier.text);
        else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) exported.add((el.propertyName ?? el.name).text);
        }
      } else if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) exported.add(st.expression.text);
      else if (hasModifier(st, ts.SyntaxKind.ExportKeyword) && ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const init = d.initializer ? unwrap(d.initializer) : null;
          if (init && ts.isIdentifier(init)) exported.add(init.text);
        }
      }
    }
    for (const [local, imp] of p.imports) if (exported.has(local)) hand(imp.from);
    return out;
  };
  /** A member of a module namespace that may be one of the batch's wrappers. */
  const viaNs = (ref: ts.Node, ns: Parsed, p: Parsed, round: number, byFn: Map<ts.Node, Wrapper[]>, batch: Wrapper[]) => {
    const n = climb(ref);
    const par = n.parent;
    if (!par || !(ts.isPropertyAccessExpression(par) || ts.isElementAccessExpression(par)) || par.expression !== n) return;
    const name = memberName(par);
    if (name === '') {
      const fns = new Set(exportNames(ns).map((x) => fnOfTarget(resolveExport(ns, x))?.fn).filter((f) => !!f));
      for (const w of batch.filter((b) => fns.has(b.fn))) {
        w.vias.forEach((v) => unsupported(p, par, v.store, `${w.name} picked from its module at run time`));
      }
      return;
    }
    const hit = name ? fnOfTarget(resolveExport(ns, name)) : null;
    for (const w of (hit && byFn.get(hit.fn)) || []) wrapperUse(par, w, p, round);
  };
  for (let round = 1; round <= MAX_ROUNDS && pending.length; round++) {
    const batch = pending.splice(0);
    const byFn = new Map<ts.Node, Wrapper[]>();
    for (const w of batch) byFn.set(w.fn, [...(byFn.get(w.fn) ?? []), w]);
    const homes = new Set(batch.map((w) => w.p.rel));
    for (const p of files) {
      if (!homes.has(p.rel) && !loads(p).some((rel) => [...exposes(rel)].some((r) => homes.has(r)))) continue;
      eachRef(p.sf, (id) => {
        const t = resolveName(id.text, id, p);
        const hit = fnOfTarget(t);
        for (const w of (hit && byFn.get(hit.fn)) || []) wrapperUse(id, w, p, round);
        const ns = nsOfTarget(t);
        if (ns) viaNs(id, ns, p, round, byFn, batch);
      });
      // A module loaded in place: `require('./w').save(...)`, `(await import('./w')).save(...)`
      const inline = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const ns = nsOfExpr(n, p);
          if (ns && moduleCall(n, p)) viaNs(n, ns, p, round, byFn, batch);
        }
        ts.forEachChild(n, inline);
      };
      inline(p.sf);
    }
  }
  for (const w of pending) {
    w.vias.forEach((v) => unsupported(w.p, w.fn, v.store, `${w.name}: wrappers nested deeper than ${MAX_ROUNDS}`));
  }

  const seen = new Set<string>();
  const unique = sites.filter((s) => {
    const id = `${s.file}:${s.line}:${s.store}:${s.method}:${s.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { sites: unique, wrappers: [...wrappers.keys()].sort(), adapters: [...adapters].sort() };
}
