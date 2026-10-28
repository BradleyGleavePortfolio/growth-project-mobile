const path = require('node:path');
const { ts, UNKNOWN, files, walk, context, normalize } = require('./source');
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function mobileRoutes(root) {
  const ctx = context(files(root));
  const routes = [];
  const errors = [];
  for (const source of ctx.sources) {
    const clients = new Set();
    const rawClients = new Set();
    walk(source, (node) => {
      if (ts.isImportDeclaration(node)
        && path.resolve(path.dirname(source.fileName), node.moduleSpecifier.text) === path.join(root, 'services/api')) {
        if (node.importClause?.name) clients.add(node.importClause.name.text);
        for (const binding of node.importClause?.namedBindings?.elements || []) {
          if (binding.propertyName?.text === 'default') clients.add(binding.name.text);
        }
      }
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'axios' && node.importClause?.name) rawClients.add(node.importClause.name.text);
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
        && /^(axios|Axios)\.create$/.test(node.initializer.expression.getText())) clients.add(node.name.getText());
    });
    walk(source, (node) => {
      if (!ts.isVariableDeclaration(node) || !node.initializer) return;
      if (clients.has(node.initializer.getText())) {
        if (!ts.isIdentifier(node.name)) errors.push(`${source.fileName}: destructured client methods need explicit extraction support`);
        else clients.add(node.name.text);
      }
      if (ts.isPropertyAccessExpression(node.initializer) && clients.has(node.initializer.expression.getText())
        && METHODS.has(node.initializer.name.text)) errors.push(`${source.fileName}: detached client method needs explicit extraction support`);
    });
    walk(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const at = `${path.relative(root, source.fileName).split(path.sep).join('/')}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      const expr = node.expression;
      let method;
      let url;
      let direct = false;
      if (ts.isElementAccessExpression(expr) && clients.has(expr.expression.getText())) {
        errors.push(`${at}: computed client method needs explicit extraction support`);
        return;
      }
      if (ts.isPropertyAccessExpression(expr) && rawClients.has(expr.expression.getText()) && METHODS.has(expr.name.text)) {
        // Supabase signed byte transfer, not a Nest server route.
        if (path.relative(root, source.fileName) === 'api/communityVoiceApi.ts'
          && expr.name.text === 'put' && node.arguments[0]?.getText() === 'uploadUrl') return;
        errors.push(`${at}: raw axios transport needs explicit classification`);
        return;
      }
      if (ts.isPropertyAccessExpression(expr) && clients.has(expr.expression.getText())) {
        method = expr.name.text;
        if (METHODS.has(method)) url = node.arguments[0];
        else if (method === 'request') {
          const config = node.arguments[0];
          // The shared interceptor retries the original request, not a new route.
          if (source.fileName.endsWith('/services/api.ts') && config?.getText() === 'originalConfig') return;
          if (config && ts.isObjectLiteralExpression(config)) {
            url = config.properties.find((p) => p.name?.getText() === 'url')?.initializer;
            method = ctx.evaluate(config.properties.find((p) => p.name?.getText() === 'method')?.initializer)[0];
          }
        } else return;
      } else if (ts.isIdentifier(expr) && expr.text === 'fetch') {
        direct = true;
        url = node.arguments[0];
        const config = node.arguments[1];
        method = config && ts.isObjectLiteralExpression(config)
          ? ctx.evaluate(config.properties.find((p) => p.name?.getText() === 'method')?.initializer)[0] : 'get';
        if (method === UNKNOWN) method = 'get';
      } else if (ts.isIdentifier(expr) && clients.has(expr.text)) {
        errors.push(`${at}: callable API client needs an explicit method and URL`);
        return;
      } else return;
      try {
        let values = ctx.evaluate(url);
        if (direct && !values.some((v) => v.startsWith('/api/'))) {
          // Explicitly reviewed non-server byte readers, not server requests.
          const localReaders = {
            'screens/coach/BulkInviteScreen.tsx': 'asset.uri',
            'hooks/useVoiceUpload.ts': 'uri',
            'services/voiceAudio.ts': 'uri',
          };
          if (localReaders[path.relative(root, source.fileName)] === url?.getText()) return;
          if (values.every((v) => /^(file:|blob:|data:)/.test(v))) return;
          throw new Error('fetch target is not statically classified as backend, external or local');
        }
        if (!METHODS.has(method?.toLowerCase())) throw new Error('Unresolved HTTP method');
        for (const value of values) {
          // Injectable ingest transport delegates to this one fixed server path.
          const ingest = source.fileName.endsWith('/services/health/ingestBatching.ts') && value === UNKNOWN && url?.getText() === 'path';
          let ingestPath;
          if (ingest) {
            const delegated = [];
            walk(source, (n) => {
              if (ts.isCallExpression(n) && n.expression.getText() === 'post') delegated.push(...ctx.evaluate(n.arguments[0]));
            });
            if (delegated.length !== 1 || delegated[0] !== '/v1/wearables/samples/ingest') throw new Error('Ingest transport changed');
            ingestPath = `/api${delegated[0]}`;
          }
          if (!ingest && !value.startsWith('/')) throw new Error(`Unresolved URL: ${url?.getText()}`);
          const route = normalize(ingest ? ingestPath : direct ? value : `/api${value}`);
          routes.push({ method: method.toUpperCase(), path: route, caller: at });
        }
      } catch (error) { errors.push(`${at}: ${error.message}`); }
    });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return [...new Map(routes.map((r) => [`${r.method} ${r.path} ${r.caller}`, r])).values()]
    .sort((a, b) => `${a.method} ${a.path} ${a.caller}`.localeCompare(`${b.method} ${b.path} ${b.caller}`));
}
if (require.main === module) {
  try {
    for (const r of mobileRoutes(path.resolve(process.argv[2] || 'src'))) console.log(`${r.method} ${r.path}\t${r.caller}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { mobileRoutes };
