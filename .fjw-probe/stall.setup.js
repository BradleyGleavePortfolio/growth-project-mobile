/* FOOD-JOURNEY-WAITS-M stall probe: a probe file only, never part of the PR.
 * CI-lane copy: the probe arms only in the probeFixNN and probeMainNN copies; the besideNN copies run plain.
 * Loaded with --setupFilesAfterEnv after jest.setup.js. After every fireEvent.changeText on the
 * food search box that arms LogScreen's 600 ms search debounce (a query of 2+ characters,
 * LogScreen.tsx:250-306), the JS thread is blocked for STALL_MS (500) starting STALL_AT_MS (550)
 * later, so the block straddles the debounce (due at 600 ms) and the end of the default 1000 ms
 * wait that follows the type (due at about 1000 ms). The block is armed on the clock the test
 * holds at the moment of the type: global setTimeout (real timers on main's file; jest's held
 * clock where the test holds one). STALL_CLOCK=real arms it on the real clock in both. */
const PROBED = /foodJourney\.probe(Fix|Main)\d+\.test/.test(String(expect.getState().testPath || ""));
const rntl = require('@testing-library/react-native');
const realSetTimeout = global.setTimeout;
const AT = Number(process.env.STALL_AT_MS || 550);
const MS = Number(process.env.STALL_MS || 500);
let armed = 0;
let fired = 0;
const block = () => {
  fired += 1;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, MS); // a blocked thread, on no clock
};
const changeText = rntl.fireEvent.changeText;
rntl.fireEvent.changeText = async (element, ...data) => {
  const out = await changeText(element, ...data);
  if (PROBED && element && element.props && element.props.placeholder === 'Search foods...' && String(data[0] ?? '').length >= 2) {
    armed += 1;
    (process.env.STALL_CLOCK === 'real' ? realSetTimeout : global.setTimeout)(block, AT);
  }
  return out;
};
afterAll(() => {
  if (process.env.STALL_LOG) {
    require('fs').appendFileSync(process.env.STALL_LOG, `armed=${armed} fired=${fired}\n`);
  }
});
