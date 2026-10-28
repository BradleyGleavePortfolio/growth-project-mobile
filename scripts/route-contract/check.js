const fs = require('node:fs');
const path = require('node:path');
const { mobileRoutes } = require('./mobile');
function matches(call, route) {
  const [method, pathname] = route.split(' ');
  if (method !== 'ALL' && call.method !== method) return false;
  const server = pathname.split('/');
  const phone = call.path.split('/');
  return server.length === phone.length && server.every((part, i) => part === ':id' || part === phone[i]);
}
function compare(calls, snapshot, allowlist) {
  const lines = snapshot.trim().split('\n');
  if (!/^# backend-main [0-9a-f]{40}$/.test(lines.shift())) throw new Error('Snapshot must identify its backend main head on line 1');
  if (!lines.length || lines.some((line) => !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL) \//.test(line))) throw new Error('Invalid route snapshot');
  const allowed = allowlist.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
    const [method, pathname, caller, pr, ...reason] = line.split('\t');
    const why = reason.join(' ').trim();
    const removalPr = /^https:\/\/github\.com\/BradleyGleavePortfolio\/growth-project-(mobile|backend)\/pull\/\d+$/.test(pr);
    const queuedDeadCaller = pr === 'ROUTE-GAP-1' && /^unreachable on main: .+/i.test(why);
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) || !pathname?.startsWith('/api/')
      || !caller || !(removalPr || queuedDeadCaller) || !why) throw new Error(`Invalid allowlist entry: ${line}`);
    return { method, path: pathname, caller, pr };
  });
  const missing = calls.filter((call) => !lines.some((route) => matches(call, route)));
  const same = (a, b) => a.method === b.method && a.path === b.path && a.caller.split(':')[0] === b.caller;
  const stale = allowed.filter((entry) => !missing.some((call) => same(call, entry)));
  return { missing: missing.filter((call) => !allowed.some((entry) => same(call, entry))), stale, allowed };
}
function main() {
  const calls = mobileRoutes(path.resolve('src'));
  for (const call of calls) console.log(`${call.method} ${call.path}\t${call.caller}`);
  const result = compare(calls, fs.readFileSync(path.join(__dirname, 'backend-routes.txt'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'allowlist.tsv'), 'utf8'));
  for (const call of result.missing) console.error(`MISSING ${call.method} ${call.path}\t${call.caller}`);
  for (const entry of result.stale) console.error(`STALE ALLOWLIST ${entry.method} ${entry.path}\t${entry.caller}`);
  for (const entry of result.allowed) console.log(`KNOWN GAP ${entry.method} ${entry.path}\t${entry.caller}\t${entry.pr}`);
  if (result.missing.length || result.stale.length) process.exitCode = 1;
  console.log(`Route contract: ${calls.length} callers, ${result.missing.length} missing, ${result.allowed.length} allowlisted.`);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { compare, matches };
