/**
 * LS-COR-1 wait probe (test-only scratch for a CI lane; never merge).
 *
 * Measures every waitFor / findBy of the testing library on real timers: how
 * long it really waited against its own timeout. A wait that passes only
 * after a large share of its timeout is waiting on real time (a product
 * timer, a retry delay, a mock delay), so a stall that eats the rest of the
 * margin turns it red. It changes no timing: it only reads the clock when the
 * library arms and clears its timeout timer.
 */
const SHARE = Number(process.env.WAIT_PROBE_SHARE || 0.3);
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
const clock = global.performance;
const open = new Map();
const slow = [];
const FROM_WAIT_FOR = /@testing-library[\\/]react-native[\\/][a-z]+[\\/]wait-for\.[jt]s/;

function probeSetTimeout(fn, ms, ...rest) {
  const id = realSetTimeout(fn, ms, ...rest);
  if (typeof ms === 'number' && ms >= 500) {
    const frames = String(new Error().stack || '').split('\n').slice(2, 5).join('\n');
    if (FROM_WAIT_FOR.test(frames)) {
      open.set(id, { at: clock.now(), ms, test: String(expect.getState().currentTestName || '') });
    }
  }
  return id;
}
function probeClearTimeout(id) {
  const o = open.get(id);
  if (o) {
    open.delete(id);
    const waited = Math.round(clock.now() - o.at);
    if (waited >= o.ms * SHARE) slow.push(`${waited} of ${o.ms} ms :: ${o.test}`);
  }
  return realClearTimeout(id);
}
Object.assign(probeSetTimeout, realSetTimeout);
global.setTimeout = probeSetTimeout;
global.clearTimeout = probeClearTimeout;

afterAll(() => {
  if (slow.length > 0) {
    const file = String(expect.getState().testPath || '').replace(process.cwd(), '');
    for (const line of slow) process.stderr.write(`WAITPROBE ${file} :: ${line}\n`);
  }
});
