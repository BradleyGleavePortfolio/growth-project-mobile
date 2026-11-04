/**
 * LO-921 B1 (B-TEST, lens only, never merged): mobile main's workout day guard
 * (src/__tests__/workoutDayRule.test.ts, from m#917) places src/services/api.ts
 * as "request shapes; workout and assignment dates pass through unread" with no
 * listed lines, so any new read of a day field there must be listed in that
 * guard (or not made). m#921 reads `data.date` twice to build the water and
 * weight save keys, so the guard, and with it "Typecheck, lint, test", goes
 * red once main is merged in. This test applies the same rule to api.ts at any
 * head: every day-field read must be covered by a snippet the guard lists for
 * api.ts (none while the guard is absent or lists none, as on main 12f158c1).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const API = 'src/services/api.ts';
const GUARD = path.join(ROOT, 'src/__tests__/workoutDayRule.test.ts');
const DAY_FIELDS = new Set(['date', 'scheduled_for', 'created_at', 'completed_at', 'started_at', 'logged_at']);

function placedSnippets(): string[] {
  if (!fs.existsSync(GUARD)) return [];
  const src = fs.readFileSync(GUARD, 'utf8');
  const m = src.match(/'src\/services\/api\.ts':\s*\{[^}]*?lines:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)].map((x) => x[1] ?? x[2] ?? x[3]);
}

function unplacedReads(): string[] {
  const text = fs.readFileSync(path.join(ROOT, API), 'utf8');
  const sf = ts.createSourceFile(API, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const snippets = placedSnippets();
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    const isRead =
      (ts.isPropertyAccessExpression(node) && DAY_FIELDS.has(node.name.text)) ||
      (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) &&
        DAY_FIELDS.has(((node.propertyName ?? node.name) as ts.Identifier).text ?? ''));
    if (isRead) {
      const from = node.getStart(sf);
      const to = node.getEnd();
      const covered = snippets.some((s) => {
        for (let i = text.indexOf(s); i !== -1; i = text.indexOf(s, i + 1)) if (i <= from && to <= i + s.length) return true;
        return false;
      });
      if (!covered) out.push(`${API}:${sf.getLineAndCharacterOfPosition(from).line + 1}: ${node.getText(sf)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

it('LO-921 B1: every day-field read in src/services/api.ts is placed in the workout day guard', () => {
  expect(unplacedReads()).toEqual([]);
});
