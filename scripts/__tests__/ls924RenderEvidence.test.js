/** @jest-environment node */
/**
 * LS-924 B1: the delivered render inventory must cover the visible changes.
 * Pinned file metadata only. This is an evidence-contract test, not a device test.
 * Inventory independently read from context PR417 at the fixture's commit.
 * It deliberately needs no token or cross-repository CI permission.
 */
const { pngs } = require('./ls924RenderEvidence.fixture.json');

const required = ['timeline', 'weekly', 'workouts', 'peek'].flatMap((state) =>
  ['ios', 'android'].flatMap((platform) =>
    [320, 360, 390].flatMap((width) =>
      [100, 130].map((scale) => `${state}__after__${platform}${width}__${scale}.png`),
    ),
  ),
);

test.each(required)('R41 changed-state render evidence includes %s', (name) => {
  expect(pngs).toContain(name);
});
