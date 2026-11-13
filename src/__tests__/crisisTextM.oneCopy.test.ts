/**
 * CRISIS-TEXT-M (#202-S5, owner "OPTION 1 - FOLD IT INTO THE TWO CRISIS-TEXT JOBS"): one copy of each crisis sentence
 * on the phone. The phone's twin of the server's test/ai-crisis-copy-one-home.spec.ts (backend 33d4f1d6): the
 * sentences that had more than one code copy live in src/constants/crisisLines.ts; every full message that uses one
 * keeps every byte, pinned by sha-256 of the message as it stood at mobile main f9d71749; and this walk fails if a
 * homed sentence is typed anywhere else in code under src. Test files (__tests__/, *.test.ts(x)), fixtures
 * (__fixtures__/) and .md files are not code: tests pin the literal sentences on purpose, READMEs are docs. The 911 /
 * 988 sentences with one code copy stay in their file (the server test's rule), and the walk pins them there too.
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { COMMUNITY_GUIDELINES, COMMUNITY_REPORT_CRISIS_LINE, communityReportSentMessage } from '../api/communitySafetyApi';
import { REPORT_EMERGENCY_NOTE } from '../api/messagesApi';
import { P8_COPY } from '../lib/consultation/copy';

const SRC = join(__dirname, '..');
const HOME = ['constants', 'crisisLines.ts'].join(sep);
/** Typed more than once at f9d71749 (guideline 7, REPORT_EMERGENCY_NOTE, P8_COPY.emergency): one home now. */
const HOMED = ['If you are in danger, call 911.', 'If you are struggling emotionally, call or text 988.'];
/** One code copy each at f9d71749: each stays in its own file, and only there. */
const IN_PLACE: Array<[string, string]> = [
  ['If someone is in immediate danger, call 911.', ['api', 'communitySafetyApi.ts'].join(sep)],
  ['To reach the 988 Suicide & Crisis Lifeline, call or text 988.', ['api', 'communitySafetyApi.ts'].join(sep)],
  ['If you ever have chest pain, trouble breathing or feel faint, call 911.', ['lib', 'consultation', 'copy.ts'].join(sep)],
];

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

const notCode = (name: string): boolean =>
  name === '__tests__' || name === '__fixtures__' || /\.test\.tsx?$/.test(name) || name.endsWith('.md');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    if (notCode(f)) return [];
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx)$/.test(f) ? [p] : [];
  });

/** Every place a homed sentence is typed outside its home, or a single-copy sentence outside its file. */
export function typedElsewhere(files: Array<{ name: string; text: string }>): string[] {
  return files.flatMap(({ name, text }) => [
    ...(name === HOME ? [] : HOMED.filter((sentence) => text.includes(sentence)).map((s) => `${name}: ${s}`)),
    ...IN_PLACE.filter(([sentence, home]) => name !== home && text.includes(sentence)).map(([s]) => `${name}: ${s}`),
  ]);
}

describe('#202-S5: one copy of each crisis sentence on the phone', () => {
  it('no homed sentence is typed anywhere in code under src but its home', () => {
    const files = walk(SRC).map((p) => ({ name: relative(SRC, p), text: readFileSync(p, 'utf8') }));
    expect(files.length).toBeGreaterThan(500);
    expect(typedElsewhere(files)).toEqual([]);
    expect(files.some((f) => f.name === HOME)).toBe(true);
  });

  it('the home holds each sentence once, and the walk would catch a typed copy', () => {
    const home = readFileSync(join(SRC, HOME), 'utf8');
    for (const sentence of HOMED) expect(home.split(sentence).length - 1).toBe(1);
    expect(typedElsewhere([{ name: 'x.ts', text: `const a = '${HOMED[1]}';` }])).toHaveLength(1);
    expect(typedElsewhere([{ name: 'x.tsx', text: `<Text>${IN_PLACE[0][0]}</Text>` }])).toHaveLength(1);
    expect(typedElsewhere([{ name: HOME, text: HOMED.join(' ') }])).toEqual([]);
  });

  it.each([
    ['guideline 7 (COMMUNITY_GUIDELINES[6])', COMMUNITY_GUIDELINES[6], 'ff3cceae8483d4575fb251e7e9349f44e009a1d483048dc8247dc94e2fac22d3'],
    ['REPORT_EMERGENCY_NOTE', REPORT_EMERGENCY_NOTE, '8f234123d8d0c1dc2f2832e6ff9e3faeaf69b2d63330591ab33a454bcc62d4dd'],
    ['P8_COPY.emergency', P8_COPY.emergency, 'fda6d263f0f2bfa7b31e305a45fb1ea03a97b12f3cdd835c9fd49a9c170b9e08'],
    ['COMMUNITY_REPORT_CRISIS_LINE', COMMUNITY_REPORT_CRISIS_LINE, '6776b5c8dd99185d8122664d2ce088b4a68a0e5ca52f455fc1ee45c94df4bbf9'],
    ["communityReportSentMessage('self_harm')", communityReportSentMessage('self_harm'), '62ecab71f97f3cb546386c285afba512d99286904f3767fc7ede1ece6c88e10b'],
  ])('%s keeps every byte of main f9d71749', (_name, message, hash) => {
    expect(sha(message)).toBe(hash);
  });
});
