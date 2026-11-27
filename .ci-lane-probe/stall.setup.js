/**
 * LS-COR-1 stall probe (test-only scratch for a CI lane; never merge).
 *
 * Models one machine stall at the worst moment for a real-time wait: right
 * after a real setTimeout of MIN..MAX ms is armed, the thread is blocked for
 * that long plus 5 ms, so the timer is already due when the event loop turns
 * next. A test that only passes because two steps land inside a timer's
 * window, or because a fixed real wait outlasts work that needs the event
 * loop, goes red under it. Fake timers are untouched (jest replaces this
 * wrapper while they are installed). The waits of the testing library and of
 * jest itself are left alone.
 */
const MIN = Number(process.env.STALL_PROBE_MIN || 5);
const MAX = Number(process.env.STALL_PROBE_MAX || 1000);
const realSetTimeout = global.setTimeout;
const cell = new Int32Array(new SharedArrayBuffer(4));
const stats = { blocks: 0, ms: 0, test: 0, product: 0, lib: 0 };
const SKIP = /node_modules[\\/](@testing-library|jest-[a-z-]+|@jest|expect|react-test-renderer)[\\/]/;

function probeSetTimeout(fn, ms, ...rest) {
  const id = realSetTimeout(fn, ms, ...rest);
  if (typeof ms === 'number' && ms >= MIN && ms <= MAX) {
    const frames = String(new Error().stack || '').split('\n').slice(2);
    const caller = frames[0] || '';
    if (!SKIP.test(caller)) {
      const wait = Math.ceil(ms) + 5;
      Atomics.wait(cell, 0, 0, wait);
      stats.blocks += 1;
      stats.ms += wait;
      if (/\.(test|spec)\.[jt]sx?|__tests__|__fixtures__/.test(caller)) stats.test += 1;
      else if (/node_modules/.test(caller)) stats.lib += 1;
      else stats.product += 1;
    }
  }
  return id;
}
Object.assign(probeSetTimeout, realSetTimeout);
global.setTimeout = probeSetTimeout;

afterAll(() => {
  if (stats.blocks > 0) {
    const file = String(expect.getState().testPath || '').replace(process.cwd(), '');
    process.stderr.write(`STALLPROBE ${file} blocks=${stats.blocks} ms=${stats.ms} test=${stats.test} product=${stats.product} lib=${stats.lib}\n`);
  }
});
