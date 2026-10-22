/**
 * KEYBOARD-SHEETS — a sheet with a text field keeps the field and its send
 * button above the keyboard.
 *
 * 1. Behaviour: the coach insight review sheet and the Ask AI sheet put the
 *    field AND the send button inside a KeyboardAvoidingView, so on iOS the
 *    sheet rises with the keyboard (the app's pattern since NudgeModal and
 *    LogPlannedMealButton). Ask AI's two fields scroll and "Send to AI" is
 *    pinned under them, so it can never sit off screen or under the keyboard;
 *    a failed send is pinned with it, outside the scroll; a refusal puts the
 *    keyboard down so the whole sheet shows it.
 * 2. Class guard: every <TextInput> a <Modal> block draws (itself or through a
 *    child component, resolved from that child's own file) must sit INSIDE a
 *    keyboard-safe element (a padding KeyboardAvoidingView, a ScrollView with
 *    automaticallyAdjustKeyboardInsets, or the shared Screen, whose footer
 *    rises with the keyboard), and a growing multiline field there must sit in
 *    a ScrollView or cap its height. Exceptions are listed with their reason.
 *    A new sheet that forgets the keyboard fails here. It checks fields, not
 *    buttons: that the buttons stay in view is shown by the renders.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@expo/vector-icons', () => {
  function Icon() {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('../theme/ThemeProvider', () => {
  const colors = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') });
  const Pass = ({ children }: { children: React.ReactNode }) => children;
  return { __esModule: true, ThemeProvider: Pass, default: Pass, useTheme: () => ({ colors }) };
});
jest.mock('../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../services/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  return { __esModule: true, default: { get, post, defaults: { baseURL: 'http://test.local/api' } }, get, post };
});
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { invokeSendNotification: jest.fn() },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', role: 'coach', firstName: 'Casey' }),
}));
const mockUseCoachInsight = jest.fn();
jest.mock('../hooks/useWearableInsight', () => ({
  useCoachInsight: (args: unknown) => mockUseCoachInsight(args),
  useApproveDraft: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));

import { AskAiActionSheet } from '../components/coach/ai-execution/AskAiActionSheet';
import { WearableInsightPanel } from '../screens/coach/client-detail/WearableInsightPanel';

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
});

describe('coach insight review sheet rides above the keyboard', () => {
  it('the draft box, Approve, Edit-then-send and Dismiss all sit inside the keyboard avoider, the draft scrolls, the actions stay pinned; the backdrop still closes', async () => {
    mockUseCoachInsight.mockReturnValue({
      data: {
        observation: 'Deep sleep down 40% vs baseline this week',
        hypothesis: 'Possibly late caffeine',
        suggested_action: 'Ask about evenings',
        suggested_message_draft: 'Hey, noticed your deep sleep dipped. Anything change in your evenings?',
        confidence_level: 'fairly_sure',
        source_metrics: ['SLEEP_DEEP_MIN'],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });
    const r = await render(<WearableInsightPanel side="coach" bucket="SLEEP_RECOVERY" clientId="client-1" />);
    await fireEvent.press(r.getByTestId('coach-insight-panel'));
    await fireEvent.press(r.getByTestId('coach-insight-review-cta'));
    const avoider = r.getByTestId('coach-insight-keyboard-avoider');
    for (const id of ['coach-insight-draft-input', 'coach-insight-approve', 'coach-insight-edit-send', 'coach-insight-dismiss']) {
      expect(within(avoider).getByTestId(id)).toBeTruthy();
    }
    // A long draft scrolls (the body scrolls, the field caps its height); the actions stay pinned under it.
    const body = within(avoider).getByTestId('coach-insight-sheet-body');
    expect(body.props.keyboardShouldPersistTaps).toBe('handled');
    expect(within(body).getByTestId('coach-insight-draft-input')).toBeTruthy();
    expect(within(body).queryByTestId('coach-insight-approve')).toBeNull();
    await fireEvent.press(r.getByLabelText('Dismiss the review sheet'));
    expect(r.queryByTestId('coach-insight-keyboard-avoider')).toBeNull();
  });
});

describe('Ask AI sheet rides above the keyboard', () => {
  it('both fields scroll inside the keyboard avoider and Send to AI stays pinned under them, outside the scroll', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = await render(
      <QueryClientProvider client={qc}>
        <AskAiActionSheet visible clientId="c1" clientName="Jane" onClose={jest.fn()} />
      </QueryClientProvider>,
    );
    await fireEvent.press(r.getByTestId('ask-ai-option-draft.send_notification'));
    const avoider = r.getByTestId('ask-ai-keyboard-avoider');
    const form = within(avoider).getByTestId('ask-ai-form');
    expect(form.props.keyboardShouldPersistTaps).toBe('handled');
    for (const id of ['ask-ai-body-input', 'ask-ai-prompt-input']) {
      expect(within(form).getByTestId(id)).toBeTruthy();
    }
    // Pinned: never scrolled away under the keyboard.
    expect(within(avoider).getByTestId('ask-ai-submit')).toBeTruthy();
    expect(within(form).queryByTestId('ask-ai-submit')).toBeNull();
  });

  async function openNotification() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = await render(
      <QueryClientProvider client={qc}>
        <AskAiActionSheet visible clientId="c1" clientName="Jane" onClose={jest.fn()} />
      </QueryClientProvider>,
    );
    await fireEvent.press(r.getByTestId('ask-ai-option-draft.send_notification'));
    return r;
  }

  it('a failed send stays in view: the error sits pinned with Send to AI, outside the scroll, and is read out (round 2, LO-845 B1)', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const r = await openNotification();
    await fireEvent.press(r.getByTestId('ask-ai-submit'));
    const avoider = r.getByTestId('ask-ai-keyboard-avoider');
    expect(within(avoider).getByTestId('ask-ai-error')).toBeTruthy();
    expect(within(r.getByTestId('ask-ai-form')).queryByTestId('ask-ai-error')).toBeNull();
    expect(announce).toHaveBeenCalledWith('Type the notification body to send.');
  });

  it('a refused send stays in view: the keyboard goes down and the form scrolls to the refusal (round 2, LO-845 B1)', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const { coachAiExecutionApi } = jest.requireMock('../api/coachAiExecutionApi');
    coachAiExecutionApi.invokeSendNotification.mockRejectedValueOnce({
      response: { status: 403, data: { code: 'ai_consent_required', message: 'Client has not allowed AI.' } },
    });
    const r = await openNotification();
    await fireEvent.changeText(r.getByTestId('ask-ai-body-input'), 'Hydrate before your session.');
    await fireEvent.changeText(r.getByTestId('ask-ai-prompt-input'), 'Friendly reminder.');
    await fireEvent.press(r.getByTestId('ask-ai-submit'));
    expect(await within(r.getByTestId('ask-ai-form')).findByTestId('ask-ai-refusal')).toBeTruthy();
    expect(dismiss).toHaveBeenCalled();
  });
});

// ── Class guard ──────────────────────────────────────────────────────────────
// Per Modal, not per file: a file-wide <Screen> or avoider must not pass a
// different Modal by accident (LO-845 B2), and an avoider beside a field is
// not one around it (round 2). Each <Modal>…</Modal> block is checked
// together with the components it renders (same file or a relative import,
// two levels deep), so a field drawn by a child form counts too.
const SRC = path.join(__dirname, '..');
const KEYBOARD_SAFE = [
  /<KeyboardAvoidingView[^>]*behavior=\{Platform\.OS === ['"]ios['"] \? ['"]padding['"]/,
  /automaticallyAdjustKeyboardInsets/,
  /<Screen\b/, // src/ui/layout/Screen: its footer sits in a KeyboardAvoidingView
];
/** Modals with a text field that need no keyboard handling, and why (file:first line of the Modal). */
const NOT_NEEDED: Record<string, string> = {
  'components/community/SpaceDrawer.tsx': 'search field sits at the top of the drawer',
  'screens/client/ActiveWorkoutScreen.tsx': 'Add exercise: search field sits at the top of a full-height page sheet',
  'screens/client/RoutineBuilderScreen.tsx': 'Add exercise: search field sits at the top of a full-height page sheet',
  'screens/coach/SubCoachInviteModal.tsx': 'Team Mode is v1.1 (owner #COACH-TABS)',
};
/** Files with a Modal and a text field where no Modal draws the field itself, and why. */
const FIELD_OUTSIDE_MODAL: Record<string, string> = {
  'screens/coach/CoachCodesScreen.tsx': 'its fields are on the screen; the modals only show a code',
  'screens/coach/payments/CoachPackageEditScreen.tsx': 'its fields are on the screen (inside its own avoider); the modal is a picker',
  'screens/coach/CoachLessons.tsx': 'the Modal wraps {body}, a <Screen> built in the same file (footer rides the keyboard)',
};

type Code = { rel: string; code: string };
type Lookup = (rel: string) => string | undefined;
/** Where a chunk of code lives, so its own imports resolve from its own file (LS-845 C1). */
type Ctx = { rel: string; file: string };

/** Every outermost <Modal>…</Modal> block in a file, with its 1-based line. */
function modalBlocks(code: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const tag = /<Modal\b|<\/Modal>/g;
  let depth = 0;
  let start = -1;
  for (let m = tag.exec(code); m; m = tag.exec(code)) {
    if (m[0] === '</Modal>') {
      depth -= 1;
      if (depth === 0 && start >= 0) out.push({ line: code.slice(0, start).split('\n').length, text: code.slice(start, m.index + 8) });
    } else {
      if (depth === 0) start = m.index;
      depth += 1;
    }
  }
  return out;
}

function definitionOf(code: string, name: string | null): string | undefined {
  const re = name
    ? new RegExp(`(?:function\\s+${name}\\s*[(<]|(?:const|let)\\s+${name}\\b[^=\\n]*=)`)
    : /export default function\b/;
  const m = re.exec(code);
  if (!m) return undefined;
  const rest = code.slice(m.index + 1);
  const end = rest.search(/\n(?:export |function |const [A-Z]|class )/);
  return code.slice(m.index, end < 0 ? undefined : m.index + 1 + end);
}

/** Each component a chunk renders (same file or a relative import): where it is used, its source, and its own file. */
function childUses(ctx: Ctx, chunk: string, lookup: Lookup): { at: number; code: string; ctx: Ctx }[] {
  const out: { at: number; code: string; ctx: Ctx }[] = [];
  for (const tagName of new Set(Array.from(chunk.matchAll(/<([A-Z]\w*)/g), (m) => m[1]))) {
    if (tagName === 'Modal' || tagName === 'TextInput') continue;
    const uses = Array.from(chunk.matchAll(new RegExp(`<${tagName}\\b`, 'g')), (m) => m.index ?? 0);
    let found: { code: string; ctx: Ctx } | undefined;
    const local = definitionOf(ctx.file, tagName);
    if (local && !chunk.includes(local)) found = { code: local, ctx };
    for (const imp of found ? [] : ctx.file.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const clause = imp[1];
      const isDefault = new RegExp(`^${tagName}\\b`).test(clause.trim());
      if (!isDefault && !new RegExp(`[{,\\s]${tagName}\\s*[,}]`).test(clause)) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(ctx.rel), imp[2]));
      const rel = [`${base}.tsx`, `${base}/index.tsx`].find((r) => lookup(r) != null);
      const target = rel ? lookup(rel) : undefined;
      if (rel && target) found = { code: definitionOf(target, isDefault ? null : tagName) ?? target, ctx: { rel, file: target } };
    }
    if (found) for (const at of uses) out.push({ at, ...found });
  }
  return out;
}

/** The styles a TextInput names, searched in its file and that file's relative .ts/.tsx imports. */
function styleBodies(ctx: Ctx, input: string, lookup: Lookup): string[] {
  const texts = [ctx.file];
  for (const imp of ctx.file.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(ctx.rel), imp[1]));
    const t = [`${base}.ts`, `${base}.tsx`].map(lookup).find((c) => c != null);
    if (t) texts.push(t);
  }
  const out: string[] = [];
  for (const m of input.matchAll(/styles\.(\w+)/g)) {
    for (const t of texts) {
      const d = new RegExp(`\\b${m[1]}:\\s*\\{([^}]*)\\}`).exec(t);
      if (d) out.push(d[1]);
    }
  }
  return out;
}

/** End of the JSX opening tag that starts at `from` (skips braces and strings, so `=>` inside a prop is not the end). */
function openTagEnd(code: string, from: number): number {
  let depth = 0;
  let quote = '';
  for (let i = from + 1; i < code.length; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return i;
  }
  return code.length;
}

/** True when position `at` sits INSIDE an open keyboard-safe element of `chunk` (containment, not presence). */
function insideSafe(chunk: string, at: number): boolean {
  const stack: boolean[] = [];
  const tag = /<(\/?)(KeyboardAvoidingView|ScrollView|Screen)\b/g;
  for (let m = tag.exec(chunk); m && m.index < at; m = tag.exec(chunk)) {
    if (m[1]) {
      stack.pop();
      continue;
    }
    const end = openTagEnd(chunk, m.index);
    if (chunk[end - 1] === '/') continue; // self-closing: wraps nothing
    stack.push(KEYBOARD_SAFE.some((re) => re.test(chunk.slice(m!.index, end + 1))));
  }
  return stack.some(Boolean);
}

/**
 * Problems for one chunk (a Modal block, then the components it renders, two levels deep): every
 * TextInput must sit inside a keyboard-safe element, either in its own chunk or around the
 * place a parent renders it; a growing multiline field outside a ScrollView must cap its height.
 */
function chunkProblems(ctx: Ctx, chunk: string, lookup: Lookup, guarded: boolean, depth: number): string[] {
  const problems: string[] = [];
  for (const m of chunk.matchAll(/<TextInput\b[\s\S]*?\/>/g)) {
    const at = m.index ?? 0;
    if (!guarded && !insideSafe(chunk, at)) {
      problems.push(`${ctx.rel}: field outside a keyboard avoider, keyboard-inset ScrollView or Screen in this Modal: ${m[0].slice(0, 60)}`);
    }
    // A long text in a sheet that cannot scroll pushes the title and buttons off screen (LO-845 B1 / LS-845 B1).
    if (!/\bmultiline\b/.test(m[0])) continue;
    const before = chunk.slice(0, at);
    const inScroll = (before.match(/<ScrollView\b/g) ?? []).length > (before.match(/<\/ScrollView>/g) ?? []).length;
    const capped = /\b(maxHeight|height)\s*:/.test(m[0]) || styleBodies(ctx, m[0], lookup).some((b) => /\b(maxHeight|height)\s*:/.test(b));
    if (!inScroll && !capped) problems.push(`${ctx.rel}: multiline field without a height cap: ${m[0].slice(0, 60)}`);
  }
  if (depth < 2) {
    for (const use of childUses(ctx, chunk, lookup)) {
      problems.push(...chunkProblems(use.ctx, use.code, lookup, guarded || insideSafe(chunk, use.at), depth + 1));
    }
  }
  return problems;
}

function drawsField(ctx: Ctx, chunk: string, lookup: Lookup, depth = 0): boolean {
  if (/<TextInput\b/.test(chunk)) return true;
  return depth < 2 && childUses(ctx, chunk, lookup).some((u) => drawsField(u.ctx, u.code, lookup, depth + 1));
}

/** Problems for one Modal block, or [] when it is keyboard-safe. */
function modalProblems(rel: string, file: string, block: string, lookup: Lookup): string[] {
  return Array.from(new Set(chunkProblems({ rel, file }, block, lookup, false, 0)));
}

/** Code without comments (kept line for line), so a Modal named in a comment is not a Modal. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('every Modal with a text field is keyboard-safe', () => {
  const all: Code[] = walk(SRC).map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join('/'), code: stripComments(fs.readFileSync(f, 'utf8')) }));
  const byRel = new Map(all.map((f) => [f.rel, f.code]));
  const lookup: Lookup = (rel) => byRel.get(rel);
  const withModal = all.filter(({ rel, code }) => rel.endsWith('.tsx') && /<Modal\b/.test(code));
  const fieldModals = withModal.flatMap(({ rel, code }) =>
    modalBlocks(code)
      .filter((b) => drawsField({ rel, file: code }, b.text, lookup))
      .map((b) => ({ rel, code, ...b })),
  );

  it('finds the sheets this guard is about, including one whose field is drawn by a child form', () => {
    expect(fieldModals.map((m) => m.rel)).toEqual(
      expect.arrayContaining([
        'screens/coach/client-detail/WearableInsightPanel.tsx',
        'components/coach/ai-execution/AskAiActionSheet.tsx',
        'screens/coach/CoachTeamProfileScreen.tsx',
        'components/log/FoodSearchModal.tsx',
      ]),
    );
  });

  it.each(fieldModals.map((m) => [`${m.rel}:${m.line}`, m.rel, m.code, m.text]))(
    '%s keeps its field and buttons above the keyboard',
    (_id, rel, code, text) => {
      if (NOT_NEEDED[rel]) return;
      expect(modalProblems(rel, code, text, lookup)).toEqual([]);
    },
  );

  it('every file with a Modal and a text field has a Modal that draws it, or a reason', () => {
    const covered = new Set(fieldModals.map((m) => m.rel));
    const unexplained = withModal
      .filter(({ rel, code }) => /<TextInput\b/.test(code) && !covered.has(rel) && !FIELD_OUTSIDE_MODAL[rel])
      .map((f) => f.rel);
    expect(unexplained).toEqual([]);
  });

  it('every listed exception still exists', () => {
    for (const rel of Object.keys(NOT_NEEDED)) expect(fieldModals.some((m) => m.rel === rel)).toBe(true);
    for (const rel of Object.keys(FIELD_OUTSIDE_MODAL)) expect(byRel.has(rel)).toBe(true);
  });
});

describe('the guard itself catches the holes the lenses found', () => {
  const none: Lookup = () => undefined;
  const avoid = "<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>";
  it('a Screen elsewhere in the file does not pass a bare Modal (LO-845 B2)', () => {
    const file = `<Screen /><Modal transparent><View><TextInput value={a} /></View></Modal>`;
    const [b] = modalBlocks(file);
    expect(modalProblems('x.tsx', file, b.text, none)).toHaveLength(1);
  });
  it('a safe Modal does not pass a second, unsafe Modal in the same file (LS-845 C1)', () => {
    const file = `<Modal>${avoid}<TextInput /></KeyboardAvoidingView></Modal><Modal><TextInput /></Modal>`;
    const [safe, unsafe] = modalBlocks(file);
    expect(modalProblems('x.tsx', file, safe.text, none)).toEqual([]);
    expect(modalProblems('x.tsx', file, unsafe.text, none)).toHaveLength(1);
  });
  it('a growing multiline field in a sheet that cannot scroll fails until it is capped (LO-845 B1)', () => {
    const grow = `const styles = { input: { minHeight: 96 } };\n<Modal>${avoid}<TextInput multiline style={styles.input} /></KeyboardAvoidingView></Modal>`;
    expect(modalProblems('x.tsx', grow, modalBlocks(grow)[0].text, none)).toHaveLength(1);
    const capped = grow.replace('minHeight: 96', 'minHeight: 96, maxHeight: 160');
    expect(modalProblems('x.tsx', capped, modalBlocks(capped)[0].text, none)).toEqual([]);
    const scrolls = grow.replace('<TextInput', '<ScrollView><TextInput').replace('/></Keyboard', '/></ScrollView></Keyboard');
    expect(modalProblems('x.tsx', scrolls, modalBlocks(scrolls)[0].text, none)).toEqual([]);
  });
  it('a field drawn by a child component in another file is checked', () => {
    const files: Record<string, string> = { 'a/Form.tsx': 'export function Form() { return <TextInput />; }' };
    const file = `import { Form } from './Form';\n<Modal><View><Form /></View></Modal>`;
    expect(modalProblems('a/Sheet.tsx', file, modalBlocks(file)[0].text, (r) => files[r])).toHaveLength(1);
  });
  it('an avoider beside the field, not around it, does not pass (round 2, LS-845 C1)', () => {
    const file = `<Modal>${avoid}<View /></KeyboardAvoidingView><TextInput /></Modal>`;
    expect(modalProblems('x.tsx', file, modalBlocks(file)[0].text, none)).toHaveLength(1);
    const around = `<Modal>${avoid}<TextInput /></KeyboardAvoidingView></Modal>`;
    expect(modalProblems('x.tsx', around, modalBlocks(around)[0].text, none)).toEqual([]);
  });
  it('an avoider around the place a child form is drawn covers the child field', () => {
    const files: Record<string, string> = { 'a/Form.tsx': 'export function Form() { return <TextInput />; }' };
    const file = `import { Form } from './Form';\n<Modal>${avoid}<Form /></KeyboardAvoidingView></Modal>`;
    expect(modalProblems('a/Sheet.tsx', file, modalBlocks(file)[0].text, (r) => files[r])).toEqual([]);
  });
  it("a grandchild is resolved from its parent's file, not the sheet's (round 2, LS-845 C1)", () => {
    const files: Record<string, string> = {
      'a/b/Form.tsx': "import { Field } from './Field';\nexport function Form() { return <View><Field /></View>; }",
      'a/b/Field.tsx': 'export function Field() { return <TextInput />; }',
    };
    const file = `import { Form } from './b/Form';\n<Modal><View><Form /></View></Modal>`;
    expect(modalProblems('a/Sheet.tsx', file, modalBlocks(file)[0].text, (r) => files[r])).toHaveLength(1);
  });
});
