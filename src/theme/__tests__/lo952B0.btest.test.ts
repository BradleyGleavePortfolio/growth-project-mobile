/**
 * LO-952 B-TEST B0 (operator agent 201's records ruling): owner #197-E6 "#196-D13 - we keep the toothpaste color for
 * v1" wins over A1.17, so the coach inbox and Roman's drafts page is the app page token, not the drawn old bone.
 */
import { coachInboxB, lightTokens } from '../tokens';

it('B0: the coach inbox page is the app page token (owner #197-E6, D13)', () => {
  expect(coachInboxB.page).toBe(lightTokens.bgPrimary);
});
