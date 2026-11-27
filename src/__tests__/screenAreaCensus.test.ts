/**
 * OFFLINE-BAND-ROOT-M (T3): the census of what reads the screen area and what reads the window, src read as text
 * (tests excluded).
 *
 * 1. Keyboard views. React Native's KeyboardAvoidingView counts its own place from its parent, so a screen's view
 *    misses whatever sits above the screen area (the offline band: 101 pt on the 390 iPhone). Every
 *    <KeyboardAvoidingView in src is classified: SCREEN (a screen's own: passes keyboardVerticalOffset from
 *    useScreenAreaKeyboardOffset), MODAL or SHEET (inside a <Modal> or a native page sheet, which measure the keyboard
 *    in their own window: no offset), or WAITS <PR> (an open PR owns the file; the row stays valid while the file is
 *    absent, so that PR's later merge of main stays green). An unlisted one fails: "classify this
 *    KeyboardAvoidingView".
 * 2. Modal top reads. A Modal draws from the window's top, over the band, while React context still hands its content
 *    the area's insets (top 0 while the band shows). Every file with a <Modal that takes a top from useSafeAreaInsets,
 *    useScreenInsets or SafeAreaInsetsContext is MODAL-READS (the Modal reads it through useWindowInsets), SCREEN-ONLY
 *    (its top read is outside every Modal) or WAITS <PR>; an unlisted one fails: "classify this Modal's top read". The
 *    scan cannot see a Modal whose content reads the top in another file: those are listed by hand below (a Screen
 *    drawn in a Modal passes inModal; ClientPlanPage's masthead reads the window), with the workout summary's
 *    window-height math.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');
const files: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) files.push(p);
  }
};
walk(SRC);
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');
const read = (r: string) => fs.readFileSync(path.join(SRC, r), 'utf8');
const exists = (r: string) => fs.existsSync(path.join(SRC, r));
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** The opening tag at `at`, to its closing `>` outside braces. */
const tagAt = (text: string, at: number) => {
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return text.slice(at, i + 1);
  }
  return text.slice(at);
};
const keyboardTags = (text: string) => Array.from(text.matchAll(/<KeyboardAvoidingView\b/g), (m) => tagAt(text, m.index ?? 0));
const PASSES_OFFSET = /keyboardVerticalOffset=\{(?:inModal \? 0 : )?keyboardOffset\}/;
const CALLS_OFFSET = /const keyboardOffset = useScreenAreaKeyboardOffset\(\);/;

type Kind = 'SCREEN' | 'MODAL' | 'SHEET' | `WAITS m#${number}`;
// file -> kind, count, and why (the Modal at file:line, or the screen it roots); lines at mobile main 27fd81d1.
const KEYBOARD: Record<string, [Kind, number, string]> = {
  'ui/layout/Screen.tsx': ['SCREEN', 1, 'the shared page wrapper; a Screen drawn in a Modal passes inModal (offset 0)'],
  'screens/client/MessagesScreen.tsx': ['SCREEN', 1, "the client's coach thread"],
  'screens/coach/ClientMessagesScreen.tsx': ['SCREEN', 1, "the coach's client thread"],
  'screens/community/CommunityThreadScreen.tsx': ['SCREEN', 1, 'a community thread'],
  'screens/community/coach-dm/CoachDmThreadScreen.tsx': ['SCREEN', 1, "the coach's DM thread"],
  'screens/community/CommunityComposerScreen.tsx': ['SCREEN', 1, 'a new post or message'],
  'screens/client/AIGuideScreen.tsx': ['SCREEN', 1, 'the AI guide chat'],
  'screens/auth/LoginScreen.tsx': ['SCREEN', 1, 'sign in (the older layout; iOS padding, Android height)'],
  'components/OnboardingLayout.tsx': ['SCREEN', 1, 'the legacy onboarding steps'],
  'screens/day-one/CoachPairingScreen.tsx': ['SCREEN', 1, 'Day 1 coach code'],
  'screens/client/LeaderboardScreen.tsx': ['SCREEN', 1, 'the leaderboard'],
  'screens/client/LeaderboardSettingsScreen.tsx': ['SCREEN', 1, 'leaderboard settings'],
  'screens/client/WorkoutHistoryEditScreen.tsx': ['SCREEN', 1, 'edit a past workout'],
  'screens/coach/CoachWorkoutBuilderScreen.tsx': ['SCREEN', 1, "the coach's workout builder"],
  'screens/coach/programs/ProgramFormScreen.tsx': ['SCREEN', 1, 'a program form'],
  'screens/coach/import-journey/ImportSetupView.tsx': ['SCREEN', 1, 'import setup (ImportDataScreen; iOS padding, Android height)'],
  'screens/coach/payments/CoachPackageEditScreen.tsx': ['SCREEN', 1, "the package editor's own column (not its preview Modal)"],
  'screens/community/CommunityDmThreadScreen.tsx': ['WAITS m#1002', 1, 'a member DM thread; m#1002 owns the file'],
  'screens/community/CommunitySpaceChatScreen.tsx': ['WAITS m#945', 1, 'space chat; new in the space chat unit (m#944 + m#945)'],
  'components/ExerciseLogModal.tsx': ['MODAL', 1, '<Modal> :199'],
  'components/coach/ai-builder/AiBuilderSheet.tsx': ['MODAL', 1, '<Modal> :110'],
  'components/coach/ai-execution/AskAiActionSheet.tsx': ['MODAL', 1, '<Modal> :183'],
  'components/community/ChallengeProgressSheet.tsx': ['MODAL', 1, '<Modal> :234'],
  'components/log/FoodSearchModal.tsx': ['MODAL', 1, '<Modal> :136'],
  'components/log/QuantityPickerModal.tsx': ['MODAL', 1, '<Modal> :59 (page sheet) around QuantityPickerBody'],
  'components/mealplan/LogPlannedMealButton.tsx': ['MODAL', 1, '<Modal> :203'],
  'components/messaging/ReportMessageSheet.tsx': ['MODAL', 1, '<Modal> :135'],
  'components/messaging/ThreadV2Parts.tsx': ['MODAL', 1, '<Modal> :158'],
  'screens/client/CommunityScreen.tsx': ['MODAL', 1, '<Modal> :268'],
  'screens/client/LogScreen.tsx': ['MODAL', 1, '<Modal> :911'],
  'screens/client/ProgressScreen.tsx': ['MODAL', 1, '<Modal> :643'],
  'screens/client/SettingsScreen.tsx': ['MODAL', 1, '<Modal> :470'],
  'screens/client/habits/AddHabitSheet.tsx': ['MODAL', 1, '<Modal> :40'],
  'screens/client/progress/LogWeightSheetV2.tsx': ['MODAL', 1, '<Modal> :117'],
  'screens/coach/AIWorkoutDraftScreen.tsx': ['MODAL', 1, '<Modal> :491'],
  'screens/coach/ClientPaymentsScreen.tsx': ['MODAL', 1, '<Modal> :310'],
  'screens/coach/CoachTeamProfileScreen.tsx': ['MODAL', 1, '<Modal> :145'],
  'screens/coach/InviteCodesScreen.tsx': ['MODAL', 1, '<Modal> :312'],
  'screens/coach/SettingsScreen.tsx': ['MODAL', 2, '<Modal> :909 and :964'],
  'screens/coach/client-detail/CheckInDraftSheet.tsx': ['MODAL', 1, '<Modal> :184'],
  'screens/coach/client-detail/NudgeModal.tsx': ['MODAL', 1, '<Modal> :41'],
  'screens/coach/client-detail/WearableInsightPanel.tsx': ['MODAL', 1, '<Modal> :506'],
  'screens/coach/payments/contents/ContentAttachForm.tsx': ['MODAL', 1, '<Modal> :296'],
  'screens/community/CoachCommunityCohortDetailScreen.tsx': ['MODAL', 1, '<Modal> :294'],
  'screens/community/CoachCommunityCohortsScreen.tsx': ['MODAL', 1, '<Modal> :231'],
  'screens/community/CoachCommunityEventsScreen.tsx': ['MODAL', 2, '<Modal> :437 and :711'],
  'screens/settings/RomanChatsConfirmSheet.tsx': ['MODAL', 1, '<Modal> :48'],
};

describe('every KeyboardAvoidingView in src is classified, and only a screen-level one counts the area', () => {
  const found = new Map<string, string[]>();
  for (const f of files) {
    const tags = keyboardTags(read(rel(f)));
    if (tags.length) found.set(rel(f), tags);
  }

  it('none is unlisted, and each listed file has the listed number', () => {
    const problems: string[] = [];
    for (const [f, tags] of found) {
      const row = KEYBOARD[f];
      if (!row) problems.push(`classify this KeyboardAvoidingView: ${f} (${tags.length})`);
      else if (row[1] !== tags.length) problems.push(`${f}: ${tags.length} KeyboardAvoidingView, the census lists ${row[1]}`);
    }
    for (const [f, [kind]] of Object.entries(KEYBOARD)) {
      if (!found.has(f) && !(kind.startsWith('WAITS') && !exists(f))) problems.push(`${f}: listed as ${kind} but has no KeyboardAvoidingView`);
    }
    expect(problems).toEqual([]);
  });

  it.each(Object.entries(KEYBOARD).filter(([, [kind]]) => kind === 'SCREEN'))('SCREEN %s passes the area offset', (f) => {
    const text = read(f);
    expect(text).toMatch(CALLS_OFFSET);
    for (const tag of keyboardTags(text)) expect({ f, tag: tag.slice(0, 80), passes: PASSES_OFFSET.test(tag) }).toEqual({ f, tag: tag.slice(0, 80), passes: true });
  });

  it.each(Object.entries(KEYBOARD).filter(([, [kind]]) => kind === 'MODAL' || kind === 'SHEET'))('%s (in a Modal) passes no area offset', (f) => {
    const text = read(f);
    expect(text).not.toMatch(/useScreenAreaKeyboardOffset/);
    for (const tag of keyboardTags(text)) expect(tag).not.toMatch(/keyboardOffset/);
  });
});

type ModalKind = 'MODAL-READS' | 'SCREEN-ONLY' | `WAITS m#${number}`;
// file -> kind, the read it must hold (MODAL-READS: through useWindowInsets; WAITS: the read its follow-up changes), why.
const MODAL_TOPS: Record<string, [ModalKind, RegExp, string]> = {
  'components/log/FoodSearchModal.tsx': ['MODAL-READS', /const insets = useWindowInsets\(\);/, "the food log's add sheet: overlay top and sheet height"],
  'components/community/coach/FlaggedPhoto.tsx': ['MODAL-READS', /const insets = useWindowInsets\(\);/, 'the flagged photo viewer: Close under the clock'],
  'screens/client/learn/CourseMomentSheet.tsx': ['MODAL-READS', /const insets = useWindowInsets\(\);/, "a course moment: the peak's top"],
  'screens/coach/client-detail/NudgeModal.tsx': ['MODAL-READS', /const topInset = useWindowInsets\(\)\.top;/, "the nudge sheet's top spacer"],
  'screens/coach/client-detail/WearableInsightPanel.tsx': ['MODAL-READS', /const topInset = useWindowInsets\(\)\.top;/, "the insight review sheet's top margin"],
  'screens/community/CoachCommunityEventsScreen.tsx': ['MODAL-READS', /const insets = useWindowInsets\(\);[\s\S]*const insets = useWindowInsets\(\);/, 'both event overlays (:404 and :650 at 27fd81d1)'],
  'screens/coach/payments/CoachPackageEditScreen.tsx': ['MODAL-READS', /function PreviewBar[\s\S]*const insets = useWindowInsets\(\);/, "the buyer preview's bar (Android full screen); the editor's own bar keeps the area's"],
  'screens/coach/SettingsScreen.tsx': ['SCREEN-ONLY', /paddingTop: insets\.top \+ layout\.statusBarGap/, 'the top read (:452-453) is the page header, outside both Modals (:909, :964)'],
  'components/community/SpaceDrawer.tsx': ['WAITS m#945', /useSafeAreaInsets\(\)/, 'the space drawer pads by insets.top + 12; m#945 owns the file'],
  'components/workout/RefusedWorkoutCard.tsx': ['WAITS m#1000', /useSafeAreaInsets\(\)/, "the refusal sheet's scrim pads by insets.top + 8; new in m#1000"],
};
const TOP_SOURCE = /useSafeAreaInsets\(|useScreenInsets\(|SafeAreaInsetsContext\b/;
const TOP_READ = /\binsets\.top\b|SafeAreaInsetsContext\)\?\.top|use(?:SafeArea|Screen)Insets\(\)\.top|\{\s*top\b[^}]*\}\s*=\s*use(?:SafeArea|Screen)Insets\(/;

describe("every Modal that reads a top inset reads the window's", () => {
  it("none is unlisted", () => {
    const problems: string[] = [];
    for (const f of files) {
      const text = stripComments(read(rel(f)));
      if (/<Modal\b/.test(text) && TOP_SOURCE.test(text) && TOP_READ.test(text) && !MODAL_TOPS[rel(f)]) {
        problems.push(`classify this Modal's top read: ${rel(f)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(Object.entries(MODAL_TOPS))('%s holds its listed read', (f, [kind, re]) => {
    if (kind.startsWith('WAITS') && !exists(f)) return;
    expect(read(f)).toMatch(re);
  });

  // Modal content in another file (the scan above cannot see it), and window-height math.
  const IN_MODAL: Array<[string, number, string]> = [
    ['screens/coach/CoachLessons.tsx', 2, "sheet(): the lessons list and the editor, in a page sheet Modal (Android: full screen)"],
    ['screens/coach/ProgramTemplatesScreen.tsx', 1, 'the template picker in its Modal (:242); the page itself stays a plain Screen'],
    ['screens/join/JoinPackageScreen.tsx', 1, "its Screen (:157), drawn in JoinPackageHost.tsx's page sheet Modal (Android: full screen)"],
    ['screens/client/packageDetail/ClientPlanPresentation.tsx', 1, "ClientPlanPage, drawn only in ClientPackagesScreen.tsx's full-screen Modal"],
  ];
  it.each(IN_MODAL)('%s: each Screen drawn in a Modal passes inModal (%i)', (f, n) => {
    const tags = Array.from(read(f).matchAll(/<Screen\b/g), (m) => tagAt(read(f), m.index ?? 0));
    expect(tags.filter((t) => /\binModal\b/.test(t))).toHaveLength(n);
  });
  it("ClientPlanPage's masthead reads the window's top; its footer padding keeps the area's bottom", () => {
    expect(read('screens/client/packageDetail/ClientPlanPresentation.tsx')).toMatch(/paddingTop: useWindowInsets\(\)\.top \+ 12|paddingTop: windowTop \+ 12/);
  });
  it("the workout summary's ring takes its room from the window's top, not the area's", () => {
    expect(read('screens/client/active-workout/WorkoutSummaryC5.tsx')).toMatch(/ringSize\(useWindowDimensions\(\)\.height - useWindowInsets\(\)\.top - insets\.bottom\)/);
  });
});
