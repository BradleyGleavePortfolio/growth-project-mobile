/**
 * LS-952 B0 records operator 201's page-only ruling.
 * This does not redefine the drawn card, tile or forest colors.
 */
import { coachInboxB, lightTokens } from '../tokens';

it('uses the existing app page for the coach inbox and draft pages', () => {
  expect(coachInboxB.page).toBe(lightTokens.bgPrimary);
});
