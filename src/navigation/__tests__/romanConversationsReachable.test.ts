/**
 * "Your conversations with Roman" is reachable wherever Roman is, and never
 * depends on the Roman chat flag (backend #635 keeps list and delete outside
 * the chat switch, so a deletion right is never switched off):
 *   - client: Settings > Privacy > Roman and AI row, and the Roman chat header;
 *   - coach: Settings > Privacy row, and the Roman chat header;
 *   - both screens registered unconditionally in the stack that hosts RomanChat.
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const CLIENT_NAV = read('navigation/ClientNavigator.tsx');
const COACH_NAV = read('navigation/CoachNavigator.tsx');

/** The JSX line that registers `name`, and whether a feature-flag guard opens on the line above it. */
function registration(src: string, name: string) {
  const re = new RegExp(`<(MoreStackNav|SettingsStack)\\.Screen name="${name}" component=\\{\\w+\\} />`);
  const m = src.match(re);
  expect(m).not.toBeNull();
  const idx = src.indexOf(m![0]);
  const lineStart = src.lastIndexOf('\n', idx);
  const prevLine = src.slice(src.lastIndexOf('\n', lineStart - 1) + 1, lineStart);
  return { stack: m![1], guarded: /featureFlags\.\w+\s*&&\s*\($/.test(prevLine.trim()) };
}

describe.each([
  ['client', CLIENT_NAV, 'MoreStackNav'],
  ['coach', COACH_NAV, 'SettingsStack'],
])('%s navigator', (_role, src, stack) => {
  it.each(['RomanConversations', 'RomanConversation'])('registers %s unconditionally next to RomanChat', (name) => {
    const r = registration(src, name);
    expect(r.stack).toBe(stack);
    expect(r.guarded).toBe(false);
    expect(src).toMatch(new RegExp(`<${stack}\\.Screen name="RomanChat">`));
    expect(src).toMatch(new RegExp(`\\b${name}: (undefined|RomanConversationParams);`));
  });
});

it('Settings > Privacy > Roman and AI opens the list', () => {
  expect(read('screens/settings/RomanAiConsentScreen.tsx')).toMatch(
    /button\(ROMAN_CHATS_COPY\.entryLabel, \(\) => navigation\.navigate\('RomanConversations'\), 'roman-ai-conversations'/,
  );
});

it('the coach Settings Privacy section opens the list', () => {
  const s = read('screens/coach/SettingsScreen.tsx');
  const privacy = s.indexOf('<Text style={styles.sectionHeader}>Privacy</Text>');
  const row = s.indexOf("navigation.navigate('RomanConversations')");
  const next = s.indexOf('<Text style={styles.sectionHeader}>', privacy + 1);
  expect(privacy).toBeGreaterThan(-1);
  expect(row).toBeGreaterThan(privacy);
  expect(row).toBeLessThan(next);
});

it('the Roman chat header carries the entry', () => {
  const chat = read('screens/roman/RomanChatScreen.tsx');
  const header = chat.slice(chat.indexOf('const header = ('), chat.indexOf('if (phase ==='));
  expect(header).toMatch(/<RomanConversationsButton \/>/);
  expect(read('components/roman/RomanConversationsButton.tsx')).toMatch(/navigation\.navigate\('RomanConversations'\)/);
});

it('C-331-3: the coach Settings row is hidden for a sub-coach (backend Roman routes allow student, coach and owner)', () => {
  const s = read('screens/coach/SettingsScreen.tsx');
  const row = s.indexOf("navigation.navigate('RomanConversations')");
  const gateStart = s.lastIndexOf('{(featureFlags.consultationOnboarding || featureFlags.romanChat)', row);
  expect(gateStart).toBeGreaterThan(-1);
  const gate = s.slice(gateStart, s.indexOf('? (', gateStart));
  expect(gate).toMatch(/currentUser\?\.role !== 'sub_coach'/);
  // Head coaches and coaches whose team role is still loading keep the row.
  expect(gate).not.toMatch(/head_coach|unknown/);
});
