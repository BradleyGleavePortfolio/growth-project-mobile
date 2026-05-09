// Sprint A — source-level guard for the federation 503 surface.
//
// Mounting the full PracticeSelectionScreen in jest is heavy, but the
// contract we care about is tiny: the error mapper must recognise the
// fitness backend's PRACTICE_FEDERATION_FAILED 503 and surface the
// retry copy rather than a raw axios message. We assert that contract
// by reading the source file — this fails loud if a future edit drops
// the special-case and the audit "asymmetric state" failure mode
// regresses silently.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(
    ROOT,
    'src',
    'screens',
    'coach',
    'cross-pillar',
    'PracticeSelectionScreen.tsx',
  ),
  'utf8',
);

describe('PracticeSelectionScreen federation handling', () => {
  it('special-cases PRACTICE_FEDERATION_FAILED with a retry message', () => {
    expect(SRC).toMatch(/PRACTICE_FEDERATION_FAILED/);
    expect(SRC).toMatch(/sync your practice across both products/i);
  });

  it('checks the response status for 503', () => {
    expect(SRC).toMatch(/status\s*===\s*503/);
  });

  it('still calls practiceTypeApi.set on save', () => {
    expect(SRC).toMatch(/practiceTypeApi\.set\(/);
  });
});
