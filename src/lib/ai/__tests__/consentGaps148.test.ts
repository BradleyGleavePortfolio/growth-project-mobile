/**
 * FIXCONSENT (agent 148): one table walks both rule lists of the consent release.
 * K1: a client with no coach is never told anything about a coach (coach access, a
 * coach's agreement, a coach's AI tools, or Roman being on) on a consent or privacy screen.
 * K2 (owner 57c): every coached promise that the coach does not see Roman chats carries
 * the approved safety-reply exception, wherever it is shown or granted.
 */
import fs from 'fs';
import path from 'path';
import { clearUserCache, setUserCache } from '../../userCache';
import { clientPrivacyText, withSafetyException, withoutCoachSentences } from '../aiCoachless';
import {
  AI_CONSENT_PARAGRAPH,
  AI_CONSENT_PARAGRAPH_PRE57C,
  AI_CONSENT_SAFETY_EXCEPTION,
  consentScreenCopy,
} from '../../consultation/copy';
import { romanFamily, romanFamilyOf, romanGrantBody } from '../../consultation/aiConsent';
import { aiConsentApi, type AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { ROMAN_CHATS_COPY } from '../../../screens/settings/romanChatsCopy';
import { trustRomanLine } from '../../../screens/trustCenterSharing';

const mockGet = jest.fn(async () => ({ status: 200, data: null }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => (mockGet as jest.Mock)(...a) } }));

const SRC = path.join(__dirname, '..', '..', '..');
const source = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const COACH = /\bcoach\b/i;

// Backend src/ai-consent/ai-consent.constants.ts CLIENT_AI_CONSENT_V5_PARAGRAPH (client-ai-v5), verbatim.
const V5 =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
// The same backend file's client-ai-v7 paragraph: v5 with the exception right after the coach sentence.
const V7 = V5.replace(
  'his notes about you. ',
  `his notes about you. ${AI_CONSENT_SAFETY_EXCEPTION} `,
);
// Main #703: the chats intro and the Trust & Privacy Roman line with the exception.
const INTRO_COACHED =
  'Your conversations with Roman are kept until you delete them or your account. Your coach never sees them. ' +
  `${AI_CONSENT_SAFETY_EXCEPTION} Deleting a conversation removes it for good.`;
const TRUST_ROMAN_COACHED = `Not your coach — your Roman conversations, which are kept until you delete them or your account. ${AI_CONSENT_SAFETY_EXCEPTION}`;
const COMMUNITY =
  'Members of your community spaces — the content you choose to share there. If you opt in to a leaderboard, other clients of your coach can also see your display name and participation score.';
const SETTINGS_HINT = "Allow or withdraw Roman and your coach's AI tools using your information";

const status = (current_version: string): AiConsentStatusResponse =>
  ({ granted: true, state: 'granted', version: current_version, current_version }) as AiConsentStatusResponse;

/** The coachless return block of Settings > Privacy > Roman and AI (owner 62x, #684). */
function coachlessBlock(): string {
  const src = source('screens/settings/RomanAiConsentScreen.tsx');
  const start = src.indexOf('  if (coachless) {');
  return src.slice(start, src.indexOf('\n  }\n', start));
}

type Row = { rule: 'K1' | 'K2'; row: string; where: 'stack' | '148'; check: () => void | Promise<void> };

const ROWS: Row[] = [
  // ── K1 ──
  {
    rule: 'K1',
    row: 'RomanAiConsentScreen allowedBody, notAllowedBody, allowedMemoryBody, confirmWithdrawBody, accountLine, state line',
    where: 'stack',
    check: () => {
      const block = coachlessBlock();
      expect(block).toContain('ROMAN_AI_COPY.noAccess');
      for (const key of ['allowedBody', 'notAllowedBody', 'allowedMemoryBody', 'confirmWithdrawBody', 'accountLine', 'stateOn', 'stateOff', 'renderStateRow', 'renderState()']) {
        expect(block).not.toContain(key);
      }
    },
  },
  {
    rule: 'K1',
    row: 'romanChatsCopy intro (main #703 text) via RomanConversationsScreen',
    where: '148',
    check: () => {
      expect(clientPrivacyText(ROMAN_CHATS_COPY.intro, true)).toBe(
        'Your conversations with Roman are kept until you delete them or your account. Deleting a conversation removes it for good.',
      );
      expect(source('screens/settings/RomanConversationsScreen.tsx')).toContain('{clientPrivacyText(crisisText(ROMAN_CHATS_COPY.intro))}');
    },
  },
  {
    rule: 'K1',
    row: 'romanChatsCopy confirmAllBody via RomanConversationsScreen',
    where: '148',
    check: () => {
      expect(clientPrivacyText(ROMAN_CHATS_COPY.confirmAllBody, true)).toBe(
        'This permanently deletes every conversation you have had with Roman, from every day. It cannot be undone.',
      );
      expect(source('screens/settings/RomanConversationsScreen.tsx')).toContain('body={clientPrivacyText(ROMAN_CHATS_COPY.confirmAllBody)}');
    },
  },
  {
    rule: 'K1',
    row: 'Settings > Roman and AI row hint (coach\u2019s AI tools)',
    where: '148',
    check: () => {
      expect(clientPrivacyText(SETTINGS_HINT, true)).toBe('');
      expect(clientPrivacyText(SETTINGS_HINT, false)).toBe(SETTINGS_HINT);
      expect(source('screens/client/SettingsScreen.tsx')).toContain(`accessibilityHint={clientPrivacyText("${SETTINGS_HINT}") || undefined}`);
    },
  },
  {
    rule: 'K1',
    row: 'Trust & Privacy community bullet (other clients of your coach)',
    where: '148',
    check: () => {
      expect(clientPrivacyText(COMMUNITY, true)).toBe('Members of your community spaces — the content you choose to share there.');
      expect(clientPrivacyText(COMMUNITY, false)).toBe(COMMUNITY);
      const screen = source('screens/TrustCenterScreen.tsx');
      expect(screen).toContain(`<BulletItem text="${COMMUNITY}" />`);
      expect(screen).toContain('const shown = clientPrivacyText(text);');
    },
  },
  {
    rule: 'K1',
    row: 'Trust & Privacy Roman line, no coach',
    where: 'stack',
    check: () => {
      const line = trustRomanLine({ kind: 'no_coach' });
      expect(line).not.toMatch(COACH);
      expect(clientPrivacyText(line, true)).toBe(line);
    },
  },
  {
    rule: 'K1',
    row: 'every sentence that names a coach goes, and no word is added',
    where: '148',
    check: () => {
      for (const text of [AI_CONSENT_PARAGRAPH, V7, INTRO_COACHED, COMMUNITY, ROMAN_CHATS_COPY.confirmAllBody]) {
        const out = withoutCoachSentences(text);
        expect(out).not.toMatch(COACH);
        for (const word of out.split(/\s+/)) expect(text.split(/\s+/)).toContain(word);
      }
    },
  },
  // ── K2 ──
  {
    rule: 'K2',
    row: 'copy.ts paragraph 4 (client-ai-v6), P0 box 2 via QuestionScreen',
    where: 'stack',
    check: () => {
      expect(AI_CONSENT_PARAGRAPH).toBe(`${AI_CONSENT_PARAGRAPH_PRE57C} ${AI_CONSENT_SAFETY_EXCEPTION}`);
      expect(consentScreenCopy(false).aiParagraph).toBe(AI_CONSENT_PARAGRAPH);
      expect(consentScreenCopy(true).aiParagraph).toBe(AI_CONSENT_PARAGRAPH);
    },
  },
  {
    rule: 'K2',
    row: 'ConsultationFlow plain GET (and the AI consent sheet) ask for the 57c copies',
    where: 'stack',
    check: async () => {
      await aiConsentApi.getStatus();
      expect(mockGet).toHaveBeenLastCalledWith('/me/ai-consent', { params: { variant: 'safety_exception' } });
      expect(source('screens/consultation/ConsultationFlow.tsx')).toContain('getRomanConsent: aiConsentApi.getStatus,');
    },
  },
  {
    rule: 'K2',
    row: 'aiConsent.ts families and grants: a new coached grant is client-ai-v6 / v7',
    where: 'stack',
    check: () => {
      expect(romanFamily(false).paragraph).toBe(AI_CONSENT_PARAGRAPH);
      expect(romanGrantBody(null, romanFamily(false)).version).toBe('client-ai-v6');
      expect(romanFamilyOf(status('client-ai-v4')).paragraph).toBe(AI_CONSENT_PARAGRAPH_PRE57C);
    },
  },
  {
    rule: 'K2',
    row: 'Settings > Roman and AI, a live client-ai-v4 grant (paragraph)',
    where: '148',
    check: () => {
      expect(withSafetyException(AI_CONSENT_PARAGRAPH_PRE57C)).toBe(AI_CONSENT_PARAGRAPH);
      expect(source('screens/settings/RomanAiConsentScreen.tsx')).toMatch(/testID="roman-ai-paragraph">\s*\{withSafetyException\(/);
    },
  },
  {
    rule: 'K2',
    row: 'Settings > Roman and AI, a live client-ai-v5 grant and the memory-on confirmation',
    where: '148',
    check: () => {
      expect(withSafetyException(V5)).toBe(V7);
      // FIXCONSENT: the memory-on confirmation is the asked family's text (it carries the exception), as sent.
      expect(source('screens/settings/RomanAiConsentScreen.tsx')).toContain(
        'Alert.alert(ROMAN_AI_COPY.confirmMemoryOnTitle, offer.paragraph.text, [',
      );
    },
  },
  {
    rule: 'K2',
    row: 'Roman conversations intro and Trust & Privacy Roman line (main #703)',
    where: 'stack',
    check: () => {
      expect(ROMAN_CHATS_COPY.intro).toBe(INTRO_COACHED);
      expect(clientPrivacyText(ROMAN_CHATS_COPY.intro, false)).toBe(INTRO_COACHED);
      expect(trustRomanLine({ kind: 'unread' })).toBe(TRUST_ROMAN_COACHED);
      expect(clientPrivacyText(trustRomanLine({ kind: 'unread' }), false)).toBe(TRUST_ROMAN_COACHED);
    },
  },
  {
    rule: 'K2',
    row: 'the guard adds the exception once, right after the promise, and leaves other text alone',
    where: '148',
    check: () => {
      for (const text of [AI_CONSENT_PARAGRAPH, V7, INTRO_COACHED, TRUST_ROMAN_COACHED]) expect(withSafetyException(text)).toBe(text);
      expect(withSafetyException('Not your coach — your Roman conversations')).toBe(`Not your coach — your Roman conversations. ${AI_CONSENT_SAFETY_EXCEPTION}`);
      expect(withSafetyException(ROMAN_CHATS_COPY.confirmAllBody)).toBe(ROMAN_CHATS_COPY.confirmAllBody);
      expect(withSafetyException(COMMUNITY)).toBe(COMMUNITY);
    },
  },
];

describe('consent release, both rule lists (FIXCONSENT)', () => {
  afterEach(async () => {
    await clearUserCache();
  });

  it.each(ROWS)('$rule ($where) $row', async (r) => {
    await r.check();
  });

  it('reads the signed-in client: no coach drops the coach lines, a coach keeps them with the exception', async () => {
    await setUserCache({ id: 'client-1', email: 'a@example.invalid' });
    expect(clientPrivacyText(ROMAN_CHATS_COPY.intro)).not.toMatch(COACH);
    await setUserCache({ id: 'client-1', email: 'a@example.invalid', coach_id: 'coach-1' });
    expect(clientPrivacyText(ROMAN_CHATS_COPY.intro)).toBe(INTRO_COACHED);
    await clearUserCache();
    expect(clientPrivacyText(AI_CONSENT_PARAGRAPH_PRE57C)).toBe(AI_CONSENT_PARAGRAPH);
  });
});
