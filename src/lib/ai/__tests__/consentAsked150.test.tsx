/**
 * FIXCONSENT (agent 150; Sol B1 on m#684 / m#734, backend b#1047): a client is recorded against exactly the text
 * they were shown, in every family (consult, client-ai, coach-free), with roman_crisis_alert off and on. A live
 * grant is read with the copies on file; every new choice is made in the copies asked for, and each POST / DELETE
 * sends the same ask as the GET. The pins are rebuilt from the backend's text; the fake server answers as b#1047's
 * toStatus does for a client with a coach. FIX745R1: P0 is driven through the real navigator and API client against
 * backend main's age gate, and only the server knows the crisis switch.
 */
import React from 'react';
import { createHash } from 'crypto';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  aiConsentApi,
  parseStatus,
  type AiConsentAsk,
  type AiConsentOutcome,
  type AiConsentStatusResponse,
  type GrantRomanConsentRequest,
} from '../../../api/aiConsentApi';
import { featureFlagsKeys } from '../../../hooks/useFeatureFlags';
import RomanAiConsentScreen, { ROMAN_AI_COPY } from '../../../screens/settings/RomanAiConsentScreen';
import ConsultationOnboardingNavigator from '../../../navigation/ConsultationOnboardingNavigator';
import { NOW } from '../../consultation/__fixtures__/consultFixtures';
import { resetStores } from '../../consultation/__fixtures__/flowHarness';
import { resetAiLedgerWritesForTests, romanFamily } from '../../consultation/aiConsent';
import { isConsentAnswerCurrent } from '../../consultation/engine';
import * as copy from '../../consultation/copy';

const mockHttp = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockHttp.get(...a),
    post: (...a: unknown[]) => mockHttp.post(...a),
    put: (...a: unknown[]) => mockHttp.put(...a),
    delete: (...a: unknown[]) => mockHttp.delete(...a),
  },
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
const mockGetFlags = jest.fn();
jest.mock('../../../api/featureFlagsApi', () => ({ featureFlagsApi: { getFeatureFlags: () => mockGetFlags() } }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn(async () => undefined) }));
/** The navigator's signed-in client (P0 rows); null elsewhere. */
let mockUser: { id: string; coach_id?: string } | null = null;
jest.mock('../../userCache', () => ({
  readUserCacheSync: () => mockUser ?? { id: 'u1', coach_id: 'coach-1' },
  readUserCache: async () => mockUser,
  clearUserCache: async () => undefined,
}));
jest.mock('../../../services/authActions', () => ({ signOut: jest.fn() }));
jest.mock('../../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../../services/queryClient', () => ({
  retireAndDrainIdentityPersistences: jest.fn(async () => undefined),
  settleAndClearQueryCache: jest.fn(async () => undefined),
  purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined),
}));

// growth-project-backend main, src/ai-consent/ai-consent.constants.ts and src/roman/roman.feature.ts, verbatim.
const B_V4 =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Only your own data is used, never another client's, and never your coach's private notes. Your conversations with Roman are private from your coach and are kept until you delete them or delete your account.";
const B_V5 =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
const B_EXCEPTION =
  'One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.';
const B_TOLD = 'If Roman sends you a crisis safety reply, your coach is told that it happened, but not what you wrote, so they can check in with you.';
const B_LABEL = "Optional: I allow Roman and my coach's AI tools to use my information, processed by Anthropic.";
const V5_TAIL = 'Your conversations with Roman are kept until you delete them or delete your account.';
const V5_HEAD = B_V5.slice(0, -V5_TAIL.length);
/** Each client-ai version's paragraph: the exception after the first coach promise, the crisis sentence after it. */
const TEXT: Record<string, string> = {
  'client-ai-v4': B_V4,
  'client-ai-v5': B_V5,
  'client-ai-v6': `${B_V4} ${B_EXCEPTION}`,
  'client-ai-v7': `${V5_HEAD}${B_EXCEPTION} ${V5_TAIL}`,
  'client-ai-v8': `${B_V4} ${B_EXCEPTION} ${B_TOLD}`,
  'client-ai-v9': `${V5_HEAD}${B_EXCEPTION} ${B_TOLD} ${V5_TAIL}`,
};
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
/** The copy sha256 the ledger records: paragraph and box 2 label, as shown. */
const pinOf = (version: string) => sha(`${TEXT[version]}\n\n${B_LABEL}`);

const FAMILIES = {
  pre57c: ['client-ai-v4', 'client-ai-v5'],
  coached: ['client-ai-v6', 'client-ai-v7'],
  crisis: ['client-ai-v8', 'client-ai-v9'],
} as const;
type Family = keyof typeof FAMILIES;
const familyOf = (v: string) => (Object.keys(FAMILIES) as Family[]).find((f) => (FAMILIES[f] as readonly string[]).includes(v)) as Family;
const isMemory = (v: string) => FAMILIES[familyOf(v)][1] === v;
const copyOf = (v: string) => ({
  version: v,
  processor: 'anthropic',
  paragraph: { text: TEXT[v], sha256: sha(TEXT[v]) },
  box_label: { text: B_LABEL, sha256: sha(B_LABEL) },
  sha256: pinOf(v),
});
const variantOf = (o?: AiConsentAsk) => (o ? (o.coachFree ? 'coach_free' : o.crisis ? 'crisis_alert' : 'safety_exception') : null);

/**
 * b#1047 toStatus (client with a coach): a live grant, or a call without ?variant=, keeps the copies on file;
 * otherwise the copies asked for (crisis only while the switch is on). The memory offer follows the ask.
 * POST records the version only when its sha256 is the pin of that version's text.
 */
function server(on: boolean, held: string | null, memoryOn = true) {
  let row: { version: string; grant: boolean } | null = held ? { version: held, grant: true } : null;
  /** The JSON body for ?variant= (null: none). */
  const raw = (variant: string | null) => {
    const asked: Family = variant === 'crisis_alert' && on ? 'crisis' : 'coached';
    const granted = row?.grant === true;
    const family: Family = granted || !variant ? (row ? familyOf(row.version) : 'pre57c') : asked;
    const memory = !!row && granted && isMemory(row.version);
    const current = FAMILIES[family][memory ? 1 : 0];
    return {
      purpose: 'client_ai_processing',
      processor: 'anthropic',
      granted,
      state: granted ? 'granted' : row ? 'withdrawn' : 'not_granted',
      version: row?.version ?? null,
      granted_at: granted ? NOW.toISOString() : null,
      withdrawn_at: row && !granted ? NOW.toISOString() : null,
      current_version: current,
      needs_reconsent: false,
      copy: copyOf(current),
      scope: granted ? (memory ? 'memory' : 'base') : null,
      upgrade: null,
      memory_on: memoryOn,
      memory_copy: memory ? null : copyOf(FAMILIES[variant ? asked : family][1]),
    };
  };
  /** POST: null (nothing written) unless the sha256 is the pin of that version's text. */
  const grant = (body: GrantRomanConsentRequest, variant: string | null) => {
    if (!TEXT[body.version] || body.copy_sha256 !== pinOf(body.version)) return null;
    row = { version: body.version, grant: true };
    return raw(variant);
  };
  const withdraw = (variant: string | null) => {
    row = row && { version: row.version, grant: false };
    return raw(variant);
  };
  const ok = (body: object): AiConsentOutcome => ({ kind: 'ok', status: parseStatus(body) as AiConsentStatusResponse });
  const api = {
    getStatus: jest.fn(async (o?: AiConsentAsk): Promise<AiConsentOutcome> => ok(raw(variantOf(o)))),
    grantRoman: jest.fn(async (body: GrantRomanConsentRequest, o?: AiConsentAsk): Promise<AiConsentOutcome> => {
      const out = grant(body, variantOf(o));
      return out ? ok(out) : { kind: 'version_mismatch' };
    }),
    withdrawRoman: jest.fn(async (o?: AiConsentAsk): Promise<AiConsentOutcome> => ok(withdraw(variantOf(o)))),
  };
  return { api, raw, grant, withdraw, recorded: () => row };
}

/** Backend main's pre-age allow list: the @AllowBeforeAgeConfirmed controllers (src/auth/README.md, AGEGATE16). */
const PRE_AGE = /^\/(auth\/|me\/onboarding|me\/ai-consent|consent\/|profile|me\/delete-account|v1\/me\/data-export|users\/me\/push-token)/;
const refusal = (status: number, code: string) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { code } } });

/** Backend main over HTTP: every other route answers 403 AGE_CONFIRMATION_REQUIRED (no date of birth yet). Returns the calls. */
function backend(srv: ReturnType<typeof server>) {
  const calls: string[] = [];
  const answer = (method: 'get' | 'post' | 'put' | 'delete') => async (url: string, a?: unknown, b?: unknown) => {
    calls.push(`${method.toUpperCase()} ${url}`);
    if (!PRE_AGE.test(url)) throw refusal(403, 'AGE_CONFIRMATION_REQUIRED');
    const config = (method === 'get' || method === 'delete' ? a : b) as { params?: { variant?: string } } | undefined;
    const variant = config?.params?.variant ?? null;
    if (url === '/me/ai-consent') return { status: 200, data: srv.raw(variant) };
    if (url === '/me/ai-consent/roman') {
      const data = method === 'post' ? srv.grant(a as GrantRomanConsentRequest, variant) : srv.withdraw(variant);
      if (!data) throw refusal(409, 'CONSENT_VERSION_MISMATCH');
      return { status: 200, data };
    }
    if (url === '/me/onboarding/consultation') return { status: 200, data: { saved_at: NOW.toISOString(), completed_chapters: [1] } };
    return { status: 200, data: null };
  };
  for (const m of ['get', 'post', 'put', 'delete'] as const) mockHttp[m].mockReset().mockImplementation(answer(m));
  mockGetFlags.mockReset().mockImplementation(() => answer('get')('/me/feature-flags'));
  return calls;
}

function flagClient(on: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(featureFlagsKeys.all, { flags: { roman_crisis_alert: on }, evaluated_at: '2026-10-15T00:00:00.000Z' });
  return qc;
}
const nav = { goBack: jest.fn(), navigate: jest.fn() } as never;
const paragraph = (r: { getByTestId: (id: string) => { props: { children?: unknown } } }) =>
  r.getByTestId('roman-ai-paragraph').props.children as string;
/** Presses the last alert's action (the one that is not Cancel) and returns the alert's message. */
function confirmLast(): string {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [, message, buttons] = calls[calls.length - 1] as [string, string, AlertButton[]];
  buttons[buttons.length - 1].onPress?.();
  return message;
}
const strings = (n: unknown): string[] =>
  typeof n === 'string' ? [n] : Array.isArray(n) ? n.flatMap(strings) : n && typeof n === 'object' ? strings((n as { children?: unknown }).children ?? null) : [];

beforeEach(async () => {
  mockUser = null;
  resetAiLedgerWritesForTests();
  await resetStores();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => (Alert.alert as jest.Mock).mockRestore());

describe('FIXCONSENT: pins and requests', () => {
  it('every client-ai pin is rebuilt from its text; the coach-free crisis P0 records stay current', () => {
    expect(Object.keys(TEXT).map(pinOf)).toEqual([
      copy.AI_CONSENT_PRE57C_COPY_SHA256,
      copy.AI_CONSENT_PRE57C_MEMORY_COPY_SHA256,
      copy.AI_CONSENT_COPY_SHA256,
      copy.AI_CONSENT_MEMORY_COPY_SHA256,
      copy.AI_CONSENT_CRISIS_COPY_SHA256,
      copy.AI_CONSENT_CRISIS_MEMORY_COPY_SHA256,
    ]);
    for (const [f, crisis] of [['coached', false], ['crisis', true]] as const) {
      const [base, memory] = FAMILIES[f];
      expect(romanFamily(false, crisis)).toMatchObject({ baseVersion: base, baseSha256: pinOf(base), memoryVersion: memory, memorySha256: pinOf(memory) });
      expect([copy.consentScreenCopy(false, crisis).aiParagraph, copy.consentScreenCopy(true, crisis).aiParagraph]).toEqual([TEXT[base], TEXT[base]]);
    }
    for (const v of ['consult-consent-v10-coach-free', 'consult-consent-v11-coach-free']) {
      expect(isConsentAnswerCurrent({ agreed: true, copy_version: v, agreed_at: NOW.toISOString(), text_sha256: 'a'.repeat(64) } as never)).toBe(true);
    }
  });

  it('POST and DELETE send the same ?variant= as the GET when asked; the drains (no ask) send none', async () => {
    mockHttp.post.mockResolvedValue({ data: null });
    mockHttp.delete.mockResolvedValue({ data: null });
    const body = { version: 'client-ai-v8', copy_sha256: pinOf('client-ai-v8'), platform: 'ios' as const };
    for (const [ask, variant] of [
      [{ crisis: true }, 'crisis_alert'],
      [{ crisis: false }, 'safety_exception'],
      [{ coachFree: true }, 'coach_free'],
    ] as const) {
      await aiConsentApi.grantRoman(body, ask);
      expect(mockHttp.post).toHaveBeenLastCalledWith('/me/ai-consent/roman', body, { params: { variant } });
      await aiConsentApi.withdrawRoman(ask);
      expect(mockHttp.delete).toHaveBeenLastCalledWith('/me/ai-consent/roman', { params: { variant } });
    }
    await aiConsentApi.grantRoman(body);
    expect(mockHttp.post).toHaveBeenLastCalledWith('/me/ai-consent/roman', body);
    await aiConsentApi.withdrawRoman();
    expect(mockHttp.delete).toHaveBeenLastCalledWith('/me/ai-consent/roman');
  });
});

// Settings > Roman and AI, a client with a coach: [switch, the grant on file (null: none)].
const HOLDERS: Array<[boolean, string | null]> = [false, true].flatMap((on) =>
  [null, ...FAMILIES.pre57c, ...FAMILIES.coached, ...(on ? FAMILIES.crisis : [])].map((held): [boolean, string | null] => [on, held]),
);

describe('FIXCONSENT: Settings records every new choice against the text shown, in the copies asked for', () => {
  it.each(HOLDERS)('switch %s, on file %s', async (on, held) => {
    const srv = server(on, held);
    const asked = FAMILIES[on ? 'crisis' : 'coached'];
    const r = await render(
      <QueryClientProvider client={flagClient(on)}>
        <RomanAiConsentScreen navigation={nav} api={srv.api} sessionUserId={() => 'u1'} />
      </QueryClientProvider>,
    );
    await waitFor(() => r.getByTestId(held ? 'roman-ai-allowed' : 'roman-ai-not_allowed'));
    expect(srv.api.getStatus).toHaveBeenCalledWith({ crisis: on });
    // Every choice the screen offers from here, then Withdraw and Allow again.
    const steps = held === null ? ['allow', 'memory off', 'memory on'] : isMemory(held) ? ['memory off', 'memory on'] : ['memory on', 'memory off', 'memory on'];
    for (const step of [...steps, 'withdraw', 'allow']) {
      const sent = srv.api.grantRoman.mock.calls.length;
      const before = paragraph(r);
      if (step === 'allow') await fireEvent.press(r.getByTestId('roman-ai-allow'));
      else if (step === 'withdraw') await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
      else await fireEvent(r.getByTestId('roman-ai-memory-switch'), 'valueChange', step === 'memory on');
      const confirmation = confirmLast();
      if (step === 'withdraw') {
        await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
        expect(srv.api.withdrawRoman).toHaveBeenLastCalledWith({ crisis: on });
        continue;
      }
      await waitFor(() => expect(srv.api.grantRoman).toHaveBeenCalledTimes(sent + 1));
      const [body, ask] = srv.api.grantRoman.mock.calls[sent];
      expect(ask).toEqual({ crisis: on });
      expect(body.version).toBe(asked[step === 'memory off' ? 0 : 1]);
      expect(srv.recorded()).toEqual({ version: body.version, grant: true });
      // The answer is shown at once, and it is the recorded text.
      await waitFor(() => expect(paragraph(r)).toBe(TEXT[body.version]));
      // B-A (FIXCONSENT2): what was presented BEFORE the write, never the text shown after it: the memory-on
      // confirmation, the paragraph above Allow, or the agreement text after the memory-off words.
      const off = `${ROMAN_AI_COPY.confirmMemoryOffBody}\n\n`;
      if (step === 'memory off') expect(confirmation.startsWith(off)).toBe(true);
      const shown = step === 'memory on' ? confirmation : step === 'allow' ? before : confirmation.slice(off.length);
      expect(body.copy_sha256).toBe(sha(`${shown}\n\n${B_LABEL}`));
    }
  });
});

// P0: [no coach, switch, memory on, P0 version, b#1041 / b#1046 screen pin].
const P0: Array<[boolean, boolean, boolean, string, string]> = [
  [false, false, false, 'consult-consent-v7', '7711079209acecedfb50c31787787124af843f076154e9bfbd1e33550e861e09'],
  [false, false, true, 'consult-consent-v8', 'b98e160e884aecdca059b90f7a88803ba84eeac79b692e83eba9f734f93274b2'],
  [false, true, false, 'consult-consent-v9', '1daf2cde65d223686b4bd60f786b85866f93714176dcc8781ff94b4c9f0e30bf'],
  [false, true, true, 'consult-consent-v10', '5f36acf2704699f1e7faa68d7c65b8b8ed1f1988d197774a61914b97f22ff512'],
  [true, false, false, 'consult-consent-v8-coach-free', '5369ee9c57412dd2233850a7cae2043a32645431ee3b3484a14c19b8c503c633'],
  [true, false, true, 'consult-consent-v9-coach-free', '4a1e19730f3fab3b8a6a8119f5425cd3c0f6ed2f502d229d25dbb7fe5df35771'],
  [true, true, false, 'consult-consent-v10-coach-free', 'b79c1f039e2832560593390b7b66a91f61b2e7be5eb55ef3509ecd7a100d7c4c'],
  [true, true, true, 'consult-consent-v11-coach-free', '3528b10d50d8e7bb67a3065b86ba2b5cf33f3891b8194be413c78f2519e3257f'],
];

describe('FIXCONSENT: P0 through the navigator asks the server, never the flag, and records the screen shown', () => {
  it.each(P0)('no coach %s, switch %s, memory %s: %s', async (coachless, on, memoryOn, version, pin) => {
    mockUser = coachless ? { id: 'u1' } : { id: 'u1', coach_id: 'coach-1' };
    const srv = server(on, null, memoryOn);
    const calls = backend(srv);
    const r = await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NavigationContainer>
          <ConsultationOnboardingNavigator />
        </NavigationContainer>
      </QueryClientProvider>,
    );
    await waitFor(() => r.getByTestId('consult-screen-W1'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    const box2 = FAMILIES[on ? 'crisis' : 'coached'][memoryOn ? 1 : 0];
    await waitFor(() => expect(r.getByTestId('consent-ai-paragraph').props.children).toBe(TEXT[box2]));
    expect(mockHttp.get).toHaveBeenCalledWith('/me/ai-consent', { params: { variant: 'crisis_alert' } });
    const out = strings(r.toJSON()); // every string from the P0 title to the Privacy Policy link, in display order
    const shown = out.slice(out.lastIndexOf(copy.CONSENT_TITLE, out.indexOf('Privacy Policy')), out.indexOf('Privacy Policy')).join('\n\n');
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(srv.recorded()).toEqual({ version: box2, grant: true }));
    const grantBody = { version: box2, copy_sha256: sha(`${TEXT[box2]}\n\n${B_LABEL}`) };
    expect(mockHttp.post).toHaveBeenCalledWith('/me/ai-consent/roman', expect.objectContaining(grantBody), { params: { variant: 'crisis_alert' } });
    expect(sha(shown)).toBe(pin);
    expect(mockHttp.put.mock.calls[0][0]).toBe('/me/onboarding/consultation');
    expect(mockHttp.put.mock.calls[0][1].answers.P0).toMatchObject({ agreed: true, copy_version: version, text_sha256: pin });
    // Before the date of birth, nothing outside backend main's allow list is asked (no GET /me/feature-flags).
    expect(calls).toContain('GET /me/ai-consent');
    expect(calls.filter((c) => !PRE_AGE.test(c.split(' ')[1]))).toEqual([]);
    expect(mockGetFlags).not.toHaveBeenCalled();
  });

  it('the rows are every record a P0 screen can name', () => {
    const named = [false, true].flatMap((cf) =>
      [false, true].flatMap((on) => {
        const c = copy.consentScreenCopy(cf, on);
        return [[cf, on, false, c.version, c.sha256], [cf, on, true, c.memoryVersion, c.memorySha256]];
      }),
    );
    expect(named).toEqual(P0);
  });
});
