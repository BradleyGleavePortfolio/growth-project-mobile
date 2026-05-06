/**
 * Screenshot harness — public surface.
 *
 * Everything is gated behind `isScreenshotMode()`. When the flag is off, the
 * exports here are inert and `installAxiosMockAdapter` / `seedDemoUser` are
 * no-ops. Nothing in `App.tsx` calls into this module unless the flag is on,
 * but we keep the gates inside each function as defense-in-depth so a stray
 * import in a release build cannot accidentally seed demo data.
 */

export { isScreenshotMode } from './mode';
export { seedDemoUser } from './seed';
export { installAxiosMockAdapter } from './mockAdapter';
export { SCREENSHOT_TARGETS } from './screens';
