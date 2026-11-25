/**
 * REFINE-985R3 FONT-1 (LO-985R2 C2 = LS-985R2 C1). A fontFamily that names a face the app never loads is drawn in the
 * phone's own face, and a style test that pins the name cannot tell. The class: every Inter_ or CormorantGaramond_
 * face named under src or in App.tsx is one App.tsx's useFonts loads before any screen is drawn (both read from the
 * files). Found at m#985's reviewed head: the DM bar's coach tile (ThreadHeader.tsx voiceBTileText) and the space
 * chat row's coach initial (SpaceChatRow.tsx coachInitial), both CormorantGaramond_600SemiBold.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const FACE = /['"`]((?:Inter|CormorantGaramond)_[0-9]{3}[A-Za-z]+(?:_Italic)?)['"`]/g;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : sources(p);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

/** The faces App.tsx hands to useFonts, by the names it imports them under. */
function loadedByApp(): string[] {
  const app = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
  const block = /useFonts\(\{([\s\S]*?)\}\)/.exec(app);
  if (!block) throw new Error('App.tsx no longer calls useFonts({ ... })');
  return block[1].split(/[\s,]+/).map((w) => w.split(':')[0].trim()).filter((w) => /^(Inter|CormorantGaramond)_/.test(w));
}

/**
 * Found, not fixed (REFINE-985R3): faces named in a file that App.tsx does not load, with the line at this round's
 * head. The italic is loaded by a useFonts call in each file that names it, so it is drawn once that screen has
 * mounted; Inter_700Bold is loaded nowhere. Neither is this PR's screen.
 */
const KNOWN = [
  'src/components/log/FoodDayView.tsx CormorantGaramond_400Regular_Italic', // :620, its own useFonts :151
  'src/components/roman/RomanHeldCard.tsx CormorantGaramond_400Regular_Italic', // :150, its own useFonts :34
  'src/screens/client/learn/CourseParts.tsx CormorantGaramond_400Regular_Italic', // :73, its own useFonts :29
  'src/screens/client/learn/LearnScreen.tsx CormorantGaramond_400Regular_Italic', // :166, its own useFonts :31
  'src/screens/client/mealplan/planStyleC.tsx CormorantGaramond_400Regular_Italic', // :349, its own loader :48
  'src/screens/client/train/TrainToday.tsx CormorantGaramond_400Regular_Italic', // :318, its own useFonts :175
  'src/screens/client/workouts/workoutStyleC.tsx CormorantGaramond_400Regular_Italic', // :77, its own loader :79
  'src/screens/consultation/components.tsx CormorantGaramond_400Regular_Italic', // :127, its own useFonts :130
  'src/screens/coach/cross-pillar/PracticeSelectionScreen.tsx Inter_700Bold', // :251, loaded nowhere
];

describe('every Inter and Cormorant Garamond face the app names is one it loads', () => {
  const loaded = loadedByApp();

  it('App.tsx loads the faces the DM bar\'s coach tile and the space chat row\'s coach initial ask for', () => {
    expect(loaded).toEqual(expect.arrayContaining(['CormorantGaramond_400Regular', 'CormorantGaramond_500Medium',
      'CormorantGaramond_600SemiBold', 'Inter_400Regular', 'Inter_500Medium', 'Inter_600SemiBold']));
  });

  it('no file under src, nor App.tsx, names a face App.tsx does not load (beyond the listed ones)', () => {
    const named = [...sources(path.join(ROOT, 'src')), path.join(ROOT, 'App.tsx')].flatMap((file) => {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const faces = new Set([...fs.readFileSync(file, 'utf8').matchAll(FACE)].map((m) => m[1]));
      return [...faces].map((face) => ({ rel, face }));
    });
    expect(named.length).toBeGreaterThan(100); // the walk found the app
    const notLoaded = named.filter((n) => !loaded.includes(n.face)).map((n) => `${n.rel} ${n.face}`)
      .filter((entry) => !KNOWN.includes(entry)).sort();
    expect(notLoaded).toEqual([]);
  });
});
