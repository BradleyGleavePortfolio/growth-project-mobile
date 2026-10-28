const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ts, UNKNOWN, files, walk, context, normalize } = require('./source');
const VERBS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All']);
function backendRoutes(root, report = () => {}) {
  const ctx = context(files(path.join(root, 'src')));
  const routes = [];
  let prefix = '';
  const excluded = [];
  const val = (node) => {
    const out = ctx.evaluate(node);
    if (out.some((v) => v.includes(UNKNOWN))) throw new Error(`Unresolved backend route: ${node?.getText()}`);
    return out;
  };
  const prop = (node, name) => node?.properties?.find((p) => p.name?.getText().replace(/['"]/g, '') === name)?.initializer;
  function exclusions(node) {
    if (!node) return;
    if (ts.isArrayLiteralExpression(node)) return node.elements.forEach(exclusions);
    if (ts.isSpreadElement(node)) return exclusions(ctx.resolve(node.expression)?.initializer);
    if (ts.isObjectLiteralExpression(node)) {
      const method = prop(node, 'method')?.getText().split('.').pop();
      for (const value of val(prop(node, 'path'))) excluded.push({ path: normalize(`/${value}`), method });
    } else for (const value of val(node)) excluded.push({ path: normalize(`/${value}`) });
  }
  for (const source of ctx.sources) walk(source, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === 'setGlobalPrefix') {
        prefix = val(node.arguments[0])[0];
        exclusions(prop(node.arguments[1], 'exclude'));
      }
      if (node.expression.name.text === 'enableVersioning') throw new Error('Versioned routes need generator support');
      if (node.expression.getText() === 'RouterModule.register') throw new Error('RouterModule prefixes need generator support');
    }
  });
  function decorator(node, names) {
    return (ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : [])
      .map((d) => d.expression).filter((d) => ts.isCallExpression(d) && names.has(d.expression.getText()));
  }
  const controllers = new Set();
  const visited = new Set();
  function modules(expr) {
    if (!expr) return;
    if (ts.isArrayLiteralExpression(expr)) return expr.elements.forEach(modules);
    if (ts.isSpreadElement(expr)) return modules(ctx.resolve(expr.expression)?.initializer);
    if (ts.isCallExpression(expr)) {
      if (expr.expression.getText() === 'forwardRef') return modules(expr.arguments[0]?.body);
      // Nest infrastructure packages do not declare this application's controllers.
      const target = ts.isPropertyAccessExpression(expr.expression) ? expr.expression.expression : expr.expression;
      const resolved = ctx.resolve(target);
      if (resolved && ts.isImportSpecifier(resolved)) {
        let imp = resolved;
        while (imp && !ts.isImportDeclaration(imp)) imp = imp.parent;
        if (imp?.moduleSpecifier.text.startsWith('@nestjs/')) return;
      }
      throw new Error(`Unsupported dynamic module: ${expr.getText()}`);
    }
    const cls = ctx.resolve(expr);
    if (!cls || !ts.isClassDeclaration(cls)) {
      if (cls?.initializer) return modules(cls.initializer);
      // External infrastructure modules have no local controller definitions.
      if (cls && ts.isImportSpecifier(cls)) {
        let imp = cls;
        while (imp && !ts.isImportDeclaration(imp)) imp = imp.parent;
        if (imp?.moduleSpecifier.text.startsWith('@nestjs/')) return;
      }
      throw new Error(`Unresolved module: ${expr.getText()}`);
    }
    if (visited.has(cls)) return;
    visited.add(cls);
    const meta = decorator(cls, new Set(['Module']))[0]?.arguments[0];
    if (!meta) throw new Error(`Module metadata missing: ${cls.name.text}`);
    modules(prop(meta, 'imports'));
    const declared = prop(meta, 'controllers');
    if (declared) {
      if (!ts.isArrayLiteralExpression(declared)) throw new Error('Dynamic controller array needs generator support');
      for (const controller of declared.elements) {
        const target = ctx.resolve(controller);
        if (!target || !ts.isClassDeclaration(target)) throw new Error(`Unresolved controller: ${controller.getText()}`);
        controllers.add(target);
      }
    }
  }
  const app = ctx.sources.find((s) => s.fileName === path.join(root, 'src/app.module.ts'));
  if (!app) throw new Error('Missing AppModule');
  const appClass = app.statements.find((n) => ts.isClassDeclaration(n) && n.name?.text === 'AppModule');
  modules(appClass);
  const unmounted = [];
  for (const source of ctx.sources) walk(source, (node) => {
    if (ts.isClassDeclaration(node) && decorator(node, new Set(['Controller'])).length && !controllers.has(node)) {
      unmounted.push(`${path.relative(root, source.fileName)} (${node.name?.text})`);
    }
  });
  report(unmounted.sort());
  for (const source of ctx.sources) walk(source, (node) => {
    if (!controllers.has(node)) return;
    for (const controller of decorator(node, new Set(['Controller']))) {
      const arg = controller.arguments[0];
      const bases = arg ? val(ts.isObjectLiteralExpression(arg) ? prop(arg, 'path') : arg) : [''];
      if (arg && ts.isObjectLiteralExpression(arg) && prop(arg, 'version')) throw new Error('Controller version needs generator support');
      for (const member of node.members) for (const route of decorator(member, VERBS)) {
        const method = route.expression.getText().toUpperCase();
        const paths = route.arguments.length ? val(route.arguments[0]) : [''];
        for (const base of bases) for (const leaf of paths) {
          const local = normalize(`/${[base, leaf].filter(Boolean).join('/')}`);
          const bare = excluded.some((e) => e.path === local && (!e.method || e.method === method || e.method === 'ALL'));
          routes.push(`${method} ${bare || !prefix ? local : normalize(`/${prefix}${local === '/' ? '' : local}`)}`);
        }
      }
    }
  });
  if (!routes.length) throw new Error('No backend routes found');
  return [...new Set(routes)].sort();
}
function snapshot(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  if (head !== git('rev-parse', 'origin/main')) throw new Error('Backend checkout must be at origin/main');
  if (git('status', '--porcelain', '--', 'src')) throw new Error('Backend src must be clean');
  return `# backend-main ${head}\n${backendRoutes(root).join('\n')}\n`;
}
if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/route-contract/backend.js <backend-checkout> [output]');
    if (process.argv[3] === '--unmounted') {
      backendRoutes(path.resolve(process.argv[2]), (unmounted) => console.log(unmounted.join('\n')));
    } else {
    const output = snapshot(path.resolve(process.argv[2]));
    if (process.argv[3]) fs.writeFileSync(process.argv[3], output);
    else process.stdout.write(output);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { backendRoutes, snapshot };
