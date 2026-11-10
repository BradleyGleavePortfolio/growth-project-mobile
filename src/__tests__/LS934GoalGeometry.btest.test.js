/** @jest-environment node */
const fs = require('fs');
const path = require('path');

test('H1-H8 keep the GOAL 64pt Needs you count box', () => {
  // planning/MOCKUP3/NEEDS-YOU-R2/src/gen.py:70, .nbox width and height are 64.
  const code = fs.readFileSync(path.join(__dirname, '../screens/coach/home-v11/CoachHomeV11.tsx'), 'utf8');
  const dimensions = code.match(/needsBox:\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)/);
  expect(dimensions).not.toBeNull();
  expect(dimensions.slice(1).map(Number)).toEqual([64, 64]);
});
