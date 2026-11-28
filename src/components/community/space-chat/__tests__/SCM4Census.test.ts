/**
 * SC-M4 (agent 203), case T12, the census of class (a) "what leaves the phone": src/ read as text, tests out. Exactly two
 * files load expo-image-picker (m#992's meal photo and the space chat's photos, both with MEAL_PHOTO_OPTIONS), and
 * exactly one file draws the space chat's "+". A third picker, or a second "+", is a new sender to read before it ships.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../../..');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : sources(p);
    return /\.(tsx?|jsx?)$/.test(d.name) && !/\.test\.(tsx?|jsx?)$/.test(d.name) ? [p] : [];
  });
}
const files = sources(SRC).map((p) => ({ file: path.relative(SRC, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }));

describe('SCM4 T12: the census', () => {
  it('SCM4 T12: exactly two files in src/ load expo-image-picker', () => {
    const pickers = files.filter((f) => /['"]expo-image-picker['"]/.test(f.text)).map((f) => f.file).sort();
    expect(pickers).toEqual(['components/community/space-chat/spaceChatPhotos.ts', 'utils/log/mealPhoto.ts']);
  });

  it('SCM4 T12: the space chat\'s photos take the picker\'s options from mealPhoto.ts, never a literal of their own', () => {
    const photos = files.find((f) => f.file === 'components/community/space-chat/spaceChatPhotos.ts')?.text ?? '';
    expect(photos).toMatch(/require\('\.\.\/\.\.\/\.\.\/utils\/log\/mealPhoto'\)/);
    expect(photos).toMatch(/launchImageLibraryAsync\(MEAL_PHOTO_OPTIONS\)/);
    expect(photos).not.toMatch(/quality\s*:/);
    expect(photos).not.toMatch(/launchCameraAsync|requestMediaLibraryPermissionsAsync|requestCameraPermissionsAsync/);
  });

  it('SCM4 T12: exactly one file draws testID "space-chat-plus"', () => {
    const plus = files.filter((f) => /testID="space-chat-plus"/.test(f.text)).map((f) => f.file);
    expect(plus).toEqual(['components/community/space-chat/SpaceChatPlus.tsx']);
  });
});
