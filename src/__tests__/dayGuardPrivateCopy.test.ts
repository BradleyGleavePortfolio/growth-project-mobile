// FLAKY-PAIR-M (LS-996R1 AUDIT 7183063360, item 6): a test that writes into
// the shared src tree races every suite that reads src in another worker. In
// main run 45752952784 romanVoiceReaders.fix963r2 listed
// src/utils/workout/fr917DayProbeApi.ts, fr917DayDiscovery removed it, and the
// read failed with ENOENT. So a test that edits files for a child jest run
// makes every edit in its own copy of src and points the child at that copy
// (FR917_DAY_ROOT); the shared tree is only read. One row per such test, and
// the list is found, not trusted.
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

// Every test that runs a child jest on files it edits (all run the day guard).
const MUTATION_TESTS = [
  'src/__tests__/fr917DayDiscovery.test.ts',
  'src/__tests__/fr917r2DayDiscovery.test.ts',
  'src/__tests__/fr917r3DayTree.test.ts',
  'src/__tests__/ls917DayDiscovery.test.ts',
  'src/__tests__/ls917r2ListedDayDiscovery.test.ts',
  'src/__tests__/ls917r3DaySyntax.test.ts',
];

const CHILD_JEST = /jest\/bin\/jest/;
const WRITES = /\b(?:writeFileSync|appendFileSync|copyFileSync|renameSync|cpSync|mkdirSync|rmSync|unlinkSync|writeFile|appendFile)\s*\(/;

const testFiles = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : testFiles(rel);
    return /\.(?:test|check)\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name) ? [rel] : [];
  });

// Code without its comments, so a word in a comment is never counted as a use.
const code = (file: string) =>
  fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The only ways a mutation test may name the shared tree: to find it, to run
// the guard that lives in it, to copy it, and as the child's working folder.
const SHARED_TREE_USES = [
  "const root = path.resolve(__dirname, '../..');",
  "path.join(root, 'src/__tests__/workoutDayRule.test.ts')",
  "fs.cpSync(path.join(root, 'src'), path.join(copy, 'src'), { recursive: true });",
  'cwd: root,',
];

it('every test that edits files for a child jest run is listed', () => {
  const found = ['src', 'scripts']
    .flatMap(testFiles)
    .filter((file) => file !== 'src/__tests__/dayGuardPrivateCopy.test.ts')
    .filter((file) => {
      const source = code(file);
      return CHILD_JEST.test(source) && WRITES.test(source);
    });
  expect(found.sort()).toEqual([...MUTATION_TESTS].sort());
});

it.each(MUTATION_TESTS)('%s edits only its own copy of src and runs the guard on it', (file) => {
  const source = code(file);
  // A private copy under the system temp folder, removed after the file.
  expect(source).toMatch(/const copy = fs\.mkdtempSync\(path\.join\((?:os|require\('os'\))\.tmpdir\(\), '[\w-]+'\)\);/);
  expect(source).toContain("fs.cpSync(path.join(root, 'src'), path.join(copy, 'src'), { recursive: true });");
  expect(source).toContain('afterAll(() => fs.rmSync(copy, { recursive: true, force: true }));');
  // Every child run reads that copy.
  const children = source.match(/spawnSync\(/g) ?? [];
  const onCopy = source.match(/env: \{ \.\.\.process\.env,[^}]*FR917_DAY_ROOT: copy \}/g) ?? [];
  expect(children.length).toBeGreaterThan(0);
  expect(onCopy).toHaveLength(children.length);
  // Nothing else names the shared tree, so no write can reach it.
  const rest = SHARED_TREE_USES.reduce((text, use) => text.split(use).join(''), source);
  expect(rest).not.toMatch(/\broot\b/);
  expect(rest).not.toMatch(/__dirname|process\.cwd\(\)/);
});
