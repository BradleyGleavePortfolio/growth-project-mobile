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
const SAVE = /\b(logFood|waterApi\.log|enqueueFoodLog|submit(Search|Manual)Log\w*|repeatPastMeal|logWater)\(|'\/log\/food'|'\/nutrition\/water'/;

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
/** The day each save call carries: which argument, and where in it. */
const DAY_AT: Record<string, [number, string[]]> = {
  submitSearchLogOnline: [0, ['date']], submitSearchLogOffline: [0, ['date']],
  submitManualLogOnline: [0, ['date']], submitManualLogOnlineWithId: [0, ['date']], submitManualLogOffline: [0, ['date']],
  repeatPastMeal: [1, []], logFood: [0, ['date']], enqueueFoodLog: [0, ['log', 'date']], 'waterApi.log': [0, ['date']],
};
const DAY_RULE = ['takeLogDay', 'dayForNewLog'];

const calleeName = (c: ts.CallExpression) => {
  const e = c.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.getText() === 'waterApi.log' ? 'waterApi.log' : e.name.text;
  return '';
};
function eachCall(node: ts.Node, visit: (c: ts.CallExpression) => void) {
  if (ts.isCallExpression(node)) visit(node);
  node.forEachChild((n) => eachCall(n, visit));
}

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
 * Where the day at `path` in `expr` comes from: null when it comes from the day rule (takeLogDay /
 * dayForNewLog), or in a save-layer file from what the save was handed; 'absent' when `expr` has no such
 * field; otherwise the text it comes from.
 */
function dayFrom(expr: ts.Expression, keys: string[], layer: boolean): string | null | 'absent' {
  const e = ts.skipPartiallyEmittedExpressions(expr);
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return dayFrom(e.expression, keys, layer);
  if (keys.length && ts.isObjectLiteralExpression(e)) {
    for (const p of [...e.properties].reverse()) {
      if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === keys[0]) {
        return dayFrom(ts.isPropertyAssignment(p) ? p.initializer : p.name, keys.slice(1), layer);
      }
      if (ts.isSpreadAssignment(p)) {
        const r = dayFrom(p.expression, keys, layer);
        if (r !== 'absent') return r;
      }
    }
    return 'absent';
  }
  if (ts.isPropertyAccessExpression(e)) return dayFrom(e.expression, [e.name.text, ...keys], layer);
  if (ts.isIdentifier(e)) {
    const d = declOf(e.text, e);
    if (!d) return e.text;
    if (ts.isFunctionDeclaration(d)) return e.text;
    if (ts.isParameter(d)) return layer ? null : `${e.text} (a parameter)`;
    if (ts.isBindingElement(d)) {
      const from = d.propertyName?.getText() ?? e.text;
      let top: ts.Node = d.parent.parent;
      const rest = [from, ...keys];
      while (ts.isBindingElement(top)) { rest.unshift(top.propertyName?.getText() ?? top.name.getText()); top = top.parent.parent; }
      if (ts.isParameter(top)) return layer ? null : `${e.text} (a parameter)`;
      const v = top as ts.VariableDeclaration;
      return v.initializer ? dayFrom(v.initializer, rest, layer) : (layer ? null : e.text);
    }
    if (!d.initializer) return layer ? null : e.text; // a stored queue entry: its day was fixed when queued
    return dayFrom(d.initializer, keys, layer);
  }
  if (ts.isCallExpression(e)) {
    const name = calleeName(e);
    if (!keys.length && DAY_RULE.includes(name) && ts.isIdentifier(e.expression)) return null;
    // A helper in the same file that builds the save: follow what it returns.
    const fn = ts.isIdentifier(e.expression) ? declOf(name, e) : undefined;
    const body = fn && ts.isFunctionDeclaration(fn) ? fn.body : undefined;
    if (body && keys.length) {
      const found: Array<string | null | 'absent'> = [];
      eachReturn(body, (r) => found.push(dayFrom(r, keys, layer)));
      const bad = found.find((f) => f !== null);
      return found.length ? (bad === undefined ? null : bad) : e.getText();
    }
    return keys.length ? 'absent' : e.getText();
  }
  // A value the guard cannot read into (planLink(...), a condition) carries no day field.
  return keys.length ? 'absent' : e.getText();
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
  if (!d || !ts.isParameter(d)) return false;
  const fn = d.parent;
  const call = fn.parent;
  return ts.isCallExpression(call) && calleeName(call) === 'withSaveKey' && call.arguments[1] === fn && fn.parameters[0] === d;
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
      .filter((f) => SAVE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
      .sort();
    expect(found).toEqual(Object.keys(SITES).sort());
  });

  it('R3: every food and water save sends the key withSaveKey gave it, in every listed file', () => {
    const wrong = Object.keys(SITES).flatMap((rel) => {
      const out: string[] = [];
      eachCall(parse(rel), (c) => {
        const name = calleeName(c);
        const sends = c.expression.getText() === 'logApi.logFood' || name === 'waterApi.log' || name === 'enqueueFoodLog';
        if (!sends) return;
        const arg = c.arguments[0];
        const key = c.expression.getText() === 'logApi.logFood'
          ? (arg && ts.isObjectLiteralExpression(arg)
            ? ([...arg.properties].reverse().find((p) => p.name?.getText() === 'client_uuid') as ts.PropertyAssignment | undefined)?.initializer
            : undefined)
          : c.arguments[1];
        if (!isSaveKey(key, rel)) out.push(`${rel}: ${c.getText().slice(0, 80)}`);
      });
      return out;
    });
    expect(wrong).toEqual([]);
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
