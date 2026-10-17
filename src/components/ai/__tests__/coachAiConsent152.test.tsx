/**
 * COACH-AI-CONSENT (owner ruling op 2): a coach's own Roman grant in every state (never asked,
 * declined, granted, withdrawn, the server's typed refusal) on the one-time sheet, the Roman
 * screen, the Settings switch and AI refusals; the pinned words, their sha256 and the routes.
 * A refusal in the real coach room keeps the room and the draft; both builder sheets show CAC-5.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { createHash } from 'crypto';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
let mockUser: { id: string; role: string } | null = { id: 'coach-1', role: 'coach' };
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => mockUser }));
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: () => mockGoBack(), addListener: () => () => undefined }),
}));
const mockSend = jest.fn();
jest.mock('../../../api/romanApi', () => ({
  ...jest.requireActual('../../../api/romanApi'),
  openOrResumeSession: async () => ({ id: 's1', surface: 'coach', messageCount: 0 }),
  listMessages: async () => ({ messages: [], nextCursor: null }),
  sendMessage: (...a: unknown[]) => mockSend(...a),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ firstName: 'Bradley' }) }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: (props: object) => require('react').createElement(require('react-native').Text, props),
}));
jest.mock('../../../ui/skeletons/Skeleton', () => ({ Skeleton: () => null }));

import CoachAiConsentHost from '../CoachAiConsentHost';
import AiRefusalNotice, { type AiRefusalNoticeProps } from '../AiRefusalNotice';
import RomanConsentGate from '../../roman/RomanConsentGate';
import RomanChatScreen from '../../../screens/roman/RomanChatScreen';
import AiBuilderSheet from '../../coach/ai-builder/AiBuilderSheet';
import { useAiBuilder } from '../../coach/ai-builder/useAiBuilder';
import WeekAiSheet from '../../coach/ai-entry/WeekAiSheet';
import { RomanApiError } from '../../../api/romanApi';
import { aiBuilderApi, toAiBuilderError, type AiBuilderProposal, type AiBuilderStatus } from '../../../api/aiBuilderApi';
import type { ProgramDay } from '../../../api/programsApi';
import { lightTokens, radius } from '../../../theme/tokens';
import { CoachRomanSwitch } from '../../../screens/coach/settings/CoachRomanSwitch';
import { makeStyles } from '../../../screens/coach/settings/styles';
import { coachAiConsentApi, markCoachAskedAtSignUp, parseCoachAiConsentStatus, type CoachAiConsentOutcome, type CoachAiConsentState } from '../../../api/coachAiConsentApi';
import { ROMAN_LOADING_A11Y_LABEL } from '../../roman/romanVoice';
import { COACH_AI_CONSENT_COPY as COPY, COACH_AI_CONSENT_COPY_SHA256 } from '../../../lib/ai/coachAiConsentCopy';
import { aiRefusalCopy, aiRefusalFromHttp, aiRefusalFromStreamCode, aiRefusalOf } from '../../../lib/ai/aiRefusal';
import { HapticService } from '../../../ui/haptics/haptics.service';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import http from '../../../services/api';

const ok = (state: CoachAiConsentState) => ({ kind: 'ok' as const, status: { state, granted: state === 'granted', asked: state !== 'not_asked' } });
function makeApi(state: CoachAiConsentState) {
  return {
    getStatus: jest.fn(async () => ok(state)),
    grant: jest.fn(async () => ok('granted')),
    decline: jest.fn(async () => ok(state === 'not_asked' ? 'declined' : state)),
    withdraw: jest.fn(async () => ok('withdrawn')),
  };
}
const ASKED: CoachAiConsentState[] = ['declined', 'granted', 'withdrawn'];
const TYPED_403 = Object.assign(new Error('HTTP 403'), { isAxiosError: true, response: { status: 403, data: { code: 'coach_ai_consent_required', message: 'Turn on Roman' } } });
const OFF: CoachAiConsentState[] = ['not_asked', 'declined', 'withdrawn'];

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'coach-1', role: 'coach' };
  markCoachAskedAtSignUp(null);
});

describe('words and contract', () => {
  it('ships the approved words, CAC-5 version A, and the sha256 the server checks', () => {
    expect(COPY).toMatchObject({ title: 'Turn on Roman', allow: 'Allow', notNow: 'Not now', switchLabel: 'Roman (AI by Anthropic)' });
    expect(COPY.switchHint).toBe('Turn off to stop sending what you type to Anthropic.');
    expect(COPY.off).toEqual({ title: 'Roman is off', body: 'Allow Roman to use Anthropic, then you can chat and draft.', button: 'Turn on Roman' });
    const sha = createHash('sha256').update(`${COPY.paragraph}\n\n${COPY.title}`, 'utf8').digest('hex');
    expect(sha).toBe(COACH_AI_CONSENT_COPY_SHA256);
  });

  it('names the copy on grant and Not now, nothing on withdraw, and reads failures like the client routes', async () => {
    const body = { state: 'granted', granted: true, asked: true };
    (http.post as jest.Mock).mockResolvedValue({ data: body });
    (http.delete as jest.Mock).mockResolvedValue({ data: { ...body, state: 'withdrawn', granted: false } });
    (http.get as jest.Mock).mockRejectedValue({ response: { status: 503 } });
    expect(await coachAiConsentApi.grant()).toEqual(ok('granted'));
    await coachAiConsentApi.decline();
    const named = { version: 'coach-ai-v1', copy_sha256: COACH_AI_CONSENT_COPY_SHA256, platform: 'ios' };
    expect((http.post as jest.Mock).mock.calls).toEqual([['/me/ai-consent/coach', named], ['/me/ai-consent/coach/decline', named]]);
    expect(await coachAiConsentApi.withdraw()).toEqual(ok('withdrawn'));
    expect(http.delete).toHaveBeenCalledWith('/me/ai-consent/coach');
    expect(await coachAiConsentApi.getStatus()).toEqual({ kind: 'unavailable', status: 503 });
    expect(parseCoachAiConsentStatus({ state: 'withdrawn', granted: true })).toEqual(ok('withdrawn').status);
    expect(parseCoachAiConsentStatus({ state: 'on', granted: true })).toBeNull();
  });

  // Every coach AI surface (Opus 6225592099 B2) fed the same typed 403 reads it as CAC-5.
  it.each([
    ['Roman chat, HTTP 403', () => aiRefusalFromHttp(403, TYPED_403.response.data)],
    ['Roman chat, in the stream', () => aiRefusalFromStreamCode({ code: 'coach_ai_consent_required', message: '' }, null)],
    ['CoachAiSection', () => aiRefusalOf(TYPED_403)],
    ['AskAiActionSheet', () => aiRefusalOf(TYPED_403)],
    ['WearableInsightPanel', () => aiRefusalOf(TYPED_403)],
    ['CoachCommunityInboxScreen triage', () => aiRefusalOf(TYPED_403)],
    ['workout builder and week Ask AI', () => ({ kind: toAiBuilderError(TYPED_403).code })],
  ])('%s maps the typed refusal to CAC-5', (_, read) => expect(read()).toEqual({ kind: 'coach_consent_required' }));

  it('keeps a client refusal apart and words CAC-5 for the coach', () => {
    expect(aiRefusalFromHttp(403, { code: 'ai_consent_required' })).toEqual({ kind: 'consent_required' });
    expect(aiRefusalCopy({ kind: 'coach_consent_required' }, 'coach', 'draft')).toEqual({ title: 'Roman is off', body: COPY.off.body, referenceLine: null });
  });
});

describe('the one-time sheet over coach Home', () => {
  it('opens for a coach never asked; Allow grants once with a success haptic', async () => {
    const api = makeApi('not_asked');
    const success = jest.spyOn(HapticService, 'success');
    const r = await render(<CoachAiConsentHost api={api} />);
    expect(await r.findByText(COPY.paragraph)).toBeTruthy();
    expect(r.getByRole('header', { name: COPY.title })).toBeTruthy();
    await fireEvent.press(r.getByTestId('coach-ai-consent-once-allow'));
    await waitFor(() => expect(r.queryByText(COPY.paragraph)).toBeNull());
    expect(api.grant).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledTimes(1);
    expect(api.decline).not.toHaveBeenCalled();
  });

  it('Not now records the decline and closes', async () => {
    const api = makeApi('not_asked');
    const r = await render(<CoachAiConsentHost api={api} />);
    await fireEvent.press(await r.findByText(COPY.notNow));
    expect(api.decline).toHaveBeenCalledTimes(1);
    expect(api.grant).not.toHaveBeenCalled();
    expect(r.queryByText(COPY.paragraph)).toBeNull();
  });

  it.each(ASKED)('never opens once the server says %s', async (state) => {
    const api = makeApi(state);
    const r = await render(<CoachAiConsentHost api={api} />);
    await waitFor(() => expect(api.getStatus).toHaveBeenCalledTimes(1));
    expect(r.queryByText(COPY.paragraph)).toBeNull();
  });

  it('asks nothing of a sub-coach or of the account that just saw the sign-up box', async () => {
    const api = makeApi('not_asked');
    mockUser = { id: 'sub-1', role: 'sub_coach' };
    await render(<CoachAiConsentHost api={api} />);
    mockUser = { id: 'coach-1', role: 'coach' };
    markCoachAskedAtSignUp('coach-1');
    await render(<CoachAiConsentHost api={api} />);
    expect(api.getStatus).not.toHaveBeenCalled();
  });
});

describe('the coach Roman screen', () => {
  it.each([
    ['granted', ok('granted')],
    ['off', ok('withdrawn')],
    ['unreadable', { kind: 'unavailable' as const }],
  ])('shows the shared loading state and Back until the first %s status arrives', async (_, outcome) => {
    let resolve!: (out: CoachAiConsentOutcome) => void;
    const api = { ...makeApi('granted'), getStatus: jest.fn(() => new Promise<CoachAiConsentOutcome>((done) => { resolve = done; })) };
    const r = await render(<RomanConsentGate surface="coach" coachApi={api}><Text>room</Text></RomanConsentGate>);
    expect(r.getByRole('progressbar', { name: ROMAN_LOADING_A11Y_LABEL }).props.accessibilityState).toEqual({ busy: true });
    expect(r.queryByText('room')).toBeNull();
    expect(r.queryByText(COPY.off.title)).toBeNull();
    await fireEvent.press(r.getByRole('button', { name: 'Back' }));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(api.grant).not.toHaveBeenCalled();
    await act(async () => resolve(outcome));
    expect(r.queryByTestId('roman-loading-skeleton')).toBeNull();
    expect(r.getByText(outcome.kind === 'ok' && !outcome.status.granted ? COPY.off.title : 'room')).toBeTruthy();
    expect(api.getStatus).toHaveBeenCalledTimes(1);
  });

  it.each(OFF)('shows CAC-5 for %s; its button opens the request and Allow opens the room', async (state) => {
    const api = makeApi(state);
    const r = await render(<RomanConsentGate surface="coach" coachApi={api}><Text>room</Text></RomanConsentGate>);
    expect(await r.findByText('Roman is off')).toBeTruthy();
    expect(r.getByText(COPY.off.body)).toBeTruthy();
    expect(r.queryByText('room')).toBeNull();
    await fireEvent.press(r.getByText(COPY.off.button));
    await fireEvent.press(await r.findByText(COPY.allow));
    expect(await r.findByText('room')).toBeTruthy();
    expect(api.grant).toHaveBeenCalledTimes(1);
  });

  it('a coach AI refusal elsewhere offers the same request, then retries', async () => {
    const grant = jest.spyOn(coachAiConsentApi, 'grant').mockResolvedValue(ok('granted'));
    const onRetry = jest.fn();
    const r = await render(<AiRefusalNotice refusal={{ kind: 'coach_consent_required' }} audience="coach" surface="draft" onRetry={onRetry} />);
    expect(StyleSheet.flatten(r.getByTestId('ai-refusal').props.style).borderRadius).toBe(radius.card);
    expect(r.getByText('Roman is off')).toBeTruthy();
    await fireEvent.press(r.getByText(COPY.off.button));
    await fireEvent.press(await r.findByText(COPY.allow));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(grant).toHaveBeenCalledTimes(1);
  });
});

describe.each([false, true])('refusal corners (compact=%s)', (compact) => {
  it.each<[string, Pick<AiRefusalNoticeProps, 'refusal' | 'audience'>, string[]]>([
    ['coach Roman off', { refusal: { kind: 'coach_consent_required' }, audience: 'coach' }, ['turn-on']],
    ['client AI off', { refusal: { kind: 'consent_required' }, audience: 'client' }, ['allow']],
    ['coach retry', { refusal: { kind: 'consent_required' }, audience: 'coach' }, ['retry']],
    ['service paused', { refusal: { kind: 'egress_blocked', reference: 'ref-12345678', serverMessage: null }, audience: 'coach' }, ['support', 'copy-reference']],
  ])('%s uses the card and button tokens for every action', async (_, props, actions) => {
    const r = await render(<AiRefusalNotice {...props} surface="draft" compact={compact} onRetry={jest.fn()} onContactSupport={jest.fn()} />);
    expect(StyleSheet.flatten(r.getByTestId('ai-refusal').props.style).borderRadius).toBe(radius.card);
    for (const action of actions) {
      expect(StyleSheet.flatten(r.getByTestId(`ai-refusal-${action}`).props.style).borderRadius).toBe(radius.button);
    }
  });
});

describe('Settings > Privacy switch', () => {
  const colors = new Proxy({}, { get: () => '#000000' }) as ThemeColors;
  const styles = makeStyles(colors);

  it('on for a grant; off withdraws at once', async () => {
    const api = makeApi('granted');
    const r = await render(<CoachRomanSwitch colors={colors} styles={styles} api={api} />);
    const sw = await r.findByTestId('coach-settings-roman-ai-switch');
    expect(sw.props.value).toBe(true);
    expect(r.getByTestId('coach-settings-roman-ai-icon').props).toMatchObject({ name: 'shield-checkmark-outline', size: 20, color: colors.textSecondary });
    expect(r.getByTestId('coach-settings-roman-ai-divider').props.style).toEqual(styles.divider);
    expect(r.getByText(COPY.switchHint)).toBeTruthy();
    await fireEvent(sw, 'valueChange', false);
    await waitFor(() => expect(r.getByTestId('coach-settings-roman-ai-switch').props.value).toBe(false));
    expect(api.withdraw).toHaveBeenCalledTimes(1);
  });

  it('off after a withdrawal; a tap on the row opens the request and Allow turns it on', async () => {
    const api = makeApi('withdrawn');
    const r = await render(<CoachRomanSwitch colors={colors} styles={styles} api={api} />);
    await fireEvent.press(await r.findByTestId('coach-settings-roman-ai'));
    expect(api.grant).not.toHaveBeenCalled();
    await fireEvent.press(await r.findByText(COPY.allow));
    await waitFor(() => expect(r.getByTestId('coach-settings-roman-ai-switch').props.value).toBe(true));
  });

  it('a withdrawal that is not saved goes back on and says so', async () => {
    const api = { ...makeApi('granted'), withdraw: jest.fn(async () => ({ kind: 'unavailable' as const, status: 503 as const })) };
    const r = await render(<CoachRomanSwitch colors={colors} styles={styles} api={api} />);
    await fireEvent(await r.findByTestId('coach-settings-roman-ai-switch'), 'valueChange', false);
    expect(await r.findByTestId('coach-settings-roman-ai-failed')).toBeTruthy();
    expect(r.getByTestId('coach-settings-roman-ai-switch').props.value).toBe(true);
  });
});

// Sol 6225557370 B1: the real coach room (first status read failed, so it is open) refused mid-chat.
describe('the coach Roman room keeps the room and the draft through the typed refusal', () => {
  const DRAFT = 'Plan next week for my early group';
  it.each([
    ['HTTP 403, nothing stored', new RomanApiError('aiRefused', 'Roman cannot answer this request.', undefined, aiRefusalFromHttp(403, TYPED_403.response.data) ?? undefined)],
    ['in the stream, turn stored', new RomanApiError('aiRefused', 'Turn on Roman', undefined, aiRefusalFromStreamCode({ code: 'coach_ai_consent_required', message: 'Turn on Roman' }, null) ?? undefined, true)],
  ])('%s: CAC-5 in the room, Not now keeps it, Allow resumes once', async (_, refused) => {
    jest.spyOn(coachAiConsentApi, 'getStatus').mockResolvedValue({ kind: 'unavailable' });
    const decline = jest.spyOn(coachAiConsentApi, 'decline').mockResolvedValue(ok('declined'));
    const grant = jest.spyOn(coachAiConsentApi, 'grant').mockResolvedValue(ok('granted'));
    mockSend.mockReset().mockRejectedValueOnce(refused).mockResolvedValue({ text: 'Here is the week.', messageId: 'a1', interrupted: false });
    const r = await render(<RomanChatScreen surface="coach" />);
    await fireEvent.changeText(await r.findByTestId('roman-composer-input'), DRAFT);
    await fireEvent.press(r.getByTestId('roman-composer-send'));
    expect(await r.findByText('Roman is off')).toBeTruthy();
    const draftKept = () => expect(r.getByTestId('roman-composer-input').props.value).toBe(DRAFT);
    draftKept();
    await fireEvent.press(r.getByTestId('roman-ai-refusal-turn-on'));
    await fireEvent.press(await r.findByTestId('roman-ai-refusal-coach-sheet-not-now'));
    expect(decline).toHaveBeenCalledTimes(1);
    expect(r.queryByTestId('roman-consent-gate-off')).toBeNull();
    draftKept();
    await fireEvent.press(r.getByTestId('roman-ai-refusal-turn-on'));
    await fireEvent.press(await r.findByTestId('roman-ai-refusal-coach-sheet-allow'));
    expect(grant).toHaveBeenCalledTimes(1);
    if (refused.turnStored) {
      // Stored before the refusal: never sent again on its own; the ask-again line, the draft kept.
      expect(await r.findByTestId('roman-ask-again')).toBeTruthy();
      expect(mockSend).toHaveBeenCalledTimes(1);
      draftKept();
    } else {
      await waitFor(() => expect(r.getByTestId('roman-composer-input').props.value).toBe(''));
      expect(mockSend.mock.calls).toEqual([['s1', DRAFT], ['s1', DRAFT]]);
    }
  });
});

// Opus 6225592099 B2 / LS-760 COACH-AI-BUILDER-RECOVERY: both builder sheets show CAC-5, keep the ask, resume after Allow.
describe('workout builder Ask AI', () => {
  const STATUS: AiBuilderStatus = { state: 'on', create: true, edit: true, label: 'AI-suggested, coach-approved', credits: { remaining_pct: 50, resets_at: null } };
  const PROPOSAL: AiBuilderProposal = { draft_id: 'd1', summary: 'Day 1 progressed.', changes: [], dropped: [], context_used: [], screening_flag: false };
  const DAY: ProgramDay = { week_index: 0, day_index: 0, plan_id: 'plan-0', name: 'Push', type: 'strength', duration_estimate_minutes: null, exercise_count: 4, updated_at: '2026-10-16T00:00:00Z' };
  function Builder() {
    const ai = useAiBuilder({ planId: 'plan-0', isBlank: false, prepare: async () => ({ ok: true }), onApplied: () => undefined });
    return <AiBuilderSheet open onClose={() => undefined} ai={ai} isBlank={false} sc={lightTokens} />;
  }
  beforeEach(() => {
    jest.spyOn(aiBuilderApi, 'getStatus').mockResolvedValue(STATUS);
    jest.spyOn(coachAiConsentApi, 'grant').mockResolvedValue(ok('granted'));
  });

  it('the builder sheet: CAC-5 with Turn on Roman, the instruction kept, asked again after Allow', async () => {
    const propose = jest.spyOn(aiBuilderApi, 'propose').mockRejectedValueOnce(TYPED_403).mockResolvedValue(PROPOSAL);
    const r = await render(<Builder />);
    await fireEvent.changeText(await r.findByTestId('ai-builder-input'), 'swap squats');
    await fireEvent.press(r.getByTestId('ai-builder-send'));
    expect(await r.findByText('Roman is off')).toBeTruthy();
    expect(r.queryByTestId('ai-builder-error')).toBeNull();
    expect(r.getByTestId('ai-builder-input').props.value).toBe('swap squats');
    await fireEvent.press(r.getByTestId('ai-builder-roman-off-turn-on'));
    await fireEvent.press(await r.findByTestId('ai-builder-roman-off-coach-sheet-allow'));
    expect(await r.findByTestId('ai-builder-review')).toBeTruthy();
    expect(propose.mock.calls.map((c) => c[0].instruction)).toEqual(['swap squats', 'swap squats']);
    expect(r.queryByTestId('ai-builder-roman-off')).toBeNull();
  });

  it('the week sheet: CAC-5 instead of the error line; after Allow the week is asked again', async () => {
    const propose = jest.spyOn(aiBuilderApi, 'propose').mockRejectedValueOnce(TYPED_403).mockResolvedValue(PROPOSAL);
    const r = await render(<WeekAiSheet action="progress" week={0} days={[DAY]} status={STATUS} onClose={() => undefined} onApplied={() => undefined} />);
    expect(await r.findByText('Roman is off')).toBeTruthy();
    expect(r.queryByTestId('week-ai-error')).toBeNull();
    await fireEvent.press(r.getByTestId('week-ai-roman-off-turn-on'));
    await fireEvent.press(await r.findByTestId('week-ai-roman-off-coach-sheet-allow'));
    expect(await r.findByTestId('week-ai-day-0')).toBeTruthy();
    expect(propose).toHaveBeenCalledTimes(2);
    expect(r.queryByTestId('week-ai-roman-off')).toBeNull();
  });
});
