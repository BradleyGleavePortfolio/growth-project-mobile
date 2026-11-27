/**
 * The scheme's panels and success messages (203-D40 option 1, owner #203-E91: "into the scheme").
 *
 * On the light theme no panel and no success message is filled or outlined in a pale green. Every panel is the one
 * shared cream card (colors.cream with a 3 pt colors.forest left edge); every success message is the one shared forest
 * bar (colors.forest with lightTokens.textOnAccent words and icon). This file holds:
 *   1. the two shared definitions and the family tokens, which keep their values (their other readers are not panels);
 *   2. the members: the shared pieces mounted as the app mounts them, and one row per member for what its style reads;
 *   3. a census of every pale green family name and value under src/ outside tests: a use that is not in the table
 *      below, with its role, fails here, so a new pale green panel cannot arrive unseen;
 *   4. the text and ground pairs measured on the Sunlit sand page (owner #203-E86), each against main's ratio.
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { Colors } from '../constants/colors';
import {
  brand, colors, darkTokens, forestPop, gold, lightTokens, neutral, schemeBar, schemeCard, schemeCardOutline, semantic,
} from '../theme/tokens';
import { CoachNote } from '../screens/client/learn/CourseParts';
import CompletionToast from '../components/community/CompletionToast';
import AutosaveStatusPill from '../components/workout/AutosaveStatusPill';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const SRC = path.resolve(__dirname, '..');
const read = (relative: string): string => fs.readFileSync(path.join(SRC, relative), 'utf8');

const SAND = '#F7EED9';
const CREAM = '#F1E8D5';
const FOREST = '#2C4A36';
const LIGHT_WORDS = '#FBF7F0';
// The pale green family, by value.
const SAGE = '#E0EBE4';
const SAGE_LINE = '#C9D8CD';
const PALE = '#D6E4DA';
const FAMILY_VALUES = [SAGE, SAGE_LINE, PALE];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Node = { props: Record<string, unknown>; parent: Node | null };
const flat = (node: Node): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

/** The nearest ancestor (or the node itself) that paints a fill. */
function filled(node: Node): Record<string, unknown> {
  for (let at: Node | null = node; at; at = at.parent) {
    const style = flat(at);
    if (typeof style.backgroundColor === 'string') return style;
  }
  throw new Error('no filled ancestor');
}

type Tree = { props: Record<string, unknown>; children?: ReadonlyArray<unknown> };

/** Every node of a rendered tree that the test picks. */
function all(node: Tree, pick: (at: Tree) => boolean, out: Tree[] = []): Tree[] {
  if (pick(node)) out.push(node);
  for (const child of node.children ?? []) {
    if (typeof child === 'object' && child !== null) all(child as Tree, pick, out);
  }
  return out;
}

function holdsNoFamilyValue(style: Record<string, unknown>): void {
  for (const value of Object.values(style)) {
    if (typeof value === 'string') expect(FAMILY_VALUES).not.toContain(value.toUpperCase());
  }
}

describe('the shared definitions (203-D40 option 1)', () => {
  it('the cream card is cream with a 3 pt forest left edge, from existing tokens', () => {
    expect(schemeCard).toEqual({ backgroundColor: CREAM, borderLeftWidth: 3, borderLeftColor: FOREST });
    expect(schemeCard.backgroundColor).toBe(colors.cream);
    expect(schemeCard.borderLeftColor).toBe(colors.forest);
  });

  it("a panel's own outline is the theme's border colour on the other three sides, never the left", () => {
    expect(schemeCardOutline).toEqual({
      borderTopColor: lightTokens.border, borderRightColor: lightTokens.border, borderBottomColor: lightTokens.border,
    });
  });

  it('the forest bar is forest with the light words token', () => {
    expect(schemeBar).toEqual({ fill: FOREST, text: LIGHT_WORDS, border: FOREST });
    expect(schemeBar.fill).toBe(colors.forest);
    expect(schemeBar.text).toBe(lightTokens.textOnAccent);
  });

  it('the pale green family keeps its values: its other readers are state tints, chips, discs, tracks and hairlines', () => {
    expect(semantic.success.bg).toBe(SAGE);
    expect(lightTokens.surface.sage).toBe(SAGE);
    expect(lightTokens.surface.sageLine).toBe(SAGE_LINE);
    expect(forestPop.sage).toBe(SAGE);
    expect(forestPop.sageLine).toBe(SAGE_LINE);
    expect(brand[50]).toBe(PALE);
    expect(Colors.primaryPale).toBe(PALE);
    expect(Colors.feedbackSuccessBg).toBe(SAGE);
    expect(semantic.success.fg).toBe('#1C3023');
    expect(semantic.success.border).toBe('#6E9479');
    expect(semantic.success.icon).toBe('#2C4A36');
  });

  it('the dark theme is unchanged', () => {
    expect(darkTokens.surface.sage).toBe('#17211A');
    expect(darkTokens.surface.sageLine).toBe('#2A3A2F');
  });
});

describe('members mounted as the app mounts them', () => {
  // CourseWeekScreen and CourseLessonScreen both mount this one piece (rows below hold the two mounts).
  it("the coach's note is the cream card with its outline in the border colour", async () => {
    const view = await render(<CoachNote from="From Sam" text="Take the stairs this week." testID="note" />);
    const style = flat(view.getByTestId('note') as unknown as Node);
    expect(style).toMatchObject(schemeCard);
    expect(style).toMatchObject(schemeCardOutline);
    expect(style.borderColor).toBeUndefined();
    expect(style.borderWidth).toBe(StyleSheet.hairlineWidth);
    holdsNoFamilyValue(style);
  });

  it('the completion toast is the forest bar with light words', async () => {
    const view = await render(<CompletionToast state={{ message: 'Cohort created.', key: 1 }} testID="toast" />);
    const style = flat((await view.findByTestId('toast')) as unknown as Node);
    expect(style.backgroundColor).toBe(schemeBar.fill);
    expect(style.borderColor).toBe(schemeBar.border);
    expect(flat(view.getByText('Cohort created.') as unknown as Node).color).toBe(schemeBar.text);
    holdsNoFamilyValue(style);
    expect(contrast(schemeBar.text, schemeBar.fill)).toBeGreaterThanOrEqual(9.18);
  });

  it("the autosave pill's saved state is the forest bar with light words and icon", async () => {
    const view = await render(<AutosaveStatusPill status="saved" lastSavedAt={Date.now()} testID="pill" />);
    const words = view.getByText(/Saved/) as unknown as Node;
    expect(flat(words).color).toBe(schemeBar.text);
    const pill = filled(words);
    expect(pill.backgroundColor).toBe(schemeBar.fill);
    expect(pill.borderColor).toBe(schemeBar.border);
    holdsNoFamilyValue(pill);
    // Every word and icon colour drawn inside the pill is the light words token: nothing keeps the success green.
    const drawn = all(view.container as unknown as Tree, () => true)
      .map((node) => node.props.color ?? (StyleSheet.flatten(node.props.style as never) as { color?: unknown } | undefined)?.color)
      .filter((value): value is string => typeof value === 'string');
    expect(drawn.length).toBeGreaterThan(0);
    for (const value of drawn) expect(value).toBe(schemeBar.text);
  });

  // The other states are not success messages: they read the tokens they read on main.
  it.each([
    ['saving', {}, /Saving/, (): string => lightTokens.textMuted, (): string => lightTokens.bgSurface],
    ['syncing', {}, /Syncing latest version/, (): string => semantic.info.fg, (): string => semantic.info.bg],
    ['offline', {}, /Offline — saved on device, will sync/, (): string => semantic.warning.fg, (): string => semantic.warning.bg],
    ['offline', { mirrorDegraded: true }, /Unable to save on this device/, (): string => semantic.warning.fg, (): string => semantic.warning.bg],
    ['offline', { refused: true }, /Not saved — no edit access/, (): string => semantic.warning.fg, (): string => semantic.warning.bg],
    ['conflict', {}, /Edited elsewhere — tap to refresh/, (): string => semantic.warning.fg, (): string => semantic.warning.bg],
  ] as const)('the pill in %s %j is unchanged', async (status, extra, label, fg, bg) => {
    const view = await render(<AutosaveStatusPill status={status} lastSavedAt={null} onPress={() => undefined} {...extra} />);
    const words = view.getByText(label) as unknown as Node;
    expect(flat(words).color).toBe(fg());
    expect(filled(words).backgroundColor).toBe(bg());
    expect(filled(words).backgroundColor).not.toBe(schemeBar.fill);
  });
});

// One row per member: the file, the text its style holds at the member, and what must not be there any more.
// "holds" is the member's own line as the app draws it; the census below proves no family name is left in the file
// beyond the uses its row names.
const MEMBERS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['the coach note on a course week and lesson', 'screens/client/learn/CourseParts.tsx', '[styles.note, schemeCardOutline, schemeCard]', 'PANEL'],
  ['a course week mounts that note', 'screens/client/learn/CourseWeekScreen.tsx', '<CoachNote', 'PANEL'],
  ['a course lesson mounts that note', 'screens/client/learn/CourseLessonScreen.tsx', '<CoachNote', 'PANEL'],
  ['the coach note on Train', 'screens/client/train/TrainToday.tsx', '[s.card, schemeCard]} testID="train-coach-note"', 'PANEL'],
  ['the "coach changed this" row on Train', 'screens/client/train/TrainToday.tsx', 'changed && [s.changed, schemeCard]', 'PANEL'],
  ['the "coach changed this" row on the assignment page', 'screens/client/WorkoutAssignmentDetailScreen.tsx', 'changed && [styles.changed, schemeCard]', 'PANEL'],
  ['the macros note', 'screens/client/ClientMacrosScreen.tsx', '[styles.note, schemeCard]} testID="macros-note"', 'PANEL'],
  ['the Learn guidelines card', 'screens/client/learn/LearnScreen.tsx', 'card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, ...schemeCardOutline, ...schemeCard,', 'PANEL'],
  ['the You coach card', 'screens/client/YouScreen.tsx', 'card: { ...schemeCard, borderRadius: radius.card, padding: 20 }', 'PANEL'],
  ['the week summary', 'screens/client/progress/WeekInReviewScreen.tsx', '[s.summary, schemeCard,', 'PANEL'],
  ['the training tile', 'screens/client/progress/ProgressV2.tsx', '[tile, schemeCard]} testID="progress-training"', 'PANEL'],
  ['the meal builder first card', 'screens/coach/meals/mealUi.tsx', '[s.card, schemeCard]', 'PANEL'],
  ['the meal plan note card', 'screens/coach/meals/DayPlanBuilderScreen.tsx', '[ms.card, styles.noteCard, schemeCard]', 'PANEL'],
  ['the history edit exercise card', 'screens/client/WorkoutHistoryEditScreen.tsx', 'borderWidth: 1, borderBottomWidth: 1, ...schemeCardOutline, ...schemeCard,', 'PANEL'],
  ['the builder stepper card', 'screens/coach/CoachWorkoutBuilderScreen.tsx', '[styles.stepperCard, schemeCardOutline, schemeCard]', 'PANEL'],
  ['the Direct messages entry row', 'screens/community/coach-dm/CoachDmEntryRow.tsx', 'borderRadius: radius.lg, ...schemeCard }', 'PANEL'],
  ['the card of the exercise in progress', 'screens/client/active-workout/ExerciseCard.tsx', 'borderWidth: 1,\n    ...schemeCardOutline,\n    ...schemeCard,', 'PANEL'],
  // MERGEUP-994 (operator ruling, Almalfi): the two panels main added after this PR's base (m#986, m#989).
  ['the Since week 1 tile on an exercise\'s history', 'screens/client/workouts/exerciseHistoryStyleC.tsx', '[s.tile, schemeCard]} testID="exercise-history-since"', 'PANEL'],
  ["the client's check-in box on Roman's draft sheet", 'screens/coach/client-detail/CheckInDraftSheet.tsx', '...(light ? schemeCard : { backgroundColor: sem.bgSurface })', 'PANEL'],
  ['the completion toast', 'components/community/CompletionToast.tsx', 'backgroundColor: schemeBar.fill,', 'SUCCESS MESSAGE'],
  ['the completion toast words', 'components/community/CompletionToast.tsx', '{ color: schemeBar.text }', 'SUCCESS MESSAGE'],
  ['the saved state of the autosave pill', 'components/workout/AutosaveStatusPill.tsx', "icon: 'checkmark-circle-outline',\n          fg: schemeBar.text,\n          bg: schemeBar.fill,\n          border: schemeBar.border,", 'SUCCESS MESSAGE'],
];

// The six screens that mount the toast, and the one that mounts the pill: none passes a colour of its own.
const TOAST_MOUNTS = [
  'screens/community/CoachCommunityCohortDetailScreen.tsx',
  'screens/community/CoachCommunityCohortsScreen.tsx',
  'screens/community/CoachCommunityEventsScreen.tsx',
  'screens/community/CoachCommunityInboxScreen.tsx',
  'screens/community/CoachCommunityModerationScreen.tsx',
  'screens/community/CommunityEventDetailScreen.tsx',
];

describe('every member reads the shared definition', () => {
  it.each(MEMBERS)('%s (%s)', (_what, file, holds) => {
    expect(read(file)).toContain(holds);
  });

  it.each(TOAST_MOUNTS)('%s mounts the toast with no colour of its own', (file) => {
    const mounts = read(file).match(/<CompletionToast[^>]*>/g) ?? [];
    expect(mounts.length).toBe(1);
    expect(mounts[0]).not.toMatch(/style|color|Color/);
  });

  it('the workout builder mounts the pill with no colour of its own', () => {
    const mounts = read('screens/coach/CoachWorkoutBuilderScreen.tsx').match(/<AutosaveStatusPill[^>]*>/g) ?? [];
    expect(mounts.length).toBe(1);
    expect(mounts[0]).not.toMatch(/style|color|Color/);
  });

  it('no member carries its own edge width or the family in its own line', () => {
    for (const [, file, holds] of MEMBERS) {
      expect(holds).not.toMatch(/sage|success\.bg|primaryPale|borderLeftWidth: 3/);
      expect(read(file)).not.toMatch(/borderLeftColor: (sc|t)\.data\.forest/);
    }
  });
});

// ─── The census ──────────────────────────────────────────────────────────────
// Every line under src/ outside tests that names the family, by token, alias or value. [file, lines, role].
// A member has no line here: it reads the shared definition. Roles left pale green are not panels (v1.1, #203-E56).
const FAMILY = new RegExp(
  [
    'success\\.bg', 'successBg', 'feedbackSuccessBg', '(^|[^A-Za-z])sage([^A-Za-z]|$)',
    '(^|[^A-Za-z])sageLine([^A-Za-z]|$)', 'brand\\[50\\]', 'primaryPale',
    ['e0', 'eb', 'e4'].join(''), ['c9', 'd8', 'cd'].join(''), ['d6', 'e4', 'da'].join(''),
    'rgba?\\(\\s*224[,\\s]+235[,\\s]+228', 'rgba?\\(\\s*201[,\\s]+216[,\\s]+205', 'rgba?\\(\\s*214[,\\s]+228[,\\s]+218',
  ].join('|'),
  'i',
);

const CENSUS: ReadonlyArray<readonly [string, number, string]> = [
  ['components/ExerciseLogModal.tsx', 1, 'not mounted by any screen'],
  ['components/FoodImage.tsx', 1, 'image placeholder'],
  ['components/NotificationRow.tsx', 1, 'icon circle'],
  ['components/anticipation/CountdownTile.tsx', 1, 'not mounted by any screen'],
  ['components/coach/CoachAiSection.tsx', 3, 'button, button, and the "draft is ready" banner (could not place: the operator rules)'],
  ['components/coach/ai-budget/AIBudgetTutorialModal.tsx', 1, 'icon circle'],
  ['components/community/ComposerInput.tsx', 7, 'hairline on a white field, the Send disc (a control), comment'],
  ['components/community/DmCoachCard.tsx', 2, 'avatar tile letter (on the forest tile), comment'],
  ['components/community/DmRow.tsx', 4, 'hairline, avatar tile, comment'],
  ['components/community/MessageBubble.tsx', 4, 'hairline on a white bubble, comment'],
  ['components/community/SpaceTree.tsx', 1, 'chip'],
  ['components/community/ThreadHeader.tsx', 2, 'avatar tile, comment'],
  ['components/community/space-chat/SpaceMessageSheet.tsx', 1, 'sheet grab'],
  ['components/log/FoodDayView.tsx', 1, 'icon circle'],
  ['components/messaging/ConversationClosed.tsx', 2, 'hairline, comment'],
  ['components/messaging/MessageActionSheet.tsx', 2, 'sheet grab, comment'],
  ['components/renewal/HouseMasthead.tsx', 2, 'hairline on a white card'],
  ['components/roman/CompetencePill.tsx', 1, 'comment'],
  ['components/trust/SignoffStatusChip.tsx', 2, 'chip'],
  ['components/trust/TrustCueRow.tsx', 1, 'chip'],
  ['constants/colors.ts', 2, 'token'],
  ['constants/theme.ts', 1, 'secondary button'],
  ['screens/client/BrandedCheckoutWebViewScreen.tsx', 3, 'skeleton'],
  ['screens/client/CoachGuidelinesScreen.tsx', 2, 'remapped to the page colour: not a pale green on screen'],
  ['screens/client/EducationScreen.tsx', 3, 'remapped to the border colour: not a pale green on screen'],
  ['screens/client/HouseCoachConfirmScreen.tsx', 2, 'hairline, step dot'],
  ['screens/client/HouseCoachScreen.tsx', 4, 'hairline on a white card, step dot'],
  ['screens/client/HousePackageScreen.tsx', 1, 'hairline'],
  ['screens/client/PrepGuideScreen.tsx', 2, 'remapped to the page colour: not a pale green on screen'],
  ['screens/client/WorkoutHistoryEditScreen.tsx', 5, 'state tint (a completed set row), hairline on a white field'],
  ['screens/client/YouScreen.tsx', 2, 'hairline on a white card'],
  ['screens/client/active-workout/WorkoutSummaryC5.tsx', 1, 'icon tile'],
  ['screens/client/active-workout/styles.ts', 1, 'state tint (a completed set row)'],
  ['screens/client/habits/ring/HabitsRing.tsx', 5, 'hairline on a white card, state tint (a done habit tile)'],
  ['screens/client/wearables/components/FreshnessChip.tsx', 1, 'chip'],
  ['screens/client/wearables/recoveryTestColors.ts', 1, 'test colours, not drawn by the app'],
  ['screens/coach/CoachBillingScreen.tsx', 1, 'chip'],
  ['screens/coach/CoachHomeScreen.tsx', 5, 'icon circle, button'],
  ['screens/coach/CoachInvitesScreen.tsx', 1, 'button'],
  ['screens/coach/CoachWorkoutBuilderScreen.tsx', 2, 'hairline on a white card, hairline between the stepper lines'],
  ['screens/coach/InviteCodesScreen.tsx', 1, 'button'],
  ['screens/coach/brief/CoachBriefListScreen.tsx', 1, 'hairline'],
  ['screens/coach/client-detail/WeeklySummaryTab.tsx', 1, 'chip'],
  ['screens/coach/client-detail/styles.ts', 4, 'button, progress track'],
  ['screens/coach/cross-pillar/CrossPillarClientDetailScreen.tsx', 1, 'state tint (the selected tab)'],
  ['screens/coach/cross-pillar/CrossPillarClientsListScreen.tsx', 1, 'state tint (the selected filter chip)'],
  ['screens/coach/lookup/ClientPeekSheet.tsx', 4, 'hairline, comment'],
  ['screens/coach/payments/CoachPackageSubscribersScreen.tsx', 1, 'chip'],
  ['screens/coach/payments/CoachPackagesListScreen.tsx', 1, 'chip'],
  ['screens/coach/programs/ProgramAssignScreen.tsx', 3, 'avatar tile, comment'],
  ['screens/coach/programs/ProgramEditorScreen.tsx', 1, 'state tint (a day cell that holds a workout)'],
  ['screens/community/CommunityHomeScreen.tsx', 3, 'icon tile, skeleton'],
  ['screens/community/coach-dm/CoachDmListScreen.tsx', 4, 'skeleton, comment'],
  ['screens/community/coach-dm/CoachDmNewScreen.tsx', 1, 'avatar tile'],
  ['screens/community/coach-dm/coachDm.tsx', 1, 'hairline'],
  ['screens/day-one/NotificationsScreen.tsx', 1, 'icon circle'],
  ['theme/ThemeProvider.tsx', 1, 'token type'],
  ['theme/index.ts', 3, 'token alias'],
  ['theme/tokens.ts', 9, 'token'],
  ['ui/charts/StyleCMarks.tsx', 1, 'comment'],
];

function census(): Map<string, number> {
  const found = new Map<string, number>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__snapshots__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const hits = fs.readFileSync(full, 'utf8').split(/\r?\n/).filter((line) => FAMILY.test(line)).length;
        if (hits > 0) found.set(path.relative(SRC, full).split(path.sep).join('/'), hits);
      }
    }
  };
  walk(SRC);
  return found;
}

describe('census of the pale green family under src/', () => {
  const found = census();

  it('every use is in the table with its role: a new pale green use needs a row (or is a panel and reads the shared card)', () => {
    const table = new Map(CENSUS.map(([file, lines]) => [file, lines]));
    const unseen = [...found].filter(([file, lines]) => table.get(file) !== lines).map(([file, lines]) => `${file}: ${lines} (table: ${table.get(file) ?? 'none'})`);
    expect(unseen).toEqual([]);
  });

  it('every row of the table still exists', () => {
    const gone = CENSUS.filter(([file]) => !found.has(file)).map(([file]) => file);
    expect(gone).toEqual([]);
  });

  it('every row names its role', () => {
    for (const [, lines, role] of CENSUS) {
      expect(lines).toBeGreaterThan(0);
      expect(role.length).toBeGreaterThan(3);
    }
  });

  it.each([
    'screens/client/learn/CourseParts.tsx', 'screens/client/train/TrainToday.tsx',
    'screens/client/WorkoutAssignmentDetailScreen.tsx', 'screens/client/ClientMacrosScreen.tsx',
    'screens/client/learn/LearnScreen.tsx', 'screens/client/progress/WeekInReviewScreen.tsx',
    'screens/client/progress/ProgressV2.tsx', 'screens/coach/meals/mealUi.tsx',
    'screens/coach/meals/DayPlanBuilderScreen.tsx', 'screens/community/coach-dm/CoachDmEntryRow.tsx',
    'screens/client/active-workout/ExerciseCard.tsx', 'components/community/CompletionToast.tsx',
    'components/workout/AutosaveStatusPill.tsx', 'screens/client/workouts/exerciseHistoryStyleC.tsx',
    'screens/coach/client-detail/CheckInDraftSheet.tsx',
  ])('%s holds no family name at all', (file) => {
    expect(found.has(file)).toBe(false);
  });

  // Left exactly as on main: one of each role the table names.
  it.each([
    ['a completed set row', 'screens/client/WorkoutHistoryEditScreen.tsx', 'setRowCompleted: { ...base.setRowCompleted, backgroundColor: sc.surface.sage, borderBottomWidth: 0 }'],
    ['a done habit tile', 'screens/client/habits/ring/HabitsRing.tsx', 'tileDone: { backgroundColor: sc.surface.sage, borderColor: sc.surface.sage }'],
    ['a chip', 'components/trust/SignoffStatusChip.tsx', 'bg: semantic.success.bg'],
    ['an icon circle', 'components/NotificationRow.tsx', 'backgroundColor: colors.primaryPale'],
    ['the secondary button', 'constants/theme.ts', 'backgroundColor: Colors.primaryPale,'],
    ['a progress track', 'screens/coach/client-detail/styles.ts', 'height: 6, borderRadius: radius.chip, backgroundColor: colors.primaryPale'],
    ['a skeleton', 'screens/community/coach-dm/CoachDmListScreen.tsx', 'styles.skBar, { backgroundColor: fp.sage }'],
    ["a white card's sage hairline", 'screens/client/YouScreen.tsx', 'rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.surface.sageLine }'],
  ])('%s still reads the family in %s', (_what, file, holds) => {
    expect(read(file)).toContain(holds);
  });
});

// ─── Text and ground pairs on Sunlit sand ────────────────────────────────────
// [what, text, ground, the floor it must clear, the measured ratio cut to two places, main's ratio on its near-white page].
// 4.5:1 for body text; 3:1 for 18 pt, bold 14 pt and icons.
const PAIRS: ReadonlyArray<readonly [string, () => string, () => string, number, number, number]> = [
  ['ink on the page', () => colors.ink, () => lightTokens.bgPrimary, 4.5, 15.09, 16.58],
  ['graphite on the page', () => colors.graphite, () => lightTokens.bgPrimary, 4.5, 12.09, 13.28],
  ['charcoal on the page', () => colors.charcoal, () => lightTokens.bgPrimary, 4.5, 9.43, 10.36],
  ['forest on the page', () => colors.forest, () => lightTokens.bgPrimary, 4.5, 8.49, 9.33],
  ['gold[800] on the page (the recipe step numerals)', () => gold[800], () => lightTokens.bgPrimary, 4.5, 6.59, 7.24],
  ['neutral[700] on the page', () => neutral[700], () => lightTokens.bgPrimary, 4.5, 5.99, 6.59],
  ['error on the page', () => colors.error, () => lightTokens.bgPrimary, 4.5, 5.6, 6.15],
  ['textMuted on the page', () => lightTokens.textMuted, () => lightTokens.bgPrimary, 4.5, 4.87, 5.35],
  ['brand[400] on the page', () => brand[400], () => lightTokens.bgPrimary, 4.5, 4.81, 5.29],
  ['semantic.warning.fg on the page (a connection row)', () => semantic.warning.fg, () => lightTokens.bgPrimary, 4.5, 6.59, 4.78],
  ['Colors.noticeWarningText on the page', () => Colors.noticeWarningText, () => Colors.background, 4.5, 6.59, 4.78],
  ['page-coloured words on forest', () => Colors.textOnPrimary, () => colors.forest, 4.5, 8.49, 9.33],
  ['light words on the offline banner', () => lightTokens.textOnAccent, () => Colors.offlineBanner, 4.5, 4.7, 4.78],
  ['light words on the mobility template button', () => lightTokens.textOnAccent, () => Colors.templateMobility, 4.5, 4.5, 4.58],
  ['ink on the cream card', () => colors.ink, () => schemeCard.backgroundColor, 4.5, 14.31, 14.25],
  ['forest on the cream card', () => colors.forest, () => schemeCard.backgroundColor, 4.5, 8.05, 8.03],
  ['textMuted on the cream card', () => lightTokens.textMuted, () => schemeCard.backgroundColor, 4.5, 4.62, 4.6],
  ['neutral[700] on the cream card', () => neutral[700], () => schemeCard.backgroundColor, 4.5, 5.68, 5.67],
  ['light words on the forest bar', () => schemeBar.text, () => schemeBar.fill, 4.5, 9.18, 11.48],
  ['the forest edge against the cream card', () => schemeCard.borderLeftColor, () => schemeCard.backgroundColor, 3, 8.05, 0],
  ['the forest edge against the page', () => schemeCard.borderLeftColor, () => lightTokens.bgPrimary, 3, 8.49, 0],
];

describe('text and ground pairs on Sunlit sand (owner #203-E86)', () => {
  it('the page is Sunlit sand', () => {
    expect(lightTokens.bgPrimary).toBe(SAND);
    expect(Colors.background).toBe(SAND);
  });

  it.each(PAIRS)('%s', (_what, text, ground, floor, measured) => {
    const ratio = contrast(text(), ground());
    expect(ratio).toBeGreaterThanOrEqual(floor);
    expect(ratio).toBeGreaterThanOrEqual(measured);
  });

  it('the warning text tokens are the darker gold; the warning ink keeps its value (the safety alert reads it)', () => {
    expect(semantic.warning.fg).toBe(gold[800]);
    expect(Colors.noticeWarningText).toBe(gold[800]);
    expect(colors.warningInk).toBe(gold[700]);
  });

  it.each([
    ['the recipe step numerals read gold[800]', 'screens/client/RecipeDetailScreen.tsx', 'stepNumberText: { ...typography.h3, color: gold[800] }', 'color: gold[700]'],
    ["the offline banner's icon is the light words token", 'components/OfflineBanner.tsx', 'size={12} color={lightTokens.textOnAccent}', 'Colors.textOnPrimary'],
    ["the offline banner's words are the light words token", 'components/OfflineBanner.tsx', 'color: lightTokens.textOnAccent,', 'Colors.textOnPrimary'],
    ["the template button's icon is the light words token", 'screens/coach/ProgramTemplatesScreen.tsx', 'size={18} color={lightTokens.textOnAccent}', 'size={18} color={colors.textOnPrimary}'],
    ["the template button's words are the light words token", 'screens/coach/ProgramTemplatesScreen.tsx', "applyBtnText: {\n    // The warm near-white: 4.51:1 on the mobility template's fill (the Sunlit sand page colour would be 4.17:1).\n    color: lightTokens.textOnAccent,", 'applyBtnText: {\n    color: colors.textOnPrimary'],
  ])('%s', (_what, file, holds, gone) => {
    const source = read(file);
    expect(source).toContain(holds);
    expect(source).not.toContain(gone);
  });
});
