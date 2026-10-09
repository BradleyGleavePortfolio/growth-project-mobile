/**
 * DS-PRIMITIVES-133 (B13, B28, B39): these client screens and sheets take
 * their insets from react-native-safe-area-context (Android edge-to-edge
 * included), never SafeAreaView from 'react-native', and name a radius token
 * instead of a literal (owner 17:07).
 */
import fs from 'fs';
import path from 'path';

const FILES = [
  'screens/client/HomeScreen.tsx',
  'screens/client/MembershipScreen.tsx',
  'screens/client/MoreScreen.tsx',
  'screens/client/PlanScreen.tsx',
  'screens/client/Day1WinScreen.tsx',
  'screens/client/BloodworkEntryScreen.tsx',
  'components/trust/TrustExplainerSheet.tsx',
  'components/BloodworkDisclaimerModal.tsx',
];
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const rnImport = (src: string) => src.match(/import\s*\{([^}]*)\}\s*from\s*'react-native';/)?.[1] ?? '';

describe.each(FILES)('%s', (file) => {
  const src = read(file);
  it('imports SafeAreaView from react-native-safe-area-context only', () => {
    expect(rnImport(src)).not.toMatch(/\bSafeAreaView\b/);
    if (/<SafeAreaView\b/.test(src)) {
      expect(src).toMatch(/import \{ SafeAreaView \} from 'react-native-safe-area-context';/);
    }
  });
  it('has no literal borderRadius', () => {
    expect(src).not.toMatch(/borderRadius:\s*\d/);
  });
});

it('Plan sits under the stack header: no Android top-padding guess', () => {
  expect(read('screens/client/PlanScreen.tsx')).not.toMatch(/Platform\.OS === 'android' \? 50/);
});
