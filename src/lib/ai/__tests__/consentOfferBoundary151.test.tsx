/**
 * B-A (FIXCONSENT2; Sol B1 on m#684, B2 on m#723, b#1047): one consent-offer boundary. A live grant is read
 * with the copies on file; every new choice (Allow, memory on, memory off, the AI sheet) is made in the copies
 * asked for. For every positive write this table captures the text PRESENTED BEFORE it is sent (the paragraph
 * above Allow, the memory-on or memory-off confirmation, the sheet's paragraph and label) and asserts it is the
 * recorded version's text and that the recorded digest is that text's pin. The HTTP answers are production
 * shaped: the real API client against backend main's toStatus for a client with a coach (GET, POST and DELETE,
 * each with the ?variant= it was sent). Withdrawal (and the onboarding drain, also a DELETE) records no text,
 * so it is a step here but never a row of the check.
 */
import React from 'react';
import { createHash } from 'crypto';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GrantRomanConsentRequest } from '../../../api/aiConsentApi';
import RomanAiConsentScreen, { ROMAN_AI_COPY } from '../../../screens/settings/RomanAiConsentScreen';
import AiConsentSheet from '../../../components/ai/AiConsentSheet';
import { resetAiLedgerWritesForTests } from '../../consultation/aiConsent';
import * as copy from '../../consultation/copy';

const mockHttp = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockHttp.get(...a),
    post: (...a: unknown[]) => mockHttp.post(...a),
    delete: (...a: unknown[]) => mockHttp.delete(...a),
  },
}));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#123456' }),
    semanticColors: new Proxy({}, { get: () => '#123456' }),
  }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
// A signed-in client with a coach.
jest.mock('../../userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'u1', coach_id: 'coach-1' })),
  readUserCache: jest.fn(async () => null),
}));

// growth-project-backend main, src/ai-consent/ai-consent.constants.ts, verbatim.
const B_V4 =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Only your own data is used, never another client's, and never your coach's private notes. Your conversations with Roman are private from your coach and are kept until you delete them or delete your account.";
const B_V5 =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
const B_EXCEPTION =
  'One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.';
const B_LABEL = "Optional: I allow Roman and my coach's AI tools to use my information, processed by Anthropic.";
const V5_TAIL = 'Your conversations with Roman are kept until you delete them or delete your account.';
/** Each client-ai version's paragraph: owner 57c puts the exception after the first coach promise. */
const TEXT: Record<string, string> = {
  'client-ai-v4': B_V4,
  'client-ai-v5': B_V5,
  'client-ai-v6': `${B_V4} ${B_EXCEPTION}`,
  'client-ai-v7': `${B_V5.slice(0, -V5_TAIL.length)}${B_EXCEPTION} ${V5_TAIL}`,
};
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
/** The copy sha256 the ledger accepts and records: paragraph and box 2 label. */
const pinOf = (version: string) => sha(`${TEXT[version]}\n\n${B_LABEL}`);
const FAMILIES = { pre57c: ['client-ai-v4', 'client-ai-v5'], coached: ['client-ai-v6', 'client-ai-v7'] } as const;
type Family = keyof typeof FAMILIES;
const familyOf = (v: string | undefined): Family => (v === 'client-ai-v6' || v === 'client-ai-v7' ? 'coached' : 'pre57c');
const isMemory = (v: string) => v === 'client-ai-v5' || v === 'client-ai-v7';
const copyOf = (v: string) => ({
  version: v,
  processor: 'anthropic',
  paragraph: { text: TEXT[v], sha256: sha(TEXT[v]) },
  box_label: { text: B_LABEL, sha256: sha(B_LABEL) },
  sha256: pinOf(v),
});
const AT = '2026-10-16T10:00:00.000Z';
type Held = { action: 'grant' | 'withdraw'; version: string } | null;

/**
 * Backend main toStatus / grant / withdraw (85b5164e ai-consent.service.ts ~l.451-495, 542-640) for a client with
 * a coach: a live grant, or a call without ?variant=, reads the copies on file; otherwise the copies asked for
 * (coached here), and the memory offer follows the ask. A grant is written only for an accepted version whose
 * sha256 is its pin; a grant of the live version, or a withdraw with nothing live, writes nothing.
 */
function server(held: Held, memoryOn = true) {
  let row = held;
  const status = (variant: string | null) => {
    const onFile = familyOf(row?.version);
    const scope = row?.action === 'grant' && TEXT[row.version] ? (isMemory(row.version) ? 'memory' : 'base') : null;
    const granted = scope !== null;
    const family: Family = granted || !variant ? onFile : 'coached';
    const offer: Family = variant ? 'coached' : family;
    const current = FAMILIES[family][scope === 'memory' ? 1 : 0];
    return {
      purpose: 'client_ai_processing',
      processor: 'anthropic',
      granted,
      state: granted ? 'granted' : row?.action === 'grant' ? 'needs_reconsent' : row ? 'withdrawn' : 'not_granted',
      version: row?.version ?? null,
      granted_at: row?.action === 'grant' ? AT : null,
      withdrawn_at: row?.action === 'withdraw' ? AT : null,
      current_version: current,
      needs_reconsent: row?.action === 'grant' && !granted,
      copy: copyOf(current),
      scope,
      upgrade: scope === 'base' && memoryOn ? copyOf(FAMILIES[offer][1]) : null,
      memory_on: memoryOn,
      memory_copy: memoryOn && scope !== 'memory' ? copyOf(FAMILIES[offer][1]) : null,
    };
  };
  const refusal = (code: string) => Object.assign(new Error('HTTP 409'), { response: { status: 409, data: { code } } });
  const variantOf = (config: unknown) => (config as { params?: { variant?: string } } | undefined)?.params?.variant ?? null;
  mockHttp.get.mockReset().mockImplementation(async (url: string, config?: unknown) => ({
    status: 200,
    data: url === '/me/ai-consent' ? status(variantOf(config)) : null,
  }));
  mockHttp.post.mockReset().mockImplementation(async (_url: string, body: GrantRomanConsentRequest, config?: unknown) => {
    if (!TEXT[body.version] || (body.copy_sha256 !== undefined && body.copy_sha256 !== pinOf(body.version))) {
      throw refusal('CONSENT_VERSION_MISMATCH');
    }
    if (!(row?.action === 'grant' && row.version === body.version)) row = { action: 'grant', version: body.version };
    return { status: 200, data: status(variantOf(config)) };
  });
  mockHttp.delete.mockReset().mockImplementation(async (_url: string, config?: unknown) => {
    if (row?.action === 'grant') row = { action: 'withdraw', version: row.version };
    return { status: 200, data: status(variantOf(config)) };
  });
  return { recorded: () => row };
}

/** Presses the last alert's action (the one that is not Cancel) and returns its message. */
function confirmLast(): string {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [, message, buttons] = calls[calls.length - 1] as [string, string, AlertButton[]];
  buttons[buttons.length - 1].onPress?.();
  return message;
}
const text = (r: { getByTestId: (id: string) => { props: { children?: unknown } } }, id: string) =>
  r.getByTestId(id).props.children as string;

/** A positive write: its body, and the text presented before it was sent. */
type Write = { body: GrantRomanConsentRequest; presented: { paragraph: string; label: string } };
function expectRecordedAsPresented(writes: Write[], srv: ReturnType<typeof server>) {
  expect(mockHttp.post).toHaveBeenCalledTimes(writes.length);
  writes.forEach(({ body, presented }, i) => {
    const [url, sent, config] = mockHttp.post.mock.calls[i];
    expect([url, sent.version, sent.copy_sha256]).toEqual(['/me/ai-consent/roman', body.version, body.copy_sha256]);
    // Each POST sends the GET's ask, so its answer is read like the GET's.
    expect(config).toEqual({ params: { variant: 'safety_exception' } });
    expect(presented).toEqual({ paragraph: TEXT[body.version], label: B_LABEL });
    expect(body.copy_sha256).toBe(sha(`${presented.paragraph}\n\n${presented.label}`));
  });
  if (writes.length) expect(srv.recorded()).toEqual({ action: 'grant', version: writes[writes.length - 1].body.version });
}

beforeEach(async () => {
  resetAiLedgerWritesForTests();
  await AsyncStorage.clear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => (Alert.alert as jest.Mock).mockRestore());

it('the pins are rebuilt from backend main text: client-ai-v4 / v5 / v6 / v7 are the app constants', () => {
  expect(Object.keys(TEXT).map(pinOf)).toEqual([
    copy.AI_CONSENT_PRE57C_COPY_SHA256,
    copy.AI_CONSENT_PRE57C_MEMORY_COPY_SHA256,
    copy.AI_CONSENT_COPY_SHA256,
    copy.AI_CONSENT_MEMORY_COPY_SHA256,
  ]);
  expect([TEXT['client-ai-v4'], TEXT['client-ai-v6'], B_LABEL]).toEqual([
    copy.AI_CONSENT_PARAGRAPH_PRE57C,
    copy.AI_CONSENT_PARAGRAPH,
    copy.AI_CONSENT_CHECKBOX_LABEL,
  ]);
});

type Step = 'allow' | 'memory on' | 'memory off' | 'withdraw';
const grant = (version: string): Held => ({ action: 'grant', version });
// Settings > Privacy > Roman and AI: [row, on file, memory on (server), steps on one screen, versions recorded].
const SETTINGS: Array<[string, Held, boolean, Step[], string[]]> = [
  ['live v4 + memory on', grant('client-ai-v4'), true, ['memory on'], ['client-ai-v7']],
  ['live v5, memory off then on', grant('client-ai-v5'), true, ['memory off', 'memory on'], ['client-ai-v6', 'client-ai-v7']],
  ['live v6, memory on then off', grant('client-ai-v6'), true, ['memory on', 'memory off'], ['client-ai-v7', 'client-ai-v6']],
  ['live v7, memory off then on', grant('client-ai-v7'), true, ['memory off', 'memory on'], ['client-ai-v6', 'client-ai-v7']],
  ['on file v4: withdraw, then Allow', grant('client-ai-v4'), true, ['withdraw', 'allow'], ['client-ai-v7']],
  ['on file v5: withdraw, Allow, memory off', grant('client-ai-v5'), true, ['withdraw', 'allow', 'memory off'], ['client-ai-v7', 'client-ai-v6']],
  ['withdrawn v5, memory off (server): Allow', { action: 'withdraw', version: 'client-ai-v5' }, false, ['allow'], ['client-ai-v6']],
  ['a grant no longer accepted (reconsent): Allow', grant('client-ai-v3'), true, ['allow'], ['client-ai-v7']],
  ['nothing on file: Allow, memory off, memory on', null, true, ['allow', 'memory off', 'memory on'], ['client-ai-v7', 'client-ai-v6', 'client-ai-v7']],
  ['nothing on file, memory off (server): Allow', null, false, ['allow'], ['client-ai-v6']],
];

describe('B-A: Settings records every new choice against the text presented before it is sent', () => {
  it.each(SETTINGS)('%s', async (_row, held, memoryOn, steps, recorded) => {
    const srv = server(held, memoryOn);
    const nav = { goBack: jest.fn(), navigate: jest.fn() } as never;
    const r = await render(<RomanAiConsentScreen navigation={nav} sessionUserId={() => 'u1'} />);
    await waitFor(() => r.getByTestId(/^roman-ai-(allowed|not_allowed|reconsent)$/));
    expect(mockHttp.get).toHaveBeenCalledWith('/me/ai-consent', { params: { variant: 'safety_exception' } });
    const writes: Write[] = [];
    const off = `${ROMAN_AI_COPY.confirmMemoryOffBody}\n\n`;
    for (const step of steps) {
      // The screen as it stands after the last answer: the control for this step is there.
      if (step === 'allow' || step === 'withdraw') await waitFor(() => r.getByTestId(`roman-ai-${step}`));
      else await waitFor(() => expect(r.getByTestId('roman-ai-memory-switch').props.value).toBe(step === 'memory off'));
      const sent = mockHttp.post.mock.calls.length;
      const above = text(r, 'roman-ai-paragraph');
      if (step === 'allow') await fireEvent.press(r.getByTestId('roman-ai-allow'));
      else if (step === 'withdraw') await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
      else await fireEvent(r.getByTestId('roman-ai-memory-switch'), 'valueChange', step === 'memory on');
      const message = confirmLast();
      if (step === 'withdraw') {
        await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
        expect(mockHttp.delete).toHaveBeenLastCalledWith('/me/ai-consent/roman', { params: { variant: 'safety_exception' } });
        continue;
      }
      await waitFor(() => expect(mockHttp.post).toHaveBeenCalledTimes(sent + 1));
      // Captured before the write: Allow's paragraph and box 2 label, or the memory confirmation's agreement text.
      if (step === 'memory off') expect(message.startsWith(off)).toBe(true);
      const presented =
        step === 'allow'
          ? { paragraph: above, label: `Optional: ${message}` }
          : { paragraph: step === 'memory off' ? message.slice(off.length) : message, label: B_LABEL };
      const body: GrantRomanConsentRequest = mockHttp.post.mock.calls[sent][1];
      writes.push({ body, presented });
      // The answer (read like the GET's) is on screen at once: allowed, with the recorded text.
      await waitFor(() => expect(text(r, 'roman-ai-paragraph')).toBe(TEXT[body.version]));
      expect(r.getByTestId('roman-ai-allowed')).toBeTruthy();
    }
    expect(writes.map((w) => w.body.version)).toEqual(recorded);
    expectRecordedAsPresented(writes, srv);
  });
});

// The AI sheet: [row, on file, memory on (server), version recorded].
const SHEET: Array<[string, Held, boolean, string]> = [
  ['nothing on file, memory on', null, true, 'client-ai-v7'],
  ['nothing on file, memory off', null, false, 'client-ai-v6'],
  ['withdrawn v5 on file', { action: 'withdraw', version: 'client-ai-v5' }, true, 'client-ai-v7'],
  ['withdrawn v4 on file, memory off', { action: 'withdraw', version: 'client-ai-v4' }, false, 'client-ai-v6'],
];

describe('B-A: the AI sheet records the text it presented', () => {
  it.each(SHEET)('%s', async (_row, held, memoryOn, version) => {
    const srv = server(held, memoryOn);
    const onGranted = jest.fn();
    const r = await render(<AiConsentSheet visible onGranted={onGranted} onClose={jest.fn()} sessionUserId={() => 'u1'} testID="s" />);
    await waitFor(() => r.getByTestId('s-allow'));
    const presented = { paragraph: text(r, 's-paragraph'), label: text(r, 's-label') };
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    const body = mockHttp.post.mock.calls[0][1] as GrantRomanConsentRequest;
    expect(body.version).toBe(version);
    expect(presented).toEqual({ paragraph: TEXT[version], label: B_LABEL });
    expect(body.copy_sha256).toBe(sha(`${presented.paragraph}\n\n${presented.label}`));
    expect(srv.recorded()).toEqual({ action: 'grant', version });
  });
});
