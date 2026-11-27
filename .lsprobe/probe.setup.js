/* LS-FOOD-JOURNEY-SWITCHON-M-1 stall probe (lens-written; local and CI lane only, never on the PR branch).
 * Mode from the test file name: .lsT. block after each debounced type; .lsR. block after each Try again;
 * .lsX. block after both, on the REAL clock; .lsW. watch only; .lsP. or no tag: the probe does nothing. A block is a 500 ms blocked JS
 * thread (Atomics.wait) armed 550 ms after the event: over the 600 ms debounce and the end of the default
 * 1,000 ms wait that follows. T and R arm it on the clock the test holds (real on main's file, the held
 * fake clock on the head). Watch (always, when the clock is fake): foodApi.search's call count read at
 * 599 and 600 held ms after each debounced event, and whether that read came before the next step. */
if (/\.ls[TRXW]\d*\./.test(String(expect.getState().testPath || ''))) (function probe() {
const fs = require('fs');
const path = require('path');
const testPath = String(expect.getState().testPath || '');
const tag = (testPath.match(/\.ls([TRXWP])\d*\./) || [])[1] || 'P';
const TYPES = tag === 'T' || tag === 'X';
const RETRY = tag === 'R' || tag === 'X';
const REAL = tag === 'X';
const realSetTimeout = global.setTimeout;
const cell = new Int32Array(new SharedArrayBuffer(4));
const rntl = require('@testing-library/react-native');
const fe = rntl.fireEvent;
const origChange = fe.changeText;
const origPress = fe.press;
const apiPath = path.join(__dirname, '..', 'src', 'services', 'api');
let step = 0;
const rec = { file: path.basename(testPath), tag, armed: 0, fired: 0, firedOnFake: 0, watch: [] };
const isFake = () => typeof global.setTimeout.clock !== 'undefined';
const calls = () => { try { return require(apiPath).foodApi.search.mock.calls.length; } catch (e) { return -1; } };
function arm() {
  rec.armed += 1;
  const fake = isFake() && !REAL;
  (REAL ? realSetTimeout : global.setTimeout)(() => {
    rec.fired += 1;
    if (fake) rec.firedOnFake += 1;
    Atomics.wait(cell, 0, 0, 500);
  }, 550);
}
function watch(kind, n0, s0) {
  if (!isFake()) return;
  const test = expect.getState().currentTestName;
  const row = { test, kind, n0, n599: null, n600: null, sameStep: null };
  rec.watch.push(row);
  global.setTimeout(() => { row.n599 = calls(); }, 599);
  global.setTimeout(() => { row.n600 = calls(); row.sameStep = step === s0; }, 600);
}
const textOf = (el) => { const c = el && el.props && el.props.children; return typeof c === 'string' ? c : Array.isArray(c) ? c.join('') : ''; };
fe.changeText = async (instance, text) => {
  step += 1;
  const s0 = step;
  const debounced = !!(instance && instance.props && instance.props.placeholder === 'Search foods...' && typeof text === 'string' && text.length >= 2);
  if (debounced && TYPES) arm();
  const n0 = calls();
  const out = await origChange(instance, text);
  if (debounced) watch('type ' + JSON.stringify(text), n0, s0);
  return out;
};
fe.press = async (instance, ...rest) => {
  step += 1;
  const s0 = step;
  const retry = /^(Retry Search|Try again)$/.test(textOf(instance));
  if (retry && RETRY) arm();
  const n0 = calls();
  const out = await origPress(instance, ...rest);
  if (retry) watch('Try again', n0, s0);
  return out;
};
afterAll(() => {
  const ok = rec.watch.filter((r) => r.n599 === r.n0 && r.n600 === r.n0 + 1 && r.sameStep).length;
  const line = 'LSPROBE ' + JSON.stringify({ file: rec.file, tag, armed: rec.armed, fired: rec.fired, firedOnFake: rec.firedOnFake, watchRows: rec.watch.length, watchOk: ok });
  if (process.env.LSP_OUT) fs.writeFileSync(path.join(process.env.LSP_OUT, rec.file + '.json'), JSON.stringify(rec, null, 1));
  process.stdout.write(line + '\n');
});
})();
