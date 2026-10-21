/**
 * CONSENT-SETTINGS (agent 164; owner #162-6, b#1117): Settings > Roman and AI and the AI help sheet show and record
 * exactly what sign-up (P0, m#843) does: the Health-notes copies (client-ai-v10 to v13) only when the server serves
 * them, today's otherwise, and nobody is asked again. The fake server answers as b#1117's toStatus does for a client
 * with a coach; `old` is a server before b#1117, which reads ?variant=health_notes as no variant and knows no v10 to
 * v13. The texts are rebuilt from the backend's and checked against this build's pins.
 */
import React from 'react';
import { createHash } from 'crypto';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseStatus, type AiConsentAsk, type AiConsentOutcome, type AiConsentStatusResponse, type GrantRomanConsentRequest } from '../../../api/aiConsentApi';
import { featureFlagsKeys } from '../../../hooks/useFeatureFlags';
import AiConsentSheet from '../../../components/ai/AiConsentSheet';
import RomanAiConsentScreen, { ROMAN_AI_COPY } from '../../../screens/settings/RomanAiConsentScreen';
import { NOW } from '../../consultation/__fixtures__/consultFixtures';
import { resetStores } from '../../consultation/__fixtures__/flowHarness';
import { resetAiLedgerWritesForTests, ROMAN_HEALTH_ASK, servesHealthNotes } from '../../consultation/aiConsent';
import * as copy from '../../consultation/copy';

jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn(async () => undefined) }));
jest.mock('../../userCache', () => ({
  readUserCacheSync: () => ({ id: 'u1', coach_id: 'coach-1' }),
  readUserCache: async () => null,
  clearUserCache: async () => undefined,
}));
jest.mock('../../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../../services/queryClient', () => ({
  retireAndDrainIdentityPersistences: jest.fn(async () => undefined),
  settleAndClearQueryCache: jest.fn(async () => undefined),
  purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined),
}));

// growth-project-backend main @ 00987b1a, src/ai-consent/ai-consent.constants.ts (client-ai-v5), verbatim.
const B_V5 =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
const B_EXCEPTION =
  'One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.';
const B_TOLD = 'If Roman sends you a crisis safety reply, your coach is told that it happened, but not what you wrote, so they can check in with you.';
const V5_TAIL = 'Your conversations with Roman are kept until you delete them or delete your account.';
const V5_HEAD = B_V5.slice(0, -V5_TAIL.length);
const V7 = `${V5_HEAD}${B_EXCEPTION} ${V5_TAIL}`;
const V9 = `${V5_HEAD}${B_EXCEPTION} ${B_TOLD} ${V5_TAIL}`;
const TEXT: Record<string, string> = {
  'client-ai-v4': copy.AI_CONSENT_PARAGRAPH_PRE57C,
  'client-ai-v5': B_V5,
  'client-ai-v6': copy.AI_CONSENT_PARAGRAPH,
  'client-ai-v7': V7,
  'client-ai-v8': copy.AI_CONSENT_PARAGRAPH_CRISIS,
  'client-ai-v9': V9,
  'client-ai-v10': copy.withHealthNotes(V7),
  'client-ai-v11': copy.withHealthNotes(V9),
  'client-ai-v12': copy.AI_CONSENT_PARAGRAPH_HEALTH,
  'client-ai-v13': copy.AI_CONSENT_PARAGRAPH_HEALTH_CRISIS,
};
const LABEL = copy.AI_CONSENT_CHECKBOX_LABEL;
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const pinOf = (v: string) => sha(`${TEXT[v]}\n\n${LABEL}`);
const FAMILIES = {
  pre57c: ['client-ai-v4', 'client-ai-v5'],
  coached: ['client-ai-v6', 'client-ai-v7'],
  crisis: ['client-ai-v8', 'client-ai-v9'],
  health: ['client-ai-v12', 'client-ai-v10'],
  health_crisis: ['client-ai-v13', 'client-ai-v11'],
} as const;
type Family = keyof typeof FAMILIES;
const familyOf = (v: string) => (Object.keys(FAMILIES) as Family[]).find((f) => (FAMILIES[f] as readonly string[]).includes(v)) as Family;
const isMemory = (v: string) => FAMILIES[familyOf(v)][1] === v;
const isHealth = (v: string) => familyOf(v).startsWith('health');
const variantOf = (o?: AiConsentAsk) =>
  o ? (o.coachFree ? 'coach_free' : o.healthNotes ? 'health_notes' : o.crisis ? 'crisis_alert' : 'safety_exception') : null;
const copyOf = (v: string) => ({
  version: v,
  processor: 'anthropic',
  paragraph: { text: TEXT[v], sha256: sha(TEXT[v]) },
  box_label: { text: LABEL, sha256: sha(LABEL) },
  sha256: pinOf(v),
});

/**
 * b#1117 toStatus (client with a coach): a live grant keeps the copies on file; otherwise the copies asked for:
 * health_notes = the Health-notes family, crisis by the server's switch (`on`). The memory offer follows the ask.
 * `old` (before b#1117): health_notes is no variant (the copies on file, else v4 / v5) and v10 to v13 are refused.
 */
function server(on: boolean, held: string | null, { old = false, memoryOn = true } = {}) {
  let row: { version: string; grant: boolean } | null = held ? { version: held, grant: true } : null;
  const raw = (sent: string | null) => {
    const variant = old && sent === 'health_notes' ? null : sent;
    const asked: Family = variant === 'health_notes' ? (on ? 'health_crisis' : 'health') : variant === 'crisis_alert' && on ? 'crisis' : 'coached';
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
      memory_copy: memory || !memoryOn ? null : copyOf(FAMILIES[variant ? asked : family][1]),
    };
  };
  const ok = (body: object): AiConsentOutcome => ({ kind: 'ok', status: parseStatus(body) as AiConsentStatusResponse });
  const api = {
    getStatus: jest.fn(async (o?: AiConsentAsk): Promise<AiConsentOutcome> => ok(raw(variantOf(o)))),
    grantRoman: jest.fn(async (body: GrantRomanConsentRequest, o?: AiConsentAsk): Promise<AiConsentOutcome> => {
      if (!TEXT[body.version] || body.copy_sha256 !== pinOf(body.version) || (old && isHealth(body.version))) return { kind: 'version_mismatch' };
      row = { version: body.version, grant: true };
      return ok(raw(variantOf(o)));
    }),
    withdrawRoman: jest.fn(async (o?: AiConsentAsk): Promise<AiConsentOutcome> => {
      row = row && { version: row.version, grant: false };
      return ok(raw(variantOf(o)));
    }),
  };
  return { api, raw, recorded: () => row };
}

function flagClient(on: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(featureFlagsKeys.all, { flags: { roman_crisis_alert: on }, evaluated_at: '2026-10-15T00:00:00.000Z' });
  return qc;
}
const nav = { goBack: jest.fn(), navigate: jest.fn() } as never;
const settings = (on: boolean, srv: ReturnType<typeof server>) =>
  render(
    <QueryClientProvider client={flagClient(on)}>
      <RomanAiConsentScreen navigation={nav} api={srv.api} sessionUserId={() => 'u1'} />
    </QueryClientProvider>,
  );
const sheet = (on: boolean, srv: ReturnType<typeof server>, onGranted = jest.fn()) =>
  render(
    <QueryClientProvider client={flagClient(on)}>
      <AiConsentSheet visible onGranted={onGranted} onClose={jest.fn()} api={srv.api} sessionUserId={() => 'u1'} testID="s" />
    </QueryClientProvider>,
  );
const paragraph = (r: { getByTestId: (id: string) => { props: { children?: unknown } } }, id = 'roman-ai-paragraph') =>
  r.getByTestId(id).props.children as string;
/** Presses the last alert's action (the one that is not Cancel) and returns the alert's message. */
function confirmLast(): string {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [, message, buttons] = calls[calls.length - 1] as [string, string, AlertButton[]];
  buttons[buttons.length - 1].onPress?.();
  return message;
}
const TODAY = (on: boolean): AiConsentAsk => ({ crisis: on });

beforeEach(async () => {
  resetAiLedgerWritesForTests();
  await resetStores();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => (Alert.alert as jest.Mock).mockRestore());

describe('CONSENT-SETTINGS: the texts and the switch', () => {
  it('v10 to v13 are v7, v9, v6 and v8 with the one approved sentence, and hash to this build pins', () => {
    expect(['client-ai-v12', 'client-ai-v13', 'client-ai-v10', 'client-ai-v11'].map(pinOf)).toEqual([
      copy.AI_CONSENT_HEALTH_COPY_SHA256,
      copy.AI_CONSENT_HEALTH_CRISIS_COPY_SHA256,
      copy.AI_CONSENT_HEALTH_MEMORY_COPY_SHA256,
      copy.AI_CONSENT_HEALTH_CRISIS_MEMORY_COPY_SHA256,
    ]);
    expect([pinOf('client-ai-v7'), pinOf('client-ai-v9')]).toEqual([copy.AI_CONSENT_MEMORY_COPY_SHA256, copy.AI_CONSENT_CRISIS_MEMORY_COPY_SHA256]);
    for (const v of ['client-ai-v10', 'client-ai-v11', 'client-ai-v12', 'client-ai-v13']) {
      expect(TEXT[v].split(copy.ROMAN_HEALTH_NOTES_SENTENCE)).toHaveLength(2);
    }
  });

  it.each([false, true])('switch %s: served only when the answer names v10 to v13', (on) => {
    const answer = (srv: ReturnType<typeof server>, variant: string) => parseStatus(srv.raw(variant)) as AiConsentStatusResponse;
    expect(servesHealthNotes(answer(server(on, null), 'health_notes'))).toBe(true);
    expect(servesHealthNotes(answer(server(on, 'client-ai-v6'), 'health_notes'))).toBe(true); // its memory offer
    expect(servesHealthNotes(answer(server(on, 'client-ai-v12', { memoryOn: false }), 'health_notes'))).toBe(true);
    expect(servesHealthNotes(answer(server(on, null, { old: true }), 'health_notes'))).toBe(false);
    expect(servesHealthNotes(answer(server(on, 'client-ai-v9'), 'health_notes'))).toBe(false); // nothing new to offer
    expect(servesHealthNotes(answer(server(on, null), 'crisis_alert'))).toBe(false);
  });
});

// [case, held at sign-up, old server, memory on, the server serves the Health-notes copies]
const SETTINGS: Array<[string, string | null, boolean, boolean, boolean]> = [
  ['skipped at sign-up, new server: Allow later records the Health-notes words', null, false, true, true],
  ['skipped at sign-up, new server, memory off', null, false, false, true],
  ['skipped at sign-up, old server: today words', null, true, true, false],
  ['v12 at sign-up (memory off), new server: memory on offers v10 / v11', 'client-ai-v12', false, true, true],
  ['v6 before b#1117, new server: kept; memory on offers v10 / v11', 'client-ai-v6', false, true, true],
  ['v9 before b#1117, new server: kept; nothing new served, so today words', 'client-ai-v9', false, true, false],
  ['v8 before b#1117, old server: kept; today words', 'client-ai-v8', true, true, false],
];

describe('CONSENT-SETTINGS: Settings > Roman and AI makes every choice in what the server served', () => {
  it.each(SETTINGS.flatMap(([name, ...rest]) => [false, true].map((on) => [name, on, ...rest] as const)))(
    '%s (switch %s)',
    async (_name, on, held, old, memoryOn, health) => {
      const srv = server(on, held, { old, memoryOn });
      const ask = health ? ROMAN_HEALTH_ASK : TODAY(on);
      const asked = FAMILIES[health ? (on ? 'health_crisis' : 'health') : on ? 'crisis' : 'coached'];
      const r = await settings(on, srv);
      await waitFor(() => r.getByTestId(held ? 'roman-ai-allowed' : 'roman-ai-not_allowed'));
      // P0's fallback: the Health-notes ask first; today's again only when the server did not serve them.
      expect(srv.api.getStatus.mock.calls).toEqual(health ? [[ROMAN_HEALTH_ASK]] : [[ROMAN_HEALTH_ASK], [TODAY(on)]]);
      // Nobody is asked again: a live grant shows its own words.
      expect(paragraph(r)).toBe(TEXT[held ?? asked[memoryOn ? 1 : 0]]);
      const steps = held === null ? ['allow'] : isMemory(held) ? ['memory off', 'memory on'] : ['memory on', 'memory off'];
      for (const step of [...steps, 'withdraw', 'allow']) {
        const sent = srv.api.grantRoman.mock.calls.length;
        const before = paragraph(r);
        if (step === 'allow') await fireEvent.press(r.getByTestId('roman-ai-allow'));
        else if (step === 'withdraw') await fireEvent.press(r.getByTestId('roman-ai-withdraw'));
        else await fireEvent(r.getByTestId('roman-ai-memory-switch'), 'valueChange', step === 'memory on');
        const confirmation = confirmLast();
        if (step === 'withdraw') {
          await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
          expect(srv.api.withdrawRoman).toHaveBeenLastCalledWith(ask);
          continue;
        }
        await waitFor(() => expect(srv.api.grantRoman).toHaveBeenCalledTimes(sent + 1));
        const [body, sentAsk] = srv.api.grantRoman.mock.calls[sent];
        expect(sentAsk).toEqual(ask);
        expect(body.version).toBe(asked[step === 'memory off' || (step === 'allow' && !memoryOn) ? 0 : 1]);
        expect(srv.recorded()).toEqual({ version: body.version, grant: true });
        await waitFor(() => expect(paragraph(r)).toBe(TEXT[body.version]));
        // Recorded against exactly the words shown before the tap.
        const off = `${ROMAN_AI_COPY.confirmMemoryOffBody}\n\n`;
        const shown = step === 'memory on' ? confirmation : step === 'allow' ? before : confirmation.slice(off.length);
        expect(body.copy_sha256).toBe(sha(`${shown}\n\n${LABEL}`));
      }
      // No GET after the first load: each write's answer is read like the GET's.
      expect(srv.api.getStatus).toHaveBeenCalledTimes(health ? 1 : 2);
    },
  );
});

describe('CONSENT-SETTINGS: the AI help sheet shows and grants what the server served', () => {
  const rows = [false, true].flatMap((old) => [true, false].flatMap((memoryOn) => [false, true].map((on) => [old, memoryOn, on] as const)));
  it.each(rows)('old server %s, memory on %s, switch %s: skipped at sign-up, allowed from the sheet', async (old, memoryOn, on) => {
    const srv = server(on, null, { old, memoryOn });
    const onGranted = jest.fn();
    const r = await sheet(on, srv, onGranted);
    await waitFor(() => r.getByTestId('s-allow'));
    const version = FAMILIES[old ? (on ? 'crisis' : 'coached') : on ? 'health_crisis' : 'health'][memoryOn ? 1 : 0];
    expect(paragraph(r, 's-paragraph')).toBe(TEXT[version]);
    expect(srv.api.getStatus.mock.calls).toEqual(old ? [[ROMAN_HEALTH_ASK], [TODAY(on)]] : [[ROMAN_HEALTH_ASK]]);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    expect(srv.api.grantRoman.mock.calls[0]).toEqual([
      expect.objectContaining({ version, copy_sha256: pinOf(version) }),
      old ? TODAY(on) : ROMAN_HEALTH_ASK,
    ]);
    expect(srv.recorded()).toEqual({ version, grant: true });
  });

  const held = [['client-ai-v6', false], ['client-ai-v6', true], ['client-ai-v9', false], ['client-ai-v9', true], ['client-ai-v12', false]] as const;
  it.each(held)('a live %s grant is never asked again (old server %s)', async (v, old) => {
    const srv = server(true, v, { old });
    const r = await sheet(true, srv);
    await waitFor(() => r.getByTestId('s-already-on'));
    expect(srv.api.grantRoman).not.toHaveBeenCalled();
  });
});
