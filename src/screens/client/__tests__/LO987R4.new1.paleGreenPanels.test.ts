/**
 * LO-987R4 NEW1 (review round 4, "New, outside the fix", TEMPLATE [R44] step 3).
 *
 * Owner #203-E91 ("into the scheme", 203-D40 option 1), on main since m#994: on the light theme no panel is filled or
 * outlined in a pale green; every panel is the one shared cream card. Main's census
 * (src/__tests__/schemePanels994.test.tsx, its FAMILY pattern) fails on any pale green use it does not list.
 *
 * This PR's round-2 work adds such uses in two files main's census has no row for:
 *   - RoutineBuilderScreen.tsx fieldPanel / fieldRule (the C_row panel the numbers sit on): a panel, so it must read
 *     the shared card; no census row can make a pale green panel right.
 *   - ProgramAssignScreen.tsx the initial disc: a role the census can list (as "avatar tile"), or a non-family tint.
 * Merged with main 0949e336, main's own census test goes red (one failure, CI lane run 45930691585).
 *
 * The pattern below is main 0949e336's FAMILY (schemePanels994.test.tsx:247-255), copied so this test runs at the
 * reviewed head, which is older than m#994.
 */
import * as fs from 'fs';
import * as path from 'path';

const FAMILY = new RegExp(
  [
    'success\\.bg', 'successBg', 'feedbackSuccessBg', '(^|[^A-Za-z])sage([^A-Za-z]|$)',
    '(^|[^A-Za-z])sageLine([^A-Za-z]|$)', 'brand\\[50\\]', 'primaryPale',
    ['e0', 'eb', 'e4'].join(''), ['c9', 'd8', 'cd'].join(''), ['d6', 'e4', 'da'].join(''),
    'rgba?\\(\\s*224[,\\s]+235[,\\s]+228', 'rgba?\\(\\s*201[,\\s]+216[,\\s]+205', 'rgba?\\(\\s*214[,\\s]+228[,\\s]+218',
  ].join('|'),
  'i',
);

const SRC = path.resolve(__dirname, '../../..');
const styleBlock = (relative: string, name: string): string => {
  const text = fs.readFileSync(path.join(SRC, relative), 'utf8');
  const start = text.indexOf(`  ${name}: {`);
  if (start < 0) return '';
  return text.slice(start, text.indexOf('\n  },', start) + 5);
};

describe('LO-987R4 NEW1: no pale green panel on the light theme (owner #203-E91, main m#994)', () => {
  it('RoutineBuilder: the C_row field panel reads no pale green fill or outline', () => {
    const panel = styleBlock('screens/client/RoutineBuilderScreen.tsx', 'fieldPanel');
    expect(panel).not.toBe('');
    expect(panel.split('\n').filter((line) => FAMILY.test(line))).toEqual([]);
  });

  it('RoutineBuilder: the rule between the panel rows is not the pale green line', () => {
    const rule = fs
      .readFileSync(path.join(SRC, 'screens/client/RoutineBuilderScreen.tsx'), 'utf8')
      .split('\n')
      .filter((line) => /^\s*fieldRule:/.test(line));
    expect(rule.length).toBe(1);
    expect(rule.filter((line) => FAMILY.test(line))).toEqual([]);
  });
});
