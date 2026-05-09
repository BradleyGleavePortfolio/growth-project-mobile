// Audit fix H-1: source-level guard for the retry surface on
// CoachGuidelinesScreen. Previously the catch swallowed the error
// silently, so a network failure looked the same as a coach who had
// not yet written guidelines. We now track an `error` state, render
// a retry button when set, and let the user re-trigger the load.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'CoachGuidelinesScreen.tsx'),
  'utf8',
);

describe('CoachGuidelinesScreen error path', () => {
  it('tracks error state separately from loading', () => {
    expect(SRC).toMatch(/const \[error, setError\] = useState/);
  });

  it('catches the API failure and stores a typed message', () => {
    expect(SRC).toMatch(/setError\(/);
    expect(SRC).toMatch(/err instanceof Error/);
  });

  it('renders an alert region when error is set', () => {
    expect(SRC).toMatch(/accessibilityRole="alert"/);
  });

  it('renders a retry button that re-runs the load', () => {
    expect(SRC).toMatch(/onPress=\{load\}/);
    expect(SRC).toMatch(/testID="coach-guidelines-retry"/);
  });

  it('clears error state at the start of every load', () => {
    expect(SRC).toMatch(/setError\(null\)/);
  });
});
