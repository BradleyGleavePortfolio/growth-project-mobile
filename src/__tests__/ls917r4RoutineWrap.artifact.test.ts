/** Outside the round-3 fix: inspect real captured character ranges, not a text-width guess.
 * Rerender with the preserved capture patch, then set LS917R4_RENDER_ROOT to that output.
 * The checked-in JSON is the immutable reviewed-head artifact, not a native-device claim.
 */
import fs from 'fs';
import path from 'path';

type Word = { word: string; lines: number[]; chars: Array<{ char: string; top: number; width: number }> };
type Capture = { device: string; font: string; file: string; errors: unknown[]; ownRoutineWords: Word[] };
const artifact = process.env.LS917R4_RENDER_ROOT
  ? path.join(process.env.LS917R4_RENDER_ROOT, 'checks.json')
  : path.join(__dirname, 'fixtures/ls917r4RoutineWrap.json');
const rows = (JSON.parse(fs.readFileSync(artifact, 'utf8')) as { renders: Capture[] }).renders
  .filter((row) => row.file.startsWith('train-week__') && row.font === '1.3'
    && ['ios320', 'android320', 'ios390', 'android390'].includes(row.device));

it('control: all four real captures contain exactly one eight-character Routines label and no page errors', () => {
  expect(rows.map((row) => row.device).sort()).toEqual(['android320', 'android390', 'ios320', 'ios390']);
  for (const row of rows) {
    expect(row.errors).toEqual([]);
    expect(row.ownRoutineWords).toHaveLength(1);
    expect(row.ownRoutineWords[0].word).toBe('Routines');
    expect(row.ownRoutineWords[0].chars).toHaveLength(8);
    expect(row.ownRoutineWords[0].chars.every((char) => char.width > 0)).toBe(true);
  }
});

it.each(rows)('LS-917R4 outside-fix C1: Routines is not broken mid-word at $device / 130%', (row) => {
  expect(row.ownRoutineWords[0].lines).toHaveLength(1);
});
