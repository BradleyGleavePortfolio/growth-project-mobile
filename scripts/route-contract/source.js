// Static route evaluation only. Never imports or executes application code.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const UNKNOWN = '\u00a7';
function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (/^(node_modules|\.git|__tests__|__mocks__|fixtures|e2e)$/.test(entry.name)) return [];
    const name = path.join(root, entry.name);
    return entry.isDirectory() ? files(name)
      : /\.[cm]?[jt]sx?$/.test(name) && !/\.(test|spec|d)\.[cm]?[jt]sx?$/.test(name) ? [name] : [];
  }).sort();
}
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
function context(names) {
  const program = ts.createProgram(names, { noLib: true, noResolve: true, allowJs: true, target: ts.ScriptTarget.Latest });
  const checker = program.getTypeChecker();
  const sources = names.map((name) => program.getSourceFile(name));
  const symbol = (node) => checker.getSymbolAtLocation(node);
  function declaration(node) {
    let decl = symbol(node)?.valueDeclaration || symbol(node)?.declarations?.[0];
    if (decl && (ts.isImportSpecifier(decl) || ts.isImportClause(decl))) {
      let imp = decl;
      while (imp && !ts.isImportDeclaration(imp)) imp = imp.parent;
      const module = imp?.moduleSpecifier;
      if (!module || !module.text.startsWith('.')) return decl;
      const base = path.resolve(path.dirname(node.getSourceFile().fileName), module.text);
      const source = sources.find((s) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].includes(s.fileName));
      const name = ts.isImportSpecifier(decl) ? (decl.propertyName || decl.name).text : 'default';
      if (source) {
        let found;
        walk(source, (n) => {
          if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)
            || ts.isTypeAliasDeclaration(n)) && n.name?.text === name) found = n;
        });
        if (found) decl = found;
      }
    }
    return decl;
  }
  function resolve(node) {
    if (!node) return undefined;
    if (ts.isIdentifier(node)) return declaration(node);
    if (ts.isPropertyAccessExpression(node)) {
      let owner = resolve(node.expression);
      if (owner?.initializer) owner = owner.initializer;
      while (owner && (ts.isAsExpression(owner) || ts.isParenthesizedExpression(owner) || ts.isSatisfiesExpression(owner))) owner = owner.expression;
      if (owner && ts.isObjectLiteralExpression(owner)) {
        return owner.properties.find((p) => p.name?.getText().replace(/['"]/g, '') === node.name.text);
      }
    }
    return node;
  }
  const join = (a, b) => [...new Set(a.flatMap((x) => b.map((y) => x + y)))];
  function evaluate(node, bindings = new Map(), seen = new Set()) {
    if (!node || seen.has(node)) return [UNKNOWN];
    seen = new Set(seen).add(node);
    const ev = (n, b = bindings) => evaluate(n, b, seen);
    if (bindings.has(node)) return bindings.get(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((n) => ev(n));
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return ev(node.expression);
    if (ts.isConditionalExpression(node)) return [...new Set([...ev(node.whenTrue), ...ev(node.whenFalse)])];
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return join(ev(node.left), ev(node.right));
      if ([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) return [...ev(node.left), ...ev(node.right)];
    }
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.reduce((out, span) => join(join(out, ev(span.expression)), [span.literal.text]), [node.head.text]);
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      // API_URL already includes the global /api prefix.
      if (/^(env\.API_URL|API_BASE)$/.test(node.getText())) return ['/api'];
      const decl = resolve(node);
      if (bindings.has(decl)) return bindings.get(decl);
      if (decl && decl !== node) {
        if (decl.initializer) {
          if (ts.isVariableDeclaration(decl) && !(decl.parent.flags & ts.NodeFlags.Const)) {
            throw new Error(`Mutable route binding needs explicit support: ${decl.name.getText()}`);
          }
          return ev(decl.initializer);
        }
        if (ts.isParameter(decl) && decl.type) {
          const literals = [];
          const type = ts.isTypeReferenceNode(decl.type) ? resolve(decl.type.typeName)?.type : decl.type;
          if (type && (ts.isUnionTypeNode(type) || ts.isLiteralTypeNode(type))) {
            walk(type, (n) => { if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) literals.push(n.literal.text); });
          }
          if (literals.length) return literals;
        }
      }
    }
    if (ts.isCallExpression(node)) {
      if (['encodeURIComponent', 'String'].includes(node.expression.getText())) return ev(node.arguments[0]);
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'replace'
        && node.arguments[0]?.getText() === '/\\/$/' && node.arguments[1]?.getText() === "''") {
        return ev(node.expression.expression).map((v) => v.replace(/\/$/, ''));
      }
      let fn = resolve(node.expression);
      if (fn?.initializer) fn = fn.initializer;
      if (fn && ts.isFunctionLike(fn) && fn.body) {
        const next = new Map(bindings);
        fn.parameters.forEach((p, i) => next.set(p, node.arguments[i] ? ev(node.arguments[i]) : ev(p.initializer)));
        if (!ts.isBlock(fn.body)) return ev(fn.body, next);
        const results = [];
        function returns(n) {
          if (ts.isReturnStatement(n) && n.expression) results.push(...ev(n.expression, next));
          else if (!ts.isFunctionLike(n)) ts.forEachChild(n, returns);
        }
        ts.forEachChild(fn.body, returns);
        if (results.length) return [...new Set(results)];
      }
    }
    return [UNKNOWN];
  }
  return { sources, evaluate, resolve, declaration };
}
function normalize(value) {
  const clean = value.split(/[?#&]/)[0].replace(/\/+$/, '') || '/';
  const result = clean.split('/').map((part) => {
    if (part === UNKNOWN || /^:[\w]+$/.test(part)) return ':id';
    if (part.includes(UNKNOWN)) throw new Error(`Unresolved partial path segment: ${value}`);
    return part;
  }).join('/');
  if (!result.startsWith('/')) throw new Error(`Unresolved route: ${value}`);
  return result;
}
module.exports = { ts, UNKNOWN, files, walk, context, normalize };
