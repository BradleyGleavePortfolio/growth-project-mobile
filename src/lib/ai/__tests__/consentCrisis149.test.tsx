/**
 * CONSENT-CRISIS (agent 149; owner #CRISIS-WORDING, #CRISIS-PRIVACY-PLACES, CRISIS-APP-COPY, cisis-old-consent, op 1):
 * wherever the app states the Roman safety-reply exception, the approved crisis sentence follows it, exactly while
 * FEATURE_ROMAN_CRISIS_ALERT is on (`roman_crisis_alert`; absent, loading or failed = off), never while it is off.
 * One table walks the whole list with the flag off and on; its last row proves there is no other place.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { createHash } from 'crypto';
import { Alert } from 'react-native';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { aiConsentApi, type AiConsentOutcome, type AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { featureFlagsKeys, useCrisisAlertNow, useFeatureFlags } from '../../../hooks/useFeatureFlags';
import AiConsentSheet from '../../../components/ai/AiConsentSheet';
import RomanAiConsentScreen from '../../../screens/settings/RomanAiConsentScreen';
import ConsultationFlow, { type ConsultationApi } from '../../../screens/consultation/ConsultationFlow';
import { ROMAN_CHATS_COPY } from '../../../screens/settings/romanChatsCopy';
import { trustRomanLine } from '../../../screens/trustCenterSharing';
import { NOW } from '../../consultation/__fixtures__/consultFixtures';
import { aiStatus, makeApi, resetStores } from '../../consultation/__fixtures__/flowHarness';
import { isLiveRomanGrant, resetAiLedgerWritesForTests, romanFamily, romanFamilyOf, romanGrantBody } from '../../consultation/aiConsent';
import { isConsentAnswerCurrent } from '../../consultation/engine';
import { withCrisisSentence } from '../../romanCrisisSentence';
import { clientPrivacyText, withSafetyException } from '../aiCoachless';
import * as copy from '../../consultation/copy';

const mockGet = jest.fn(async () => ({ status: 200, data: null }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => (mockGet as jest.Mock)(...a) },
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
const mockGetFlags = jest.fn();
jest.mock('../../../api/featureFlagsApi', () => ({ featureFlagsApi: { getFeatureFlags: () => mockGetFlags() } }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
let mockUser: { id: string; coach_id?: string } = { id: 'u1', coach_id: 'coach-1' };
jest.mock('../../userCache', () => ({ readUserCacheSync: () => mockUser, readUserCache: async () => null, clearUserCache: async () => undefined }));
jest.mock('../../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../../services/queryClient', () => ({
  retireAndDrainIdentityPersistences: jest.fn(async () => undefined),
  settleAndClearQueryCache: jest.fn(async () => undefined),
  purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined),
}));

// growth-project-backend#1041 @ 870b4ab0, verbatim (src/ai-consent/ai-consent.constants.ts, src/roman/roman.feature.ts).
const B_V4 =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Only your own data is used, never another client's, and never your coach's private notes. Your conversations with Roman are private from your coach and are kept until you delete them or delete your account.";
const B_V5 =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
const B_EXCEPTION =
  'One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.';
const B_TOLD = 'If Roman sends you a crisis safety reply, your coach is told that it happened, but not what you wrote, so they can check in with you.';
const B_LABEL = "Optional: I allow Roman and my coach's AI tools to use my information, processed by Anthropic.";
const V5_HEAD = B_V5.slice(0, -'Your conversations with Roman are kept until you delete them or delete your account.'.length);
const B_V6 = `${B_V4} ${B_EXCEPTION}`;
const B_V7 = `${V5_HEAD}${B_EXCEPTION} ${B_V5.slice(V5_HEAD.length)}`;
const B_V8 = `${B_V6} ${B_TOLD}`;
const B_V9 = `${V5_HEAD}${B_EXCEPTION} ${B_TOLD} ${B_V5.slice(V5_HEAD.length)}`;
// b#1041's pins: client-ai-v8 / v9 copy, consult-consent-v9 / v10 screen.
const PIN = {
  v8: 'af4cc4fa55aa72cab8e7c6cdcee881d6ba1f448df048088e47acd5e7d479e0ef',
  v9: '16074f18ce0e985e35ba7cfb3f12233cd993159585a35759c4580a730ed3c9dd',
  p0v9: '1daf2cde65d223686b4bd60f786b85866f93714176dcc8781ff94b4c9f0e30bf',
  p0v10: '5f36acf2704699f1e7faa68d7c65b8b8ed1f1988d197774a61914b97f22ff512',
};

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const copyOf = (version: string, text: string, sha256: string) => ({
  version,
  paragraph: { text, sha256: sha(text) },
  box_label: { text: B_LABEL, sha256: sha(B_LABEL) },
  sha256,
});
const live = (v: string, over: Partial<AiConsentStatusResponse> = {}) =>
  aiStatus({ granted: true, state: 'granted', version: v, current_version: v, ...over });
/** b#1041 GET for a client with a coach and no live grant: v8 / v9 exactly when crisis_alert is asked (switch on). */
const serverStatus = (crisis: boolean, memory: boolean) =>
  aiStatus({
    current_version: crisis ? 'client-ai-v8' : 'client-ai-v6',
    copy: crisis ? copyOf('client-ai-v8', B_V8, PIN.v8) : copyOf('client-ai-v6', B_V6, copy.AI_CONSENT_COPY_SHA256),
    memory_on: memory,
    memory_copy: crisis ? copyOf('client-ai-v9', B_V9, PIN.v9) : copyOf('client-ai-v7', B_V7, copy.AI_CONSENT_MEMORY_COPY_SHA256),
  });
const ledger = (memory: boolean) =>
  jest.fn(async (o?: { coachFree?: boolean; crisis?: boolean }): Promise<AiConsentOutcome> => ({ kind: 'ok', status: serverStatus(!!o?.crisis, memory) }));

const flagMap = (on: boolean) => ({ flags: { roman_crisis_alert: on }, evaluated_at: '2026-10-15T00:00:00.000Z' });
function flagClient(on: boolean | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (on !== null) qc.setQueryData(featureFlagsKeys.all, flagMap(on));
  return qc;
}
const withFlag = (on: boolean, ui: React.ReactElement) => <QueryClientProvider client={flagClient(on)}>{ui}</QueryClientProvider>;
const nav = { goBack: jest.fn(), navigate: jest.fn() } as never;
const settings = (on: boolean, getStatus: jest.Mock) =>
  render(withFlag(on, <RomanAiConsentScreen navigation={nav} api={{ getStatus, grantRoman: jest.fn(), withdrawRoman: jest.fn() }} sessionUserId={() => 'u1'} />));
const flow = (api: ConsultationApi, crisisAlert: boolean, coachless = false) => (
  <ConsultationFlow userId="u1" firstName="Maya" coachless={coachless} crisisAlert={crisisAlert} api={api} onFinished={jest.fn()} now={() => NOW} autoAdvanceMs={0} prepMinMs={0} />
);
async function toP0(api: ConsultationApi, crisisAlert: boolean, coachless = false) {
  const r = await render(flow(api, crisisAlert, coachless));
  await waitFor(() => r.getByTestId('consult-screen-W1'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  return Object.assign(r, { paragraph: () => r.getByTestId('consent-ai-paragraph').props.children });
}

const SRC = path.join(__dirname, '..', '..', '..');
const source = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? (['__tests__', '__fixtures__'].includes(d.name) ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)],
  );
const filesWith = (re: RegExp) =>
  walk(SRC)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && re.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .sort();

const ROWS: { row: string; check: (on: boolean) => void | Promise<void> }[] = [
  {
    row: 'the consent fetch asks variant=crisis_alert exactly while the flag reads on, as useFeatureFlags reads it',
    check: async (on) => {
      await aiConsentApi.getStatus({ crisis: on });
      expect(mockGet).toHaveBeenLastCalledWith('/me/ai-consent', { params: { variant: on ? 'crisis_alert' : 'safety_exception' } });
      await aiConsentApi.getStatus({ coachFree: true, crisis: on });
      expect(mockGet).toHaveBeenLastCalledWith('/me/ai-consent', { params: { variant: 'coach_free' } });
      // Loading, a good read, then a failed refresh (off even after an earlier true); no QueryClient = off.
      mockGetFlags.mockReset().mockResolvedValueOnce(flagMap(on)).mockRejectedValue(new Error('offline'));
      const qc = flagClient(null);
      const useBoth = () => [useCrisisAlertNow()(), useFeatureFlags().flags.roman_crisis_alert];
      const { result } = await renderHook(useBoth, { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
      await waitFor(() => expect([qc.getQueryState(featureFlagsKeys.all)?.status, ...result.current]).toEqual(['success', on, on]));
      await act(async () => void (await qc.refetchQueries({ queryKey: featureFlagsKeys.all })));
      await waitFor(() => expect(result.current).toEqual([false, false]));
      expect((await renderHook(() => useCrisisAlertNow())).result.current()).toBe(false);
    },
  },
  {
    row: 'pins and digests of client-ai-v8 / v9 and consult-consent-v9 / v10 equal b#1041 byte for byte; P0 uses them only when answered',
    check: (on) => {
      expect([copy.AI_CONSENT_PARAGRAPH, copy.AI_CONSENT_PARAGRAPH_CRISIS]).toEqual([B_V6, B_V8]);
      expect([sha(`${B_V8}\n\n${B_LABEL}`), sha(`${B_V9}\n\n${B_LABEL}`)]).toEqual([PIN.v8, PIN.v9]);
      expect([copy.AI_CONSENT_CRISIS_COPY_SHA256, copy.AI_CONSENT_CRISIS_MEMORY_COPY_SHA256]).toEqual([PIN.v8, PIN.v9]);
      expect([sha(copy.consentCopyText(B_V8)), sha(copy.consentCopyText(B_V9))]).toEqual([PIN.p0v9, PIN.p0v10]);
      expect([copy.CONSENT_CRISIS_COPY_SHA256, copy.CONSENT_CRISIS_MEMORY_COPY_SHA256]).toEqual([PIN.p0v9, PIN.p0v10]);
      expect(romanFamily(false, true)).toMatchObject({ baseVersion: 'client-ai-v8', baseSha256: PIN.v8, memoryVersion: 'client-ai-v9', memorySha256: PIN.v9 });
      expect(copy.consentScreenCopy(false, on)).toMatchObject({
        aiParagraph: on ? B_V8 : B_V6,
        version: on ? 'consult-consent-v9' : 'consult-consent-v7',
        sha256: on ? PIN.p0v9 : copy.CONSENT_COPY_SHA256,
        memoryVersion: on ? 'consult-consent-v10' : 'consult-consent-v8',
        memorySha256: on ? PIN.p0v10 : copy.CONSENT_MEMORY_COPY_SHA256,
      });
      expect(source('screens/consultation/QuestionScreen.tsx')).toContain('consentScreenCopy(!!ctx?.coachless, !!state?.aiCrisis)');
    },
  },
  {
    row: 'P0 box 2: asks by the flag, shows the server text, records consult-consent-v10 and grants client-ai-v9',
    check: async (on) => {
      const api = makeApi({ getRomanConsent: ledger(true) });
      const r = await toP0(api, on);
      await waitFor(() => expect(r.paragraph()).toBe(on ? B_V9 : B_V7));
      expect(api.getRomanConsent).toHaveBeenCalledWith({ crisis: on });
      await fireEvent.press(r.getByTestId('consent-checkbox'));
      await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
      await fireEvent.press(r.getByTestId('consult-continue'));
      await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
      expect(api.grantRomanConsent.mock.calls[0][0]).toMatchObject(
        on ? { version: 'client-ai-v9', copy_sha256: PIN.v9 } : { version: 'client-ai-v7', copy_sha256: copy.AI_CONSENT_MEMORY_COPY_SHA256 },
      );
      expect(api.save.mock.calls[0][0].answers.P0).toMatchObject(
        on ? { copy_version: 'consult-consent-v10', text_sha256: PIN.p0v10 } : { copy_version: 'consult-consent-v8', text_sha256: copy.CONSENT_MEMORY_COPY_SHA256 },
      );
    },
  },
  {
    row: 'P0 box 2: a flag that changes after the first read, before any choice, reads the copies again',
    check: async (on) => {
      const api = makeApi({ getRomanConsent: ledger(true) });
      const r = await toP0(api, false);
      await waitFor(() => expect(r.paragraph()).toBe(B_V7));
      await r.rerender(flow(api, on));
      await waitFor(() => expect(r.paragraph()).toBe(on ? B_V9 : B_V7));
      expect(api.getRomanConsent.mock.calls).toEqual(on ? [[{ crisis: false }], [{ crisis: true }]] : [[{ crisis: false }]]);
    },
  },
  {
    row: 'Settings > Roman and AI: asks by the flag and shows the text the server answered with',
    check: async (on) => {
      const getStatus = ledger(false);
      const r = await settings(on, getStatus);
      await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
      expect(getStatus).toHaveBeenCalledWith({ crisis: on });
      expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(on ? B_V8 : B_V6);
    },
  },
  {
    row: 'Settings > Roman and AI, a live pre-57c grant: the exception it adds (paragraph, memory-on confirmation) is followed by the sentence',
    check: async (on) => {
      const v4 = live('client-ai-v4', {
        copy: copyOf('client-ai-v4', B_V4, copy.AI_CONSENT_PRE57C_COPY_SHA256),
        memory_on: true,
        memory_copy: copyOf('client-ai-v5', B_V5, copy.AI_CONSENT_PRE57C_MEMORY_COPY_SHA256),
      });
      const r = await settings(on, jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: v4 })));
      await waitFor(() => r.getByTestId('roman-ai-allowed'));
      expect(r.getByTestId('roman-ai-paragraph').props.children).toBe(on ? B_V8 : B_V6);
      await fireEvent(r.getByTestId('roman-ai-memory-switch'), 'valueChange', true);
      const alerts = (Alert.alert as jest.Mock).mock.calls;
      expect(alerts[alerts.length - 1][1]).toBe(on ? B_V9 : B_V7);
    },
  },
  {
    row: 'AI consent sheet: asks by the flag, shows the server text and grants it',
    check: async (on) => {
      const grantRoman = jest.fn(async (_b: unknown): Promise<AiConsentOutcome> => ({ kind: 'ok', status: live(on ? 'client-ai-v8' : 'client-ai-v6') }));
      const api = { getStatus: ledger(false), grantRoman };
      const onGranted = jest.fn();
      const r = await render(withFlag(on, <AiConsentSheet visible onGranted={onGranted} onClose={jest.fn()} api={api} sessionUserId={() => 'u1'} testID="s" />));
      await waitFor(() => r.getByTestId('s-allow'));
      expect(api.getStatus).toHaveBeenCalledWith({ crisis: on });
      expect(r.getByTestId('s-paragraph').props.children).toBe(on ? B_V8 : B_V6);
      await fireEvent.press(r.getByTestId('s-allow'));
      await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
      expect(grantRoman.mock.calls[0][0]).toMatchObject(
        on ? { version: 'client-ai-v8', copy_sha256: PIN.v8 } : { version: 'client-ai-v6', copy_sha256: copy.AI_CONSENT_COPY_SHA256 },
      );
    },
  },
  {
    row: 'Your conversations with Roman intro and Trust & Privacy Roman line: once, right after the exception (rendered: romanCrisisSentence.test)',
    check: (on) => {
      for (const text of [ROMAN_CHATS_COPY.intro, trustRomanLine({ kind: 'unread' })]) {
        expect(clientPrivacyText(withCrisisSentence(text, on), false)).toBe(on ? text.replace(B_EXCEPTION, `${B_EXCEPTION} ${B_TOLD}`) : text);
      }
      expect(source('screens/settings/RomanConversationsScreen.tsx')).toContain('{clientPrivacyText(crisisText(ROMAN_CHATS_COPY.intro))}');
      expect(source('screens/TrustCenterScreen.tsx')).toContain('<BulletItem text={crisisText(trustRomanLine(coachView))} />');
    },
  },
  {
    row: 'older grants and P0 records keep their own texts and stay current: nobody is asked again',
    check: (on) => {
      for (const text of [B_V6, B_V7, B_V8, B_V9]) expect(withSafetyException(text, on)).toBe(text);
      for (const n of [4, 5, 6, 7, 8, 9]) expect(isLiveRomanGrant(live(`client-ai-v${n}`))).toBe(true);
      expect(romanGrantBody(null, romanFamilyOf(live('client-ai-v8')))).toMatchObject({ version: 'client-ai-v8', copy_sha256: PIN.v8 });
      expect(romanFamilyOf(live('client-ai-v9'))).toBe(romanFamily(false, true));
      for (const n of [7, 8, 9, 10]) {
        const p0 = { agreed: true, copy_version: `consult-consent-v${n}`, agreed_at: NOW.toISOString(), text_sha256: 'a'.repeat(64) };
        expect(isConsentAnswerCurrent(p0 as never)).toBe(true);
      }
    },
  },
  {
    row: 'a client with no coach and a coach account never ask for or see the crisis sentence',
    check: async (on) => {
      expect(copy.consentScreenCopy(true, on)).toMatchObject({ aiParagraph: B_V6, version: 'consult-consent-v7-coach-free' });
      const api = makeApi({ getRomanConsent: ledger(true) });
      const r = await toP0(api, on, true);
      await waitFor(() => expect(r.paragraph()).toBe(B_V7));
      expect(api.getRomanConsent).toHaveBeenCalledWith({ crisis: false });
      mockUser = { id: 'u1' };
      const sheet = { getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'unavailable', status: 503 })), grantRoman: jest.fn() };
      await render(withFlag(on, <AiConsentSheet visible onGranted={jest.fn()} onClose={jest.fn()} api={sheet} sessionUserId={() => 'u1'} />));
      await waitFor(() => expect(sheet.getStatus).toHaveBeenCalledWith({ coachFree: true }));
      const getStatus = ledger(false);
      expect((await settings(on, getStatus)).getByTestId('roman-ai-no-access')).toBeTruthy();
      expect(getStatus).not.toHaveBeenCalled();
      // A coach account never reaches these three: Settings > Roman and AI is a client route, the sheet opens for a
      // client audience only, and the consultation is the client's (Trust & Privacy and chats: romanCrisisSentence.test).
      expect(source('navigation/CoachNavigator.tsx')).not.toMatch(/RomanAiConsent|ConsultationFlow|ConsultationOnboarding/);
      expect(source('components/ai/AiRefusalNotice.tsx')).toContain("refusal.kind === 'consent_required' && audience === 'client' ? (");
      expect(source('components/roman/RomanConsentGate.tsx')).toContain("if (surface !== 'client') return null;");
    },
  },
  {
    row: 'the list is complete: one literal each, and every file that composes the exception or reads the ledger is a row above',
    check: () => {
      expect(filesWith(/sees the message that prompted it/)).toEqual(['lib/romanCrisisSentence.ts', 'screens/settings/romanChatsCopy.ts', 'screens/trustCenterSharing.ts']);
      expect(filesWith(/your coach is told that it happened/)).toEqual(['lib/romanCrisisSentence.ts']);
      expect(
        filesWith(/ROMAN_SAFETY_EXCEPTION|AI_CONSENT_SAFETY_EXCEPTION|withSafetyException\(|AI_CONSENT_PARAGRAPH\b|ROMAN_CHATS_COPY\.intro|trustRomanLine\(|consentScreenCopy\(/),
      ).toEqual([
        'lib/ai/aiCoachless.ts',
        'lib/consultation/aiConsent.ts',
        'lib/consultation/copy.ts',
        'lib/romanCrisisSentence.ts',
        'screens/TrustCenterScreen.tsx',
        'screens/consultation/QuestionScreen.tsx',
        'screens/settings/RomanAiConsentScreen.tsx',
        'screens/settings/RomanConversationsScreen.tsx',
        'screens/trustCenterSharing.ts',
      ]);
      // Ledger readers: the three that show its text ask by the flag; the gate and the join offer read only liveness
      // (a live v8 / v9 grant reads its own copies under any ask) and open the sheet; the drain only withdraws.
      expect(filesWith(/api\/aiConsentApi'/)).toEqual([
        'components/ai/AiConsentSheet.tsx',
        'components/ai/RomanJoinOfferHost.tsx',
        'components/roman/RomanConsentGate.tsx',
        'hooks/useAiWithdrawalDrain.ts',
        'lib/consultation/aiConsent.ts',
        'screens/consultation/ConsultationFlow.tsx',
        'screens/consultation/QuestionScreen.tsx',
        'screens/settings/RomanAiConsentScreen.tsx',
      ]);
      for (const host of ['components/ai/RomanJoinOfferHost.tsx', 'components/roman/RomanConsentGate.tsx']) {
        expect(source(host)).toMatch(/isLiveRomanGrant\(out\.status\)[\s\S]*<AiConsentSheet/);
      }
    },
  },
];

describe('the crisis sentence in the consent stack (CONSENT-CRISIS)', () => {
  beforeEach(async () => {
    mockUser = { id: 'u1', coach_id: 'coach-1' };
    resetAiLedgerWritesForTests();
    await resetStores();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => (Alert.alert as jest.Mock).mockRestore());

  it.each(ROWS.flatMap((r) => [false, true].map((on) => ({ ...r, on }))))('$row (roman_crisis_alert $on)', async ({ check, on }) => {
    await check(on);
  });
});
