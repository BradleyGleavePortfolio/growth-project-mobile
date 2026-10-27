/**
 * FR-868 round 2: the coach community stack shows ONE header per screen.
 * Screens that draw their own title (the K2 inbox, Cohorts and cohort page
 * titles) keep only the back control in the bar, in the page colour with no
 * shadow.
 */
import * as fs from 'fs';
import * as path from 'path';

const NAV = fs.readFileSync(
  path.join(__dirname, '..', 'CoachCommunityNavigator.tsx'),
  'utf8',
);

function screenBlock(name: string): string {
  const start = NAV.indexOf(`name="${name}"`);
  expect(start).toBeGreaterThan(-1);
  const end = NAV.indexOf('/>', start);
  return NAV.slice(start, end);
}

describe('coach community headers (FR-868)', () => {
  // FX4-868: Cohorts and a cohort draw their own serif title too (K2, #172-10).
  it.each([
    ['CoachCommunityInbox', 'Inbox'],
    ['CoachCommunityCohorts', 'Cohorts'],
    ['CoachCommunityCohortDetail', 'Cohort'],
  ])('the %s bar keeps only the back control and blends into the bone page', (name, title) => {
    const block = screenBlock(name);
    // The title stays for the back button and screen readers; the bar draws none.
    expect(block).toMatch(new RegExp(`title: '${title}'`));
    expect(block).toMatch(/headerTitle: ''/);
    expect(block).toMatch(/headerShadowVisible: false/);
    expect(block).toMatch(/headerStyle: \{ backgroundColor: tokenColors\.bone \}/);
  });
});
