/**
 * FOOD-1-M class-first list: every place the phone saves a food or water log (online, queued, retried),
 * with the key it sends and the day rule it calls. A new file that saves a food or water log fails
 * here until it is listed, keyed (R3) and on the shared day rule (R2). FR-916 F3: each save call is read
 * from the parsed file, its day followed back to takeLogDay / dayForNewLog and its key to withSaveKey.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const SRC = path.join(__dirname, '..', '..');
/** Files worth parsing: any that names the save routes, the save calls or the save-layer modules. */
const MENTIONS = /logApi|waterApi|foodLogQueue|logFood|submit(Search|Manual)Log|repeatPastMeal|logWater|\/log\/food|\/nutrition\/water/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : files(p);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const parse = (rel: string) => ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** FR-916 F3: the files that pass on a day and key they were handed; the screens must take theirs. */
const SAVE_LAYER = ['services/api.ts', 'services/foodLogQueue.ts', 'utils/log/logSubmit.ts', 'utils/log/quickLog.ts', 'store/clientStore.ts'];
/** The day each save call carries: which argument, and where in it. Names are the exported names. */
const DAY_AT: Record<string, [number, string[]]> = {
  submitSearchLogOnline: [0, ['date']], submitSearchLogOffline: [0, ['date']],
  submitManualLogOnline: [0, ['date']], submitManualLogOnlineWithId: [0, ['date']], submitManualLogOffline: [0, ['date']],
  repeatPastMeal: [1, []], queuePastMeal: [1, []], logFood: [0, ['date']], 'queue.enqueue': [0, ['log', 'date']], 'waterApi.log': [0, ['date']],
};
/**
 * FR-916R2 F2: save-layer functions that reach a save but take no day: each says where its day comes from.
 * Any other save-layer function that reaches a save must be in DAY_AT, so its callers are checked.
 */
const DAYLESS: Record<string, string> = {
  flush: 'foodLogQueue: sends each queued entry with the day stored when it was queued',
  logWater: 'clientStore: its day is dayForNewLog(get()) inside the store, checked as a waterApi.log call',
};
const DAY_RULE = ['takeLogDay', 'dayForNewLog'];

/** FR-916R2 F2: what each imported name is, so a renamed import (`enqueue as enqueueFoodLog`) is still known. */
const importCache = new WeakMap<ts.SourceFile, Map<string, { name: string; from: string }>>();
function importsOf(sf: ts.SourceFile): Map<string, { name: string; from: string }> {
  const cached = importCache.get(sf);
  if (cached) return cached;
  const out = new Map<string, { name: string; from: string }>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const from = st.moduleSpecifier.text;
    const b = st.importClause.namedBindings;
    if (b && ts.isNamedImports(b)) for (const el of b.elements) out.set(el.name.text, { name: (el.propertyName ?? el.name).text, from });
    if (b && ts.isNamespaceImport(b)) out.set(b.name.text, { name: '*', from });
  }
  importCache.set(sf, out);
  return out;
}
const isQueueModule = (from: string) => /(^|\/)foodLogQueue$/.test(from);
const isSaveModule = (from: string) => /(^|\/)(foodLogQueue|logSubmit|quickLog|api|clientStore)$/.test(from);

/** The save a call makes, by its exported name ('' when it is none of ours). */
function calleeName(c: ts.CallExpression): string {
  const e = c.expression;
  if (ts.isIdentifier(e)) {
    const imp = importsOf(e.getSourceFile()).get(e.text);
    if (imp && isQueueModule(imp.from)) return `queue.${imp.name}`;
    return imp ? imp.name : e.text;
  }
  if (ts.isPropertyAccessExpression(e)) return e.getText() === 'waterApi.log' ? 'waterApi.log' : e.name.text;
  return '';
}
function eachCall(node: ts.Node, visit: (c: ts.CallExpression) => void) {
  if (ts.isCallExpression(node)) visit(node);
  node.forEachChild((n) => eachCall(n, visit));
}
function eachNode(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  node.forEachChild((n) => eachNode(n, visit));
}
const isCallee = (n: ts.Node) => ts.isCallExpression(n.parent) && n.parent.expression === n;
const sendsFood = (c: ts.CallExpression) => calleeName(c) === 'logFood';
const sendsKeyArg = (c: ts.CallExpression) => calleeName(c) === 'waterApi.log' || calleeName(c) === 'queue.enqueue';
/** The saves a file can call by name (flush only sends what the queue already holds, with its key and day). */
const SAVE_NAMES = new Set([...Object.keys(DAY_AT), 'logWater']);
const isRoute = (n: ts.Node) => ts.isStringLiteralLike(n) && /^\/(log\/food|nutrition\/water)$/.test(n.text);
const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ? unwrap(e.expression) : e;

type Decl = ts.VariableDeclaration | ts.BindingElement | ts.ParameterDeclaration | ts.FunctionDeclaration;
/** The declaration `name` refers to at `at`, searching the enclosing blocks and functions outward. */
function declOf(name: string, at: ts.Node): Decl | undefined {
  const named = (b: ts.BindingName): Array<ts.Identifier> => ts.isIdentifier(b) ? [b]
    : (b.elements as ts.NodeArray<ts.ArrayBindingElement>).flatMap((e) => ts.isBindingElement(e) ? named(e.name) : []);
  const inBinding = (b: ts.BindingName) => named(b).find((i) => i.text === name);
  for (let n: ts.Node | undefined = at.parent; n; n = n.parent) {
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      for (const st of n.statements) {
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            const id = inBinding(d.name);
            if (id) return id.parent as Decl;
          }
        }
        if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
      }
    }
    if (ts.isFunctionLike(n)) {
      for (const p of n.parameters) {
        const id = inBinding(p.name);
        if (id) return id.parent as Decl;
      }
    }
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && ts.isVariableDeclarationList(n.initializer)) {
      for (const d of n.initializer.declarations) {
        const id = inBinding(d.name);
        if (id) return id.parent as Decl;
      }
    }
  }
  return undefined;
}

/**
 * FR-916R2 F2: whether the value `d` declares is changed after it was taken: assigned again (`date = …`,
 * `({ date } = …)`, `date++`), a field of it assigned or deleted (`args.date = …`), or handed to Object.assign.
 */
function isWritten(d: Decl): boolean {
  const name = ts.isFunctionDeclaration(d) ? d.name?.text : ts.isIdentifier(d.name) ? d.name.text : undefined;
  if (!name) return false;
  const root = (e: ts.Expression): ts.Expression => {
    let x = unwrap(e);
    while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = unwrap(x.expression);
    return x;
  };
  const targets = (e: ts.Expression): ts.Expression[] => {
    const x = unwrap(e);
    if (ts.isObjectLiteralExpression(x)) return x.properties.flatMap((p) => ts.isShorthandPropertyAssignment(p) ? [p.name]
      : ts.isPropertyAssignment(p) ? targets(p.initializer) : ts.isSpreadAssignment(p) ? targets(p.expression) : []);
    if (ts.isArrayLiteralExpression(x)) return x.elements.flatMap((el) => targets(ts.isSpreadElement(el) ? el.expression : el));
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken) return targets(x.left);
    return [root(x)];
  };
  let written = false;
  const hit = (e: ts.Expression) => targets(e).forEach((t) => {
    if (ts.isIdentifier(t) && t.text === name && declOf(name, t) === d) written = true;
  });
  eachNode(d.getSourceFile(), (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) hit(n.left);
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n))
      && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) hit(n.operand);
    if (ts.isDeleteExpression(n)) hit(n.expression);
    if (ts.isCallExpression(n) && n.expression.getText() === 'Object.assign' && n.arguments[0]) hit(n.arguments[0]);
  });
  return written;
}

/** The takeLogDay helpers being followed now (a helper that calls itself fails, never loops). */
const resolving = new Set<ts.Node>();
function insideNestedFunction(n: ts.Node, outer: ts.Node): boolean {
  for (let p = n.parent; p && p !== outer; p = p.parent) if (ts.isFunctionLike(p)) return true;
  return false;
}

/** FR-916R2 F2: a call of the day rule itself, not a stand-in of the same name. */
function isDayRule(c: ts.CallExpression): boolean {
  if (!ts.isIdentifier(c.expression) || !DAY_RULE.includes(c.expression.text)) return false;
  const name = c.expression.text;
  const d = declOf(name, c);
  if (name === 'dayForNewLog') {
    const imp = importsOf(c.getSourceFile()).get(name);
    return !d && imp?.name === 'dayForNewLog' && /(^|\/)logDay$/.test(imp.from);
  }
  // takeLogDay: LogScreen's own, a const arrow that returns what dayForNewLog gave it.
  if (!d || !ts.isVariableDeclaration(d) || isWritten(d) || !d.initializer || !ts.isArrowFunction(d.initializer)) return false;
  // FR-916R3 F1: every day the helper can return is the rule's result, not merely a rule call somewhere in
  // its body. Each return (nested functions aside) must resolve to the rule; a bare `return;`, falling off
  // the end, or a return the guard cannot follow (a ref, another helper, the helper calling itself) fails.
  const fn = d.initializer;
  if (resolving.has(fn)) return false;
  resolving.add(fn);
  try {
    if (!ts.isBlock(fn.body)) return dayFrom(fn.body, [], false) === null;
    const last = fn.body.statements[fn.body.statements.length - 1];
    if (!last || !ts.isReturnStatement(last) || !last.expression) return false;
    let bare = false;
    eachNode(fn.body, (n) => { if (ts.isReturnStatement(n) && !n.expression && !insideNestedFunction(n, fn)) bare = true; });
    if (bare) return false;
    const found: Array<string | null | 'absent'> = [];
    eachReturn(fn.body, (r) => found.push(dayFrom(r, [], false)));
    return found.length > 0 && found.every((f) => f === null);
  } finally {
    resolving.delete(fn);
  }
}

/**
 * Where the day at `path` in `expr` comes from: null when it comes from the day rule (takeLogDay /
 * dayForNewLog), or in a save-layer file from what the save was handed; 'absent' when `expr` has no such
 * field; otherwise the text it comes from. FR-916R2 F2: anything the guard cannot read is the text it
 * comes from (a failure), never a pass.
 */
function dayFrom(expr: ts.Expression, keys: string[], layer: boolean): string | null | 'absent' {
  const e = ts.skipPartiallyEmittedExpressions(expr);
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) {
    return dayFrom(e.expression, keys, layer);
  }
  if (keys.length && ts.isObjectLiteralExpression(e)) {
    for (const p of [...e.properties].reverse()) {
      if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === keys[0]) {
        return dayFrom(ts.isPropertyAssignment(p) ? p.initializer : p.name, keys.slice(1), layer);
      }
      if (ts.isSpreadAssignment(p)) {
        const r = dayFrom(p.expression, keys, layer);
        if (r !== 'absent') return r;
      } else if (p.name?.getText() === keys[0] || (p.name && ts.isComputedPropertyName(p.name))) {
        return p.getText(); // a getter, a method or a computed name the guard cannot read
      }
    }
    return 'absent';
  }
  if (ts.isConditionalExpression(e)) {
    const both = [dayFrom(e.whenTrue, keys, layer), dayFrom(e.whenFalse, keys, layer)];
    const bad = both.find((b) => b !== null && b !== 'absent');
    if (bad !== undefined) return bad;
    return both[0] === both[1] ? both[0] : `${e.getText()} (a day on one branch only)`;
  }
  if (ts.isPropertyAccessExpression(e)) return dayFrom(e.expression, [e.name.text, ...keys], layer);
  if (ts.isIdentifier(e)) {
    const d = declOf(e.text, e);
    if (!d) return e.text;
    if (ts.isFunctionDeclaration(d)) return e.text;
    if (isWritten(d)) return `${e.text} (written again after it was taken)`;
    if (ts.isParameter(d)) return layer ? null : `${e.text} (a parameter)`;
    if (ts.isBindingElement(d)) {
      const from = d.propertyName?.getText() ?? e.text;
      let top: ts.Node = d.parent.parent;
      const rest = [from, ...keys];
      while (ts.isBindingElement(top)) {
        if (isWritten(top)) return `${e.text} (written again after it was taken)`;
        rest.unshift(top.propertyName?.getText() ?? top.name.getText());
        top = top.parent.parent;
      }
      if (ts.isParameter(top)) return layer && !isWritten(top) ? null : `${e.text} (a parameter)`;
      const v = top as ts.VariableDeclaration;
      return v.initializer ? dayFrom(v.initializer, rest, layer) : (layer ? null : e.text);
    }
    if (!d.initializer) return layer ? null : e.text; // a stored queue entry: its day was fixed when queued
    return dayFrom(d.initializer, keys, layer);
  }
  if (ts.isCallExpression(e)) {
    if (!keys.length && isDayRule(e)) return null;
    // planLink(...) (utils/log/planLink) sends only plan_slot_id / fills_usual_meal, never a day.
    if (keys.length && ts.isIdentifier(e.expression) && e.expression.text === 'planLink'
      && /(^|\/)planLink$/.test(importsOf(e.getSourceFile()).get('planLink')?.from ?? '')) return 'absent';
    // A helper in the same file that builds the save: follow what it returns.
    const fn = ts.isIdentifier(e.expression) ? declOf(e.expression.text, e) : undefined;
    const body = fn && ts.isFunctionDeclaration(fn) ? fn.body : undefined;
    if (body && keys.length) {
      const found: Array<string | null | 'absent'> = [];
      eachReturn(body, (r) => found.push(dayFrom(r, keys, layer)));
      const bad = found.find((f) => f !== null);
      return found.length ? (bad === undefined ? null : bad) : e.getText();
    }
    return e.getText();
  }
  return e.getText();
}
function eachReturn(node: ts.Node, visit: (e: ts.Expression) => void) {
  if (ts.isReturnStatement(node) && node.expression) visit(node.expression);
  if (!ts.isFunctionLike(node)) node.forEachChild((n) => eachReturn(n, visit));
}

/** Whether `key` is the key withSaveKey handed to this save (or, in the queue, the queued entry's id). */
function isSaveKey(key: ts.Expression | undefined, rel: string): boolean {
  if (!key) return false;
  if (rel === 'services/foodLogQueue.ts' && key.getText() === 'item.id') return true;
  if (!ts.isIdentifier(key)) return false;
  const d = declOf(key.text, key);
  if (!d || !ts.isParameter(d) || isWritten(d)) return false;
  const fn = d.parent;
  const call = fn.parent;
  return ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'withSaveKey'
    && !declOf('withSaveKey', call) && /(^|\/)saveKey$/.test(importsOf(call.getSourceFile()).get('withSaveKey')?.from ?? '')
    && call.arguments[1] === fn && fn.parameters[0] === d;
}

/**
 * FR-916R2 F2: every place a file reaches a save other than by calling it by name: logApi / waterApi
 * taken whole or by a bracket, logFood or waterApi.log taken out of its call (`const { logFood: send } =
 * logApi`), a save helper renamed or passed on, the queue or save modules imported whole, a save route
 * written out. Each is a save the guard could not follow, so each fails.
 */
function escapes(sf: ts.SourceFile, rel: string): string[] {
  const out: string[] = [];
  const imports = importsOf(sf);
  const defines = (n: ts.Identifier) => SAVE_LAYER.includes(rel) && (ts.isPropertyAssignment(n.parent) || ts.isPropertySignature(n.parent)
    || ts.isMethodDeclaration(n.parent) || ts.isFunctionDeclaration(n.parent)
    || (ts.isVariableDeclaration(n.parent) && n.parent.name === n)) && (n.parent as ts.NamedDeclaration).name === n;
  eachNode(sf, (n) => {
    if (isRoute(n) && rel !== 'services/api.ts') out.push(`${rel}: the save route ${n.getText()} written out`);
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isSaveModule(n.moduleSpecifier.text)
      && n.importClause?.namedBindings && ts.isNamespaceImport(n.importClause.namedBindings)) {
      out.push(`${rel}: ${n.getText()} (a save module imported whole)`);
    }
    if (!ts.isIdentifier(n) || ts.isImportSpecifier(n.parent)) return;
    const p = n.parent;
    const imp = imports.get(n.text);
    if (n.text === 'logApi' || n.text === 'waterApi') {
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        if (p.name.text === (n.text === 'logApi' ? 'logFood' : 'log') && !isCallee(p)) out.push(`${rel}: ${p.parent.getText().slice(0, 80)} (a save taken out of its call)`);
        return;
      }
      if (!(rel === 'services/api.ts' && ts.isVariableDeclaration(p) && p.name === n)) out.push(`${rel}: ${p.getText().slice(0, 80)} (${n.text} taken whole)`);
      return;
    }
    const save = n.text === 'logFood' ? 'logFood' : imp && isQueueModule(imp.from) && imp.name === 'enqueue' ? 'queue.enqueue'
      : SAVE_NAMES.has(imp?.name ?? n.text) ? (imp?.name ?? n.text) : '';
    if (!save) return;
    if (ts.isPropertyAccessExpression(p) && p.name === n) {
      if (!isCallee(p)) out.push(`${rel}: ${p.parent.getText().slice(0, 80)} (a save taken out of its call)`);
      return;
    }
    if (isCallee(n) || defines(n)) return;
    // `const { logWater } = useClientStore()`: the store's save under its own name, called by that name below.
    if (save !== 'logFood' && ts.isBindingElement(p) && p.name === n && (!p.propertyName || p.propertyName.getText() === n.text)) return;
    if (ts.isExportSpecifier(p)) return;
    out.push(`${rel}: ${p.getText().slice(0, 80)} (a save taken out of its call)`);
  });
  eachNode(sf, (n) => {
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)
      && ['logFood', 'log', 'enqueue'].includes(n.argumentExpression.text)) out.push(`${rel}: ${n.getText().slice(0, 80)} (a save by a bracket)`);
  });
  return out;
}

/** Whether a file saves a food or water log in any form (a call, a reference, a route). */
function savesHere(rel: string): boolean {
  const sf = parse(rel);
  const imports = importsOf(sf);
  let saves = false;
  eachNode(sf, (n) => {
    if (isRoute(n)) saves = true;
    if (ts.isStringLiteralLike(n) && n.text === 'logFood') saves = true;
    if (!ts.isIdentifier(n) || saves) return;
    const imp = imports.get(n.text);
    // A style of the same name (`styles.logFood`, `logFood: { … }` in a style sheet) is not a save.
    const style = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n && n.parent.expression.getText() !== 'logApi' && !isCallee(n.parent)
      || ts.isPropertyAssignment(n.parent) && n.parent.name === n && ts.isObjectLiteralExpression(n.parent.initializer);
    if (n.text === 'logFood') saves = !style;
    else if ((imp && isQueueModule(imp.from) && (imp.name === 'enqueue' || imp.name === '*'))) saves = true;
    else if (SAVE_NAMES.has(imp?.name ?? n.text)) saves = true;
    else if ((n.text === 'logApi' || n.text === 'waterApi') && !ts.isImportSpecifier(n.parent)
      && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && !(n.text === 'waterApi' && n.parent.name.text === 'log'))) saves = true;
  });
  return saves;
}

/**
 * FR-916R2 F2: the save-layer functions (named functions, consts and object members) that reach a save:
 * call one, call a save-layer helper that does, or post a save route.
 */
function reachingSaves(sf: ts.SourceFile): string[] {
  const fns: Array<{ name: string; qualified: string; body: ts.Node }> = [];
  eachNode(sf, (n) => {
    const fnInit = (e?: ts.Expression) => e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) ? e : undefined;
    if (ts.isFunctionDeclaration(n) && n.name && n.body) fns.push({ name: n.name.text, qualified: n.name.text, body: n.body });
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && fnInit(n.initializer)) fns.push({ name: n.name.text, qualified: n.name.text, body: n.initializer! });
    if ((ts.isPropertyAssignment(n) && fnInit(n.initializer)) || ts.isMethodDeclaration(n)) {
      const name = n.name.getText();
      const owner = n.parent.parent;
      const qualified = ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name) ? `${owner.name.text}.${name}` : name;
      fns.push({ name, qualified, body: n });
    }
  });
  const reaching = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const f of fns) {
      if (reaching.has(f.qualified)) continue;
      let hit = false;
      eachNode(f.body, (n) => {
        if (isRoute(n)) hit = true;
        if (ts.isCallExpression(n)) {
          const c = calleeName(n);
          if (sendsFood(n) || sendsKeyArg(n) || SAVE_NAMES.has(c) || fns.some((g) => g !== f && g.name === c && reaching.has(g.qualified))) hit = true;
        }
      });
      if (hit) { reaching.add(f.qualified); grew = true; }
    }
  }
  const known = (n: string) => SAVE_NAMES.has(n) || Object.prototype.hasOwnProperty.call(DAYLESS, n);
  return fns.filter((f) => reaching.has(f.qualified) && !known(f.qualified) && !known(f.name)).map((f) => f.qualified);
}

// file | what it saves | key (R3) | day (R2) | behaviour test
const SITES: Record<string, string> = {
  'services/api.ts': 'the two routes: logApi.logFood (client_uuid + Idempotency-Key header), waterApi.log (header)',
  'services/foodLogQueue.ts': 'queued food, flushed and retried: key = the entry id (made at the tap or handed on from the online try)',
  'utils/log/logSubmit.ts': 'search and manual food, online and queued: withSaveKey (food1mSaveKeys.test.ts)',
  'utils/log/quickLog.ts': 'a repeated past meal, one save per food: withSaveKey (food1mSaveKeys.test.ts)',
  'store/clientStore.ts': 'logWater (and logFood, no app caller): withSaveKey; logWater day: dayForNewLog (LogScreen.food1mMidnight.test.tsx)',
  'screens/client/LogScreen.tsx': 'search, manual, plan and repeat food, and water through the store: day takeLogDay -> dayForNewLog (LogScreen.food1mMidnight.test.tsx, loFoodNextMorning)',
  'components/mealplan/LogPlannedMealButton.tsx': 'a plan meal, online or queued: logSubmit keys; day dayForNewLog() (LogPlannedMealButton.test.tsx)',
  'components/home/rings/HomeTiles.tsx': 'a glass of water through store.logWater (key and day in the store)',
};

describe('FOOD-1-M every food and water save', () => {
  it('lists every file that saves a food or water log', () => {
    const found = files(SRC)
      .filter((f) => MENTIONS.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
      .filter(savesHere)
      .sort();
    expect(found).toEqual(Object.keys(SITES).sort());
  });

  it('FR-916R2 F2: every save is called by its own name, never taken out of its call, renamed or passed on', () => {
    expect(Object.keys(SITES).flatMap((rel) => escapes(parse(rel), rel))).toEqual([]);
  });

  it('FR-916R2 F2: every save-layer function that reaches a save is one the day rule checks (DAY_AT) or says where its day comes from (DAYLESS)', () => {
    expect(SAVE_LAYER.flatMap((rel) => reachingSaves(parse(rel)).map((name) => `${rel}: ${name}`))).toEqual([]);
  });

  it('R3: every food and water save sends the key withSaveKey gave it, in every listed file', () => {
    let checked = 0;
    const wrong = Object.keys(SITES).flatMap((rel) => {
      const out: string[] = [];
      eachCall(parse(rel), (c) => {
        if (!sendsFood(c) && !sendsKeyArg(c)) return;
        checked += 1;
        let key: ts.Expression | undefined = c.arguments[1];
        if (sendsFood(c)) {
          // The key is the body's last client_uuid, with nothing spread after it that could put another.
          const arg = c.arguments[0];
          const props = arg && ts.isObjectLiteralExpression(arg) ? [...arg.properties] : [];
          const at = props.map((p) => p.name?.getText()).lastIndexOf('client_uuid');
          const p = props[at];
          key = at >= 0 && !props.slice(at + 1).some((q) => ts.isSpreadAssignment(q) || !q.name || ts.isComputedPropertyName(q.name))
            ? (p && ts.isPropertyAssignment(p) ? p.initializer : p && ts.isShorthandPropertyAssignment(p) ? p.name : undefined)
            : undefined;
        }
        if (!isSaveKey(key, rel)) out.push(`${rel}: ${c.getText().slice(0, 80)}`);
      });
      return out;
    });
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('R2: every save takes its day from the shared rule, never the stale screen day or a raw today, in every listed file', () => {
    expect(read('screens/client/LogScreen.tsx')).toContain('dayForNewLog({ selectedDate, selectedOn })');
    let checked = 0;
    const wrong = Object.keys(SITES).flatMap((rel) => {
      const out: string[] = [];
      const layer = SAVE_LAYER.includes(rel);
      eachCall(parse(rel), (c) => {
        const at = Object.prototype.hasOwnProperty.call(DAY_AT, calleeName(c)) ? DAY_AT[calleeName(c)] : undefined;
        if (!at) return;
        checked += 1;
        const arg = c.arguments[at[0]];
        const from = arg ? dayFrom(arg, at[1], layer) : 'absent';
        if (from !== null) out.push(`${rel}: ${c.getText().slice(0, 80)} -> day from ${from}`);
      });
      return out;
    });
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(14);
  });
});
