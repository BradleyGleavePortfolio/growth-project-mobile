/**
 * CONSENT-M (owner #162-6 "EVERYTHING should be covered in the initial acceptance of roman", WEAR-AI-05,
 * backend #1117 @ a29fa4f0): P0 asks GET ?variant=health_notes and, when the server answers with them, shows
 * the Health-notes box 2 copies (client-ai-v12 / v13: this build's paragraph; v10 / v11: the server's memory
 * paragraph) and records the P0 screen with them (consult-consent-v17 / v18, v15 / v16, v16 / v17-coach-free).
 * The four paragraphs below are copied byte for byte from #1117 and every sha is pinned. A server before #1117
 * (it answers health_notes with the client-ai-v4 copies) and a client with no coach and memory off keep today's
 * words and today's recorded versions (P0 then asks crisis_alert, as before).
 */
import React from 'react';
import { createHash } from 'crypto';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import { aiConsentApi, type AiConsentAsk, type AiConsentUpgradeCopy } from '../../../api/aiConsentApi';
import http from '../../../services/api';
import { NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { aiStatus, makeApi, resetStores } from '../../../lib/consultation/__fixtures__/flowHarness';
import { isLiveRomanGrant, romanFamily, romanFamilyOf, romanGrantBody } from '../../../lib/consultation/aiConsent';
import { isConsentAnswerCurrent } from '../../../lib/consultation/engine';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_CRISIS_COPY_SHA256,
  AI_CONSENT_HEALTH_COPY_SHA256,
  AI_CONSENT_HEALTH_CRISIS_COPY_SHA256,
  AI_CONSENT_HEALTH_CRISIS_MEMORY_COPY_SHA256,
  AI_CONSENT_HEALTH_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
  AI_CONSENT_PARAGRAPH_CRISIS,
  AI_CONSENT_PARAGRAPH_HEALTH,
  AI_CONSENT_PARAGRAPH_HEALTH_CRISIS,
  CONSENT_COACH_FREE_COPY_SHA256,
  CONSENT_COACH_FREE_CRISIS_COPY_SHA256,
  CONSENT_COPY_SHA256,
  CONSENT_CRISIS_COPY_SHA256,
  CONSENT_TITLE,
  consentCopyText,
  consentScreenCopy,
  ROMAN_HEALTH_NOTES_SENTENCE,
} from '../../../lib/consultation/copy';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {},
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn(), captureError: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'u1' })),
  readUserCache: jest.fn(async () => null),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../../services/queryClient', () => ({
  retireAndDrainIdentityPersistences: jest.fn(async () => undefined),
  settleAndClearQueryCache: jest.fn(async () => undefined),
  purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined),
}));

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

// Byte for byte from backend #1117 (src/ai-consent/ai-consent.constants.ts @ a29fa4f0, the PR body's table).
const V10_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. If you allow AI help, Roman also writes short notes about your health and sleep data on your Health pages, and your coach can ask for an AI note about it. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you. Your conversations with Roman are kept until you delete them or delete your account.";
const V11_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. If you allow AI help, Roman also writes short notes about your health and sleep data on your Health pages, and your coach can ask for an AI note about it. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you. If Roman sends you a crisis safety reply, your coach is told that it happened, but not what you wrote, so they can check in with you. Your conversations with Roman are kept until you delete them or delete your account.";
const V12_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. If you allow AI help, Roman also writes short notes about your health and sleep data on your Health pages, and your coach can ask for an AI note about it. Only your own data is used, never another client's, and never your coach's private notes. Your conversations with Roman are private from your coach and are kept until you delete them or delete your account. One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.";
const V13_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. If you allow AI help, Roman also writes short notes about your health and sleep data on your Health pages, and your coach can ask for an AI note about it. Only your own data is used, never another client's, and never your coach's private notes. Your conversations with Roman are private from your coach and are kept until you delete them or delete your account. One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you. If Roman sends you a crisis safety reply, your coach is told that it happened, but not what you wrote, so they can check in with you.";

// #1117's pins: box 2 copy sha256 (paragraph + "\n\n" + box label) and the P0 screen text sha256.
const PIN = {
  v10: '61ea52ec78fed32eae4df3ac74e696677cd78fcba0ab96266bbffae1f4e0be04',
  v11: 'fe3d8e294d1fc0d4868fb20969fdb9528c4f19a13a94a0339da87efc384b7b28',
  v12: '8f29d9a5185e3fbe01c1e4b3de445d1057b5cbe1c44e10568c81a805e8b9aac0',
  v13: '495b3c623df2b09c74c7163388a8e56abfc90469896537d7a785bd4fc4fd434d',
  p15: '2472c790626ed1ca2d6d7aaa87a39cf3dc0b51371bf94d6ad1679106f34cf0c3',
  p16: '6c03faf6263e93a90f67eb56e748611a29c6cab7fc2af044f3922f61aff16d0c',
  p16cf: '839832214a19353323a18f8e64443bba6db7172f3982c413a65281a72a441c54',
  p17cf: '4030570aae763dd4b4ca578b0472298070e8ce0eea60cc18a123d952fc767ba1',
  p17: 'ea511e82574f9ec446105028cf3547b66a5916523bd2329f60e4d9f5ce996b99',
  p18: '9ce19233f793ba3d4f82a5240481b4810da0a2f5dadf5b9c7a98936a14794e72',
};
const part = (text: string) => ({ text, sha256: sha(text) });
const copyOf = (version: string, paragraph: string): AiConsentUpgradeCopy => ({
  version,
  paragraph: part(paragraph),
  box_label: part(AI_CONSENT_CHECKBOX_LABEL),
  sha256: sha(`${paragraph}\n\n${AI_CONSENT_CHECKBOX_LABEL}`),
});

describe('the words: byte for byte from #1117, every sha pinned', () => {
  it('box 2: client-ai-v12 / v13 are this build\'s paragraph with the one sentence; v10 / v11 hash to the pins', () => {
    expect(AI_CONSENT_PARAGRAPH_HEALTH).toBe(V12_PARAGRAPH);
    expect(AI_CONSENT_PARAGRAPH_HEALTH_CRISIS).toBe(V13_PARAGRAPH);
    expect(V12_PARAGRAPH.replace(` ${ROMAN_HEALTH_NOTES_SENTENCE}`, '')).toBe(AI_CONSENT_PARAGRAPH);
    expect(V13_PARAGRAPH.replace(` ${ROMAN_HEALTH_NOTES_SENTENCE}`, '')).toBe(AI_CONSENT_PARAGRAPH_CRISIS);
    const rows: Array<[string, string, string]> = [
      [V10_PARAGRAPH, PIN.v10, AI_CONSENT_HEALTH_MEMORY_COPY_SHA256],
      [V11_PARAGRAPH, PIN.v11, AI_CONSENT_HEALTH_CRISIS_MEMORY_COPY_SHA256],
      [V12_PARAGRAPH, PIN.v12, AI_CONSENT_HEALTH_COPY_SHA256],
      [V13_PARAGRAPH, PIN.v13, AI_CONSENT_HEALTH_CRISIS_COPY_SHA256],
    ];
    for (const [text, pin, app] of rows) {
      expect(text).toContain(ROMAN_HEALTH_NOTES_SENTENCE);
      expect(sha(`${text}\n\n${AI_CONSENT_CHECKBOX_LABEL}`)).toBe(pin);
      expect(app).toBe(pin);
    }
  });

  it('P0: each Health-notes screen rebuilds to its #1117 pin', () => {
    // [no coach, crisis, memory paragraph (null: this build's), P0 version, pin]
    const rows: Array<[boolean, boolean, string | null, string, string]> = [
      [false, false, null, 'consult-consent-v17', PIN.p17],
      [false, true, null, 'consult-consent-v18', PIN.p18],
      [false, false, V10_PARAGRAPH, 'consult-consent-v15', PIN.p15],
      [false, true, V11_PARAGRAPH, 'consult-consent-v16', PIN.p16],
      [true, false, V10_PARAGRAPH, 'consult-consent-v16-coach-free', PIN.p16cf],
      [true, true, V11_PARAGRAPH, 'consult-consent-v17-coach-free', PIN.p17cf],
    ];
    for (const [noCoach, crisis, memory, version, pin] of rows) {
      const c = consentScreenCopy(noCoach, crisis, true);
      expect(memory ? [c.memoryVersion, c.memorySha256] : [c.version, c.sha256]).toEqual([version, pin]);
      expect(sha(consentCopyText(memory ?? c.aiParagraph, noCoach))).toBe(pin);
      expect(isConsentAnswerCurrent({ agreed: true, copy_version: version, agreed_at: NOW.toISOString(), text_sha256: pin } as never)).toBe(true);
    }
    // No coach, memory off: no Health-notes twin, so the screen stays today's.
    expect(consentScreenCopy(true, true, true)).toMatchObject({ version: 'consult-consent-v14-coach-free', aiParagraph: AI_CONSENT_PARAGRAPH_CRISIS });
  });

  it('readers: a live client-ai-v10 to v13 grant is read with its own family, version and pin', () => {
    const rows: Array<[string, boolean, string]> = [
      ['client-ai-v12', false, PIN.v12],
      ['client-ai-v13', true, PIN.v13],
    ];
    for (const [version, crisis, pin] of rows) {
      const family = romanFamily(false, crisis, true);
      const live = aiStatus({ granted: true, state: 'granted', version, current_version: version });
      expect(romanFamilyOf(live)).toBe(family);
      expect(isLiveRomanGrant(live)).toBe(true);
      expect(isLiveRomanGrant(live, family)).toBe(true);
      expect(romanGrantBody(null, family)).toEqual({ version, copy_sha256: pin, platform: 'ios' });
    }
    const v11 = copyOf('client-ai-v11', V11_PARAGRAPH);
    const liveMemory = aiStatus({ granted: true, state: 'granted', version: 'client-ai-v11', current_version: 'client-ai-v13', copy: v11 });
    expect(romanFamilyOf(liveMemory)).toBe(romanFamily(false, true, true));
    expect(romanGrantBody(v11, romanFamily(false, true, true))).toEqual({ version: 'client-ai-v11', copy_sha256: PIN.v11, platform: 'ios' });
  });

  it('the API sends ?variant=health_notes on GET, POST and DELETE', async () => {
    const m = http as unknown as Record<'get' | 'post' | 'delete', jest.Mock>;
    for (const k of ['get', 'post', 'delete'] as const) m[k] = jest.fn(async () => ({ data: aiStatus() }));
    await aiConsentApi.getStatus({ healthNotes: true });
    await aiConsentApi.grantRoman({ version: 'client-ai-v12', copy_sha256: PIN.v12, platform: 'ios' }, { healthNotes: true });
    await aiConsentApi.withdrawRoman({ healthNotes: true });
    const params = { params: { variant: 'health_notes' } };
    expect([m.get.mock.calls[0][1], m.post.mock.calls[0][2], m.delete.mock.calls[0][1]]).toEqual([params, params, params]);
  });
});

// A server: #1117 answers health_notes with v12 / v13 (memory: v10 / v11), crisis_alert with v8 / v9; one before
// #1117 answers health_notes with the client-ai-v4 copies (its plain GET). `crisis`: roman_crisis_alert is on.
function server(opts: { b1117: boolean; crisis: boolean; memory: boolean }) {
  return jest.fn(async (ask?: AiConsentAsk) => {
    const c = opts.crisis;
    if (ask?.healthNotes && !opts.b1117) return { kind: 'ok' as const, status: aiStatus({ current_version: 'client-ai-v4' }) };
    const health = !!ask?.healthNotes;
    const memory_copy = !opts.memory ? undefined : health ? copyOf(c ? 'client-ai-v11' : 'client-ai-v10', c ? V11_PARAGRAPH : V10_PARAGRAPH) : undefined;
    const current_version = health ? (c ? 'client-ai-v13' : 'client-ai-v12') : c && ask?.crisis ? 'client-ai-v8' : 'client-ai-v6';
    return { kind: 'ok' as const, status: aiStatus({ current_version, memory_on: opts.memory, memory_copy }) };
  });
}

function renderFlow(api: ConsultationApi, coachless: boolean) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName={coachless ? null : 'Bradley'}
      coachless={coachless}
      api={api}
      onFinished={jest.fn()}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
    />,
  );
}

async function toP0(api: ConsultationApi, coachless: boolean) {
  const r = await renderFlow(api, coachless);
  await waitFor(() => r.getByTestId('consult-screen-W1'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  return r;
}

const strings = (n: unknown): string[] =>
  typeof n === 'string' ? [n] : Array.isArray(n) ? n.flatMap(strings) : n && typeof n === 'object' ? strings((n as { children?: unknown }).children ?? null) : [];

beforeEach(async () => {
  await resetStores();
});

const HEALTH = { healthNotes: true };
const CRISIS = { crisis: true };
// [case, #1117 deployed, no coach, crisis on, memory on, paragraph shown, P0 version, P0 pin, box 2 grant, asks]
type Row = [string, boolean, boolean, boolean, boolean, string, string, string, { version: string; copy_sha256: string }, AiConsentAsk[]];
const ROWS: Row[] = [
  ['coached, memory off', true, false, true, false, V13_PARAGRAPH, 'consult-consent-v18', PIN.p18, { version: 'client-ai-v13', copy_sha256: PIN.v13 }, [HEALTH]],
  ['coached, memory off, no crisis', true, false, false, false, V12_PARAGRAPH, 'consult-consent-v17', PIN.p17, { version: 'client-ai-v12', copy_sha256: PIN.v12 }, [HEALTH]],
  ['coached, memory on', true, false, true, true, V11_PARAGRAPH, 'consult-consent-v16', PIN.p16, { version: 'client-ai-v11', copy_sha256: PIN.v11 }, [HEALTH]],
  ['coached, memory on, no crisis', true, false, false, true, V10_PARAGRAPH, 'consult-consent-v15', PIN.p15, { version: 'client-ai-v10', copy_sha256: PIN.v10 }, [HEALTH]],
  ['no coach, memory on', true, true, true, true, V11_PARAGRAPH, 'consult-consent-v17-coach-free', PIN.p17cf, { version: 'client-ai-v11', copy_sha256: PIN.v11 }, [HEALTH]],
  ['no coach, memory on, no crisis', true, true, false, true, V10_PARAGRAPH, 'consult-consent-v16-coach-free', PIN.p16cf, { version: 'client-ai-v10', copy_sha256: PIN.v10 }, [HEALTH]],
  ['no coach, memory off: today\'s screen', true, true, true, false, AI_CONSENT_PARAGRAPH_CRISIS, 'consult-consent-v14-coach-free', CONSENT_COACH_FREE_CRISIS_COPY_SHA256, { version: 'client-ai-v8', copy_sha256: AI_CONSENT_CRISIS_COPY_SHA256 }, [HEALTH, CRISIS]],
  ['no coach, memory off, no crisis: today\'s screen', true, true, false, false, AI_CONSENT_PARAGRAPH, 'consult-consent-v12-coach-free', CONSENT_COACH_FREE_COPY_SHA256, { version: 'client-ai-v6', copy_sha256: AI_CONSENT_COPY_SHA256 }, [HEALTH, CRISIS]],
  ['a server before #1117: today\'s words', false, false, true, false, AI_CONSENT_PARAGRAPH_CRISIS, 'consult-consent-v13', CONSENT_CRISIS_COPY_SHA256, { version: 'client-ai-v8', copy_sha256: AI_CONSENT_CRISIS_COPY_SHA256 }, [HEALTH, CRISIS]],
  ['a server before #1117, no crisis: today\'s words', false, false, false, false, AI_CONSENT_PARAGRAPH, 'consult-consent-v11', CONSENT_COPY_SHA256, { version: 'client-ai-v6', copy_sha256: AI_CONSENT_COPY_SHA256 }, [HEALTH, CRISIS]],
];

describe('P0 shows, records and grants only what the server served (CONSENT-M)', () => {
  it.each(ROWS)('%s', async (_case, b1117, noCoach, crisis, memory, paragraph, version, pin, grant, asks) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const api = makeApi({ getRomanConsent: server({ b1117, crisis, memory }) });
    const r = await toP0(api, noCoach);
    await waitFor(() => expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState?.disabled).toBeFalsy());
    expect(r.getByTestId('consent-ai-paragraph').props.children).toBe(paragraph);
    expect(api.getRomanConsent.mock.calls.map((c) => c[0])).toEqual(asks);
    const out = strings(r.toJSON()); // every string from the P0 title to the Privacy Policy link, in display order
    const shown = out.slice(out.lastIndexOf(CONSENT_TITLE, out.indexOf('Privacy Policy')), out.indexOf('Privacy Policy')).join('\n\n');
    expect(sha(shown)).toBe(pin);
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(api.save.mock.calls[0][0].answers.P0).toMatchObject({ agreed: true, copy_version: version, text_sha256: pin });
    const ask = asks[asks.length - 1];
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledWith(expect.objectContaining(grant), ask));
    // Unticking later withdraws with the same ask, so the answer names the copies the screen showed.
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => expect(api.withdrawRomanConsent).toHaveBeenCalledWith(ask));
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
