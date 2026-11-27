/* FINISH-JOIN-RACE-M scratch stall harness (a ci/ lane only, never merged).
 * Covers the three limits LS-COR-1 named for its stall harness:
 *  - a product setTimeout of 100..1000 ms: the thread blocks 650 ms just before it fires
 *    (a stall in the middle of an awaited step, e.g. inside a waitFor that waits for it);
 *  - a product setTimeout of 1001..5000 ms: the thread blocks (delay + 50) ms right after it is armed;
 *  - a product setInterval of 1000 ms or less: the thread blocks (interval + 50) ms right after it is armed.
 * One stall per timer call site per test (a site re-armed in a loop stalls once).
 * Product = the caller is a src/ file that is not a test. */
const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
const realClearTimeout = global.clearTimeout;
const sideStalls = new Map(); // product timer -> the stall armed for it (cleared with it)
const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const seen = new Set();
beforeEach(() => seen.clear());
const productCaller = (kind) => {
  const caller = String(new Error().stack).split('\n')[3] || '';
  if (!/\/src\//.test(caller) || /__tests__|\.test\.|node_modules|scratch-stall-harness/.test(caller)) return false;
  const key = kind + ' ' + caller;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
};
const tally = { mid: 0, long: 0, interval: 0 };
global.setTimeout = function harnessSetTimeout(fn, ms, ...rest) {
  const id = realSetTimeout(fn, ms, ...rest);
  const d = Number(ms) || 0;
  if (d >= 100 && d <= 1000 && productCaller('mid')) {
    tally.mid += 1;
    const side = realSetTimeout(() => {
      sideStalls.delete(id);
      block(650);
    }, Math.max(d - 5, 0));
    sideStalls.set(id, side);
  } else if (d > 1000 && d <= 5000 && productCaller('long')) {
    tally.long += 1;
    block(d + 50);
  }
  return id;
};
global.clearTimeout = function harnessClearTimeout(id) {
  const side = sideStalls.get(id);
  if (side) {
    sideStalls.delete(id);
    realClearTimeout(side);
  }
  return realClearTimeout(id);
};
afterEach(() => {
  for (const side of sideStalls.values()) realClearTimeout(side);
  sideStalls.clear();
});
global.setInterval = function harnessSetInterval(fn, ms, ...rest) {
  const id = realSetInterval(fn, ms, ...rest);
  const d = Number(ms) || 0;
  if (d > 0 && d <= 1000 && productCaller('interval')) {
    tally.interval += 1;
    block(d + 50);
  }
  return id;
};
jest.setTimeout(60000);
afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(`STALL-HARNESS ${expect.getState().testPath} mid=${tally.mid} long=${tally.long} interval=${tally.interval}`);
});
