/**
 * Test-only helper for savedKeyLifetimes.test.ts (KT-13 in KNOWN_TRAPS.md).
 *
 * Reads every non-test file under src/ with the TypeScript parser and lists
 * each place the app reads, writes or removes one saved key: AsyncStorage,
 * expo-secure-store (directly or through services/secureStorage) and the three
 * storage/mmkv namespaces. The key argument is followed through literals,
 * templates, `+`, local and imported consts, key functions, `.map` / `for of`
 * over key lists, and wrapper functions that hand a key parameter to storage
 * (their callers become the sites). Dynamic parts become `*`.
 */
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

export type Store = 'async' | 'secure-store' | 'prefs' | 'cache' | 'secure';
export interface KeySite {
  file: string;
  line: number;
  store: Store;
  /** The storage method at the end of the path (a wrapper's own storage call). */
  method: string;
  /** The key with every dynamic part as `*`; '*' alone means it could not be read. */
  key: string;
}

const ROOT = path.resolve(__dirname, '../../..');
const SKIP_DIRS = new Set(['__tests__', '__mocks__', '__fixtures__', 'node_modules']);
/** The storage layers themselves: their callers are the sites. */
const LAYERS = new Set(['src/storage/mmkv.ts', 'src/services/secureStorage.ts']);
const KEY_METHODS = new Set([
  'getItem', 'setItem', 'removeItem', 'mergeItem', 'getItemAsync', 'setItemAsync',
  'deleteItemAsync', 'getString', 'getStringAsync', 'set', 'delete',
]);
const LIST_METHODS = new Set(['map', 'forEach', 'filter', 'some', 'every', 'flatMap']);
const MAX = 64;

type Fn = ts.FunctionLikeDeclaration;
interface Parsed { rel: string; sf: ts.SourceFile; imports: Map<string, { from: string; name: string }> }

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
  const sf = ts.createSourceFile(rel, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, kind);
  const imports = new Map<string, { from: string; name: string }>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const from = (st.moduleSpecifier as ts.StringLiteral).text;
    const c = st.importClause;
    if (c.name) imports.set(c.name.text, { from, name: 'default' });
    const b = c.namedBindings;
    if (b && ts.isNamespaceImport(b)) imports.set(b.name.text, { from, name: '*' });
    if (b && ts.isNamedImports(b)) {
      for (const el of b.elements) imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
    }
  }
  const p = { rel, sf, imports };
  parsed.set(rel, p);
  return p;
}

/** Which store a receiver identifier is, from the file's imports. */
function storeOf(p: Parsed, id: string): Store | null {
  const imp = p.imports.get(id);
  if (!imp) return null;
  if (imp.from === '@react-native-async-storage/async-storage' && imp.name === 'default') return 'async';
  if (imp.from === 'expo-secure-store' && imp.name === '*') return 'secure-store';
  const target = resolveModule(p.rel, imp.from);
  if (target === 'src/storage/mmkv.ts') {
    return ({ prefsStorage: 'prefs', cacheStorage: 'cache', secureStorage: 'secure' } as const)[
      imp.name as 'prefsStorage'
    ] ?? null;
  }
  if (target === 'src/services/secureStorage.ts' && imp.name === 'secureStorage') return 'secure-store';
  return null;
}

/** A wrapper parameter seen while reading a key: `\u00a7<n>` stands for it. */
const params: Array<{ fn: Fn; index: number }> = [];
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

function topLevel(p: Parsed, name: string): ts.Node | null {
  for (const st of p.sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return d.initializer ?? null;
      }
    }
  }
  return null;
}

interface Found { node: ts.Node; p: Parsed }

/** Nearest declaration of `name` seen from `at`: a local, a parameter, or an import. */
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
        params.push({ fn, index: i });
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
        if (ts.isIdentifier(d.name) && d.name.text === name) return d.initializer ? { node: d.initializer, p } : ['*'];
      }
    }
  }
  const imp = p.imports.get(name);
  const target = imp && resolveModule(p.rel, imp.from);
  const tp = target ? parse(target) : null;
  const node = tp && imp ? topLevel(tp, imp.name) : null;
  return node && tp ? { node, p: tp } : ['*'];
}

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

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

function returned(fn: Fn): ts.Expression | null {
  if (!fn.body) return null;
  if (!ts.isBlock(fn.body)) return fn.body;
  const ret = fn.body.statements.find(ts.isReturnStatement);
  return ret?.expression ?? null;
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
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const f = lookup(e.expression.text, e, p, env);
    const obj = !Array.isArray(f) && ts.isObjectLiteralExpression(f.node) ? f.node : null;
    const prop = obj?.properties.find(
      (q): q is ts.PropertyAssignment => ts.isPropertyAssignment(q) && q.name.getText() === e.name.text);
    return prop && !Array.isArray(f) ? keys(prop.initializer, f.p, env, depth + 1) : ['*'];
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && /^use(Memo|Callback)$/.test(e.expression.text)) {
    const fn = e.arguments[0];
    const ret = fn && ts.isFunctionLike(fn) ? returned(fn as Fn) : null;
    return ret ? keys(ret, p, env, depth + 1) : ['*'];
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const f = lookup(e.expression.text, e, p, env);
    if (Array.isArray(f) || !ts.isFunctionLike(f.node)) return ['*'];
    const fn = f.node as Fn;
    const ret = returned(fn);
    if (!ret) return ['*'];
    const inner = new Map(env);
    fn.parameters.forEach((q, i) => {
      const arg = e.arguments[i];
      const v = arg ? keys(arg, p, env, depth + 1) : ['*'];
      inner.set(q, v.map((k) => (P.test(k) ? '*' : k)));
    });
    return keys(ret, f.p, inner, depth + 1);
  }
  return ['*'];
}

/** A wrapper callable by name; a method handed to a library (an adapter) has none. */
function fnName(fn: Fn): string | null {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return null;
}

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
  const wrappers = new Map<string, { p: Parsed; name: string; index: number; via: Via }>();
  const adapters = new Set<string>();
  const record = (p: Parsed, at: ts.Node, via: Via, found: string[], depthWrap = 0) => {
    const removal = /^(removeItem|deleteItemAsync|delete)$/.test(via.method);
    const line = p.sf.getLineAndCharacterOfPosition(at.getStart(p.sf)).line + 1;
    for (const k of found) {
      const m = P.exec(k);
      const w = m ? params[Number(m[1])] : null;
      const name = w ? fnName(w.fn) : null;
      if (w && name && depthWrap < 4) {
        const id = `${p.rel}:${name}#${w.index}`;
        if (!wrappers.has(id)) wrappers.set(id, { p, name, index: w.index, via });
        continue;
      }
      if (w && !name) {
        adapters.add(`${p.rel}:${line}`);
        continue;
      }
      // A removal the scan cannot read is a sweep over keys read elsewhere.
      if (k === '*' && removal) continue;
      sites.push({ file: p.rel, line, ...via, key: m ? '*' : k });
    }
  };
  const files = listFiles('src').map(parse).filter((p): p is Parsed => !!p);
  for (const p of files) {
    if (LAYERS.has(p.rel)) continue;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) && KEY_METHODS.has(n.expression.name.text) && n.arguments[0]) {
        const store = storeOf(p, n.expression.expression.text);
        if (store) record(p, n, { store, method: n.expression.name.text }, keys(n.arguments[0], p, new Map()));
      }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) &&
        p.imports.get(n.expression.text)?.from === '@tanstack/query-async-storage-persister') {
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
  // Callers of a wrapper hand it the key: read each call's argument as a site.
  const done = new Set<string>();
  for (let round = 0; round < 4; round++) {
    for (const [id, w] of [...wrappers]) {
      if (done.has(id)) continue;
      done.add(id);
      for (const p of files) {
        const local = p.rel === w.p.rel;
        const importsIt = [...p.imports.values()].some((i) => resolveModule(p.rel, i.from) === w.p.rel);
        if (!local && !importsIt) continue;
        const visit = (n: ts.Node) => {
          if (ts.isCallExpression(n)) {
            const callee = n.expression;
            const head = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
              ? p.imports.get(callee.expression.text) : undefined;
            const imp = ts.isIdentifier(callee) ? p.imports.get(callee.text) : undefined;
            const name = head?.name === '*' && resolveModule(p.rel, head.from) === w.p.rel
              ? (callee as ts.PropertyAccessExpression).name.text
              : !ts.isIdentifier(callee) ? null
              : imp ? (resolveModule(p.rel, imp.from) === w.p.rel ? imp.name : null)
              : local ? callee.text : null;
            const arg = n.arguments[w.index];
            if (name === w.name && arg) record(p, n, w.via, keys(arg, p, new Map()), round + 1);
          }
          ts.forEachChild(n, visit);
        };
        visit(p.sf);
      }
    }
  }
  return { sites, wrappers: [...wrappers.keys()].sort(), adapters: [...adapters].sort() };
}
