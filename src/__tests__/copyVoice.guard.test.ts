/**
 * Repo-wide voice guard (OR-115-4, owner copy rules): shipped words in this
 * app never speak as an institutional "we" (no we/us/our in user-facing
 * strings), never shout (no exclamation marks), and never promise a
 * retention period that is not true (AI chats are kept until the person
 * deletes them or the account, never "180 days").
 *
 * Every string literal, template-literal segment and JSX text node in every
 * non-test source file under src/ is read with the TypeScript parser, so
 * comments are never flagged and multi-line JSX text is read as one string.
 * Strings that cannot reach a person are skipped by position (module
 * specifiers, literal types, console / Sentry / log arguments). The few
 * deliberate exceptions are listed in ALLOWED with the reason; an exception
 * that no longer matches anything fails the guard, so the list only shrinks.
 */
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '..');

/** we / we're / we've / we'll / we'd / us / our / ours / ourselves (straight or curly apostrophe). */
const FIRST_PERSON =
  /(^|[^A-Za-z0-9_'’./@:-])(?:[Ww]e(?:['’](?:re|ve|ll|d))?|[Uu]s|[Oo]urs?|[Oo]urselves)(?![A-Za-z0-9_-])(?!['’][a-z])(?!\.[A-Za-z0-9])/;
/** "!" closing a word or sentence (not "!=", not a markdown image "![", not an inline negation). */
const EXCLAMATION = /[A-Za-z0-9)’'"]!+(?=$|[\s"'’”)\]*_.,:;])/;
/** The retired retention period (OR-110-1: kept until the person deletes them or the account). */
const RETIRED_PERIOD = /\b180[\s-]+days?\b|\b180-day\b/i;

type Rule = 'first_person' | 'exclamation' | 'retired_period';

const RULES: ReadonlyArray<[Rule, RegExp]> = [
  ['first_person', FIRST_PERSON],
  ['exclamation', EXCLAMATION],
  ['retired_period', RETIRED_PERIOD],
];

/**
 * Deliberate exceptions: file (relative to src/), a substring of the flagged
 * string, the rule, and why it is not institutional or shipped copy.
 */
const ALLOWED: ReadonlyArray<{ file: string; includes: string; rule: Rule; why: string }> = [
  {
    file: 'components/roman/romanVoice.ts',
    includes: 'Where shall we begin?',
    rule: 'first_person',
    why: 'Roman (the named concierge persona) speaking an inclusive "we" with the person, not the company.',
  },
  {
    file: 'constants/bloodworkCopy.ts',
    includes: 'we diagnose',
    rule: 'first_person',
    why: 'Entry of BLOODWORK_FORBIDDEN_PHRASES, the detector list that keeps diagnosis claims out of copy.',
  },
  {
    file: 'constants/bloodworkCopy.ts',
    includes: 'we recommend taking',
    rule: 'first_person',
    why: 'Entry of BLOODWORK_FORBIDDEN_PHRASES, the detector list that keeps diagnosis claims out of copy.',
  },
  {
    file: 'lib/consultation/consentVersion.ts',
    includes: 'Before we start',
    rule: 'first_person',
    why: 'P0 consent title: hashed into consult-consent-v3 (CONSENT_COPY_SHA256, backend #607 accepts only listed versions); rewording needs a new consent version on both sides.',
  },
  {
    file: 'lib/consultation/copy.ts',
    includes: 'We do not diagnose, treat, or give medical advice.',
    rule: 'first_person',
    why: 'P0 consent paragraph 1: hashed into consult-consent-v3 (CONSENT_COPY_SHA256); rewording needs a new consent version on both sides.',
  },
  {
    file: 'lib/consultation/copy.ts',
    includes: 'We use it only to provide your training. We never sell it.',
    rule: 'first_person',
    why: 'P0 consent paragraph 3 (collection and use, box 1): hashed into consult-consent-v3 (CONSENT_COPY_SHA256); rewording needs a new consent version on both sides.',
  },
  {
    file: 'screenshots/fixtures.ts',
    includes: 'Let us hold the deficit',
    rule: 'first_person',
    why: 'Demo message written by a coach (a named human) to the client in a screenshot fixture.',
  },
];

/** Call targets whose string arguments never reach a person. */
const NON_UI_CALLEES = /^(console\.\w+|logger\.\w+|log\.\w+|Sentry\.\w+|captureError|captureErrorWithoutPii|addBreadcrumb|require|jest\.\w+|import)$/;

type VoiceHit = { file: string; line: number; rule: Rule; text: string };

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function skippedByPosition(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isImportTypeNode(parent)) return true;
  if (ts.isLiteralTypeNode(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isModuleDeclaration(parent)) return true;
  // String literals used as property names / element access keys are identifiers, not words.
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  // Arguments of logging / telemetry / module calls (a template segment sits one level deeper).
  let up: ts.Node | undefined = parent;
  for (let i = 0; i < 3 && up; i++, up = up.parent) {
    if (ts.isCallExpression(up) || ts.isNewExpression(up)) {
      const callee = up.expression.getText();
      return NON_UI_CALLEES.test(callee) || callee === 'RegExp';
    }
  }
  return false;
}

/** Every flagged user-facing string in one source text (also driven by the self-test below). */
function scanSource(file: string, text: string): VoiceHit[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const hits: VoiceHit[] = [];
  const visit = (node: ts.Node): void => {
    let value: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      value = node.text;
    }
    if (value !== null && /[A-Za-z]/.test(value) && !skippedByPosition(node)) {
      const words = value.replace(/\s+/g, ' ').trim();
      for (const [rule, re] of RULES) {
        if (re.test(words)) {
          hits.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, rule, text: words });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function isAllowed(hit: VoiceHit): number {
  return ALLOWED.findIndex((a) => a.file === hit.file && a.rule === hit.rule && hit.text.includes(a.includes));
}

describe('repo-wide voice guard (OR-115-4)', () => {
  const files = sourceFiles(SRC);
  const all: VoiceHit[] = [];
  for (const full of files) {
    all.push(...scanSource(path.relative(SRC, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8')));
  }

  it('reads the whole source tree', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('no user-facing string speaks as we/us/our, uses "!", or names a 180-day period', () => {
    const offending = all.filter((h) => isAllowed(h) < 0).map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`);
    expect(offending).toEqual([]);
  });

  it('every allowed exception still matches a string (the list only shrinks)', () => {
    const used = new Set(all.map(isAllowed).filter((i) => i >= 0));
    const stale = ALLOWED.filter((_, i) => !used.has(i)).map((a) => `${a.file}: ${a.includes}`);
    expect(stale).toEqual([]);
  });
});

describe('the retired retention period appears nowhere (OR-110-1)', () => {
  it('no file under src/ or docs/ names a 180-day period, in code, comments or tests', () => {
    const roots = [SRC, path.resolve(SRC, '..', 'docs')].filter((d) => fs.existsSync(d));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
        } else if (/\.(tsx?|jsx?|md|json)$/.test(entry.name) && full !== __filename) {
          files.push(full);
        }
      }
    };
    roots.forEach(walk);
    const named = files.filter((f) => RETIRED_PERIOD.test(fs.readFileSync(f, 'utf8')));
    expect(named.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

describe('voice guard scanner self-test', () => {
  const rules = (src: string, file = 'x.tsx') => scanSource(file, src).map((h) => h.rule);

  it('flags first person in literals, templates and JSX text, in any position', () => {
    expect(rules(`const a = 'We could not load this.';`)).toEqual(['first_person']);
    expect(rules('const b = `Copy it and write to us at ${email}.`;')).toEqual(['first_person']);
    expect(rules(`const c = <Text>Reviewed by our{'\\n'}team.</Text>;`)).toEqual(['first_person']);
    expect(rules(`const d = <Text>On\n  our side.</Text>;`)).toEqual(['first_person']);
    expect(rules(`const e = "We’ll keep it safe.";`)).toEqual(['first_person']);
    expect(rules(`const f = 'Tell us more';`)).toEqual(['first_person']);
    expect(rules(`const g = <Btn label="Ours to fix" />;`)).toEqual(['first_person']);
  });

  it('does not flag look-alikes', () => {
    expect(rules(`const a = 'Use en-US dates. User status. Ourselves-free. Sweet. Wellness.';`)).toEqual([]);
    expect(rules(`const b = 'Show the US units and the USB cable';`)).toEqual([]);
    expect(rules(`const h = 'https://us.i.posthog.com and zoom.us and a@us.example';`)).toEqual([]);
    expect(rules(`// we could not\nconst c = 1; /* our side */`)).toEqual([]);
    expect(rules(`import x from './we are/our';`)).toEqual([]);
    expect(rules(`console.warn('we failed here');`)).toEqual([]);
    expect(rules(`type T = 'we';`)).toEqual([]);
  });

  it('flags exclamation marks in copy but not in code-like strings', () => {
    expect(rules(`const a = 'Congratulations!';`)).toEqual(['exclamation']);
    expect(rules(`const b = <Text>Great work! Keep going.</Text>;`)).toEqual(['exclamation']);
    expect(rules(`const c = '— exceptional retention!';`)).toEqual(['exclamation']);
    expect(rules(`const d = 'a != b and ![alt](x)';`)).toEqual([]);
  });

  it('flags the retired 180-day period', () => {
    expect(rules(`const a = 'Chats are deleted after 180 days.';`)).toEqual(['retired_period']);
    expect(rules(`const b = 'A 180-day window';`)).toEqual(['retired_period']);
    expect(rules(`const c = 'Weight 180 lbs';`)).toEqual([]);
  });
});
