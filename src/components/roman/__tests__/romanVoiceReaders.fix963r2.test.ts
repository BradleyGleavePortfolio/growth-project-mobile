/**
 * FIX-963R2 (LO-963R2 B1, class first): a file that reads a romanVoice line through require() is out of tsc's reach,
 * so when a line leaves romanVoice.ts that file gets `undefined` and breaks only in jest (m#950's quoted-send suites
 * read ROMAN_STORED_NO_REPLY and ROMAN_SEND_FAILED after m#963 had replaced them, getByText(undefined)). One row per
 * file and name that any file under src/ reads from romanVoice through require() or jest.requireActual(), as
 * `const { A, B } = require(...)` or `const voice = require(...)` then `voice.A`: romanVoice must still export it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '../../..');
const voice = jest.requireActual('../romanVoice') as Record<string, unknown>;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(name) ? [path] : [];
  });

const LOADER = String.raw`(?:jest\.requireActual|require)\(\s*['"][^'"]*/romanVoice['"]\s*\)`;
const DESTRUCTURED = new RegExp(String.raw`\{([^{}]*)\}\s*=\s*` + LOADER, 'g');
const WHOLE_MODULE = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*` + LOADER, 'g');

const found = new Map<string, [string, string]>();
const add = (file: string, name: string) => found.set(`${file} ${name}`, [file, name]);
for (const path of sourceFiles(SRC)) {
  if (path === __filename) continue; // this file reads romanVoice as `voice` and names `voice.A` in its comment
  const text = readFileSync(path, 'utf8');
  if (!text.includes('romanVoice')) continue;
  const file = relative(SRC, path);
  for (const m of text.matchAll(DESTRUCTURED)) {
    for (const part of m[1].split(',')) {
      const name = part.split(/[:=]/)[0].trim();
      if (name && !name.startsWith('...')) add(file, name);
    }
  }
  for (const m of text.matchAll(WHOLE_MODULE)) {
    const reads = new RegExp(String.raw`\b${m[1]}(?:\.([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])`, 'g');
    for (const r of text.matchAll(reads)) add(file, r[1] ?? r[2]);
  }
}
const rows = [...found.values()];

it('finds the require() readers of romanVoice it guards (m#950 quoted-send suites, m#963 held-card suites)', () => {
  const readers = new Set(rows.map(([file]) => file));
  expect(readers).toContain('screens/roman/__tests__/RomanQuoteSendOnce.mergeup950.test.tsx');
  expect(readers).toContain('screens/roman/__tests__/RomanQuoteSendOnce.wire.mergeup950.test.tsx');
  expect(readers).toContain('screens/roman/__tests__/RomanHeldCard.test.tsx');
});

it.each(rows)('%s reads %s from romanVoice, and romanVoice still exports it', (_file, name) => {
  expect(Object.prototype.hasOwnProperty.call(voice, name)).toBe(true);
});
