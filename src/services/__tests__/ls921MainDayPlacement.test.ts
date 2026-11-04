import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// LS-921 B2: current main 12f158c1 has a whole-source workout-day guard.
// api.ts is in its PLACED set with no day reads. These two new non-workout
// date reads need explicit placement when refreshing this PR onto main.
// At the reviewed (older-base) head the guard is absent, so its reviewed
// main policy is the empty list. After a main refresh this reads the real
// guard's list, so adding precise non-workout placements makes it pass.
const root = path.resolve(__dirname, '../../..');
const apiFile = 'src/services/api.ts';
const guardFile = path.join(root, 'src/__tests__/workoutDayRule.test.ts');

function apiPlacements(): string[] {
  if (!fs.existsSync(guardFile)) return [];
  const source = ts.createSourceFile(
    guardFile, fs.readFileSync(guardFile, 'utf8'), ts.ScriptTarget.Latest, true,
  );
  const findPlaced = (node: ts.Node): ts.ObjectLiteralExpression | undefined => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === 'PLACED' && node.initializer
      && ts.isObjectLiteralExpression(node.initializer)) {
      return node.initializer;
    }
    return ts.forEachChild(node, findPlaced);
  };
  const placed = findPlaced(source);
  if (!placed) throw new Error('Current-main workout-day PLACED policy was not found');
  const entry = placed.properties.find((p) =>
    ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && p.name.text === apiFile);
  if (!entry || !ts.isPropertyAssignment(entry) || !ts.isObjectLiteralExpression(entry.initializer)) {
    throw new Error('api.ts must remain explicitly classified by the day guard');
  }
  const lines = entry.initializer.properties.find((p) =>
    ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'lines');
  if (!lines || !ts.isPropertyAssignment(lines) || !ts.isArrayLiteralExpression(lines.initializer)) {
    throw new Error('api.ts placement lines were not found');
  }
  return lines.initializer.elements.map((e) => {
    if (!ts.isStringLiteral(e)) throw new Error('Expected an exact placement snippet');
    return e.text;
  });
}

it('LS-921 B2: API date reads remain placed under the current-main day guard', () => {
  const text = fs.readFileSync(path.join(root, apiFile), 'utf8');
  const source = ts.createSourceFile(apiFile, text, ts.ScriptTarget.Latest, true);
  const placements = apiPlacements();
  const unplaced: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'date') {
      const from = node.getStart(source);
      const to = node.getEnd();
      // Same exact-span coverage as the real main guard, not a line-wide
      // exemption that could hide a different date read on the same line.
      const covered = placements.some((snippet) => {
        for (let i = text.indexOf(snippet); i !== -1; i = text.indexOf(snippet, i + 1)) {
          if (i <= from && to <= i + snippet.length) return true;
        }
        return false;
      });
      if (!covered) {
        const { line } = source.getLineAndCharacterOfPosition(from);
        unplaced.push(`${apiFile}:${line + 1}: ${text.split('\n')[line].trim()}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(unplaced).toEqual([]);
});
