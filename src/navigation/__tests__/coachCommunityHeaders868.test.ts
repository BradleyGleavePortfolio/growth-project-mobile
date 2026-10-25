/**
 * FR-868 round 2: the coach community stack shows ONE header per screen.
 * Screens that draw their own title (the K2 inbox page title) keep only the
 * back control in the bar, in the page colour with no shadow.
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
  it('the inbox bar keeps only the back control and blends into the bone page', () => {
    const block = screenBlock('CoachCommunityInbox');
    expect(block).toMatch(/headerTitle: ''/);
    expect(block).toMatch(/headerShadowVisible: false/);
    expect(block).toMatch(/headerStyle: \{ backgroundColor: tokenColors\.bone \}/);
  });
});
