/**
 * COACH-AI-CONSENT (owner ruling op 2): a coach's own Roman grant in every state (never asked,
 * declined, granted, withdrawn, the server's typed refusal) on the one-time sheet, the Roman
 * screen, the Settings switch and AI refusals; the pinned words, their sha256 and the routes.
 */
import React, { useContext } from 'react';
import { Text } from 'react-native';
import { createHash } from 'crypto';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
let mockUser: { id: string; role: string } | null = { id: 'coach-1', role: 'coach' };
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => mockUser }));
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: () => mockGoBack(), addListener: () => () => undefined }),
}));

import CoachAiConsentHost from '../CoachAiConsentHost';
import AiRefusalNotice from '../AiRefusalNotice';
import RomanConsentGate, { RomanCoachOffContext } from '../../roman/RomanConsentGate';
import { CoachRomanSwitch } from '../../../screens/coach/settings/CoachRomanSwitch';
import { coachAiConsentApi, markCoachAskedAtSignUp, parseCoachAiConsentStatus, type CoachAiConsentState } from '../../../api/coachAiConsentApi';
import { COACH_AI_CONSENT_COPY as COPY, COACH_AI_CONSENT_COPY_SHA256, COACH_AI_OFF_VERSIONS } from '../../../lib/ai/coachAiConsentCopy';
import { aiRefusalCopy, aiRefusalFromHttp, aiRefusalFromStreamCode } from '../../../lib/ai/aiRefusal';
import { HapticService } from '../../../ui/haptics/haptics.service';
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
    expect(COPY.off).toBe(COACH_AI_OFF_VERSIONS.A);
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

  it('maps the typed refusal (HTTP and in-stream) to CAC-5, apart from a client refusal', () => {
    const coach = { kind: 'coach_consent_required' };
    expect(aiRefusalFromHttp(403, { code: 'coach_ai_consent_required', message: 'Turn on Roman' })).toEqual(coach);
    expect(aiRefusalFromStreamCode({ code: 'coach_ai_consent_required', message: '' }, null)).toEqual(coach);
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

function Room() {
  const off = useContext(RomanCoachOffContext);
  return <Text onPress={() => off?.()}>room</Text>;
}

describe('the coach Roman screen', () => {
  it.each(OFF)('shows CAC-5 for %s; its button opens the request and Allow opens the room', async (state) => {
    const api = makeApi(state);
    const r = await render(<RomanConsentGate surface="coach" coachApi={api}><Room /></RomanConsentGate>);
    expect(await r.findByText('Roman is off')).toBeTruthy();
    expect(r.getByText(COPY.off.body)).toBeTruthy();
    expect(r.queryByText('room')).toBeNull();
    await fireEvent.press(r.getByText(COPY.off.button));
    await fireEvent.press(await r.findByText(COPY.allow));
    expect(await r.findByText('room')).toBeTruthy();
    expect(api.grant).toHaveBeenCalledTimes(1);
  });

  it('a granted coach gets the room; the typed refusal turns it into CAC-5', async () => {
    const api = makeApi('granted');
    const r = await render(<RomanConsentGate surface="coach" coachApi={api}><Room /></RomanConsentGate>);
    await fireEvent.press(await r.findByText('room'));
    expect(await r.findByText('Roman is off')).toBeTruthy();
  });

  it('a coach AI refusal elsewhere offers the same request, then retries', async () => {
    const grant = jest.spyOn(coachAiConsentApi, 'grant').mockResolvedValue(ok('granted'));
    const onRetry = jest.fn();
    const r = await render(<AiRefusalNotice refusal={{ kind: 'coach_consent_required' }} audience="coach" surface="draft" onRetry={onRetry} />);
    expect(r.getByText('Roman is off')).toBeTruthy();
    await fireEvent.press(r.getByText(COPY.off.button));
    await fireEvent.press(await r.findByText(COPY.allow));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(grant).toHaveBeenCalledTimes(1);
  });
});

describe('Settings > Privacy switch', () => {
  const colors = new Proxy({}, { get: () => '#000000' }) as never;
  const styles = {} as never;

  it('on for a grant; off withdraws at once', async () => {
    const api = makeApi('granted');
    const r = await render(<CoachRomanSwitch colors={colors} styles={styles} api={api} />);
    const sw = await r.findByTestId('coach-settings-roman-ai-switch');
    expect(sw.props.value).toBe(true);
    expect(r.getByText(COPY.switchHint)).toBeTruthy();
    await fireEvent(sw, 'valueChange', false);
    await waitFor(() => expect(r.getByTestId('coach-settings-roman-ai-switch').props.value).toBe(false));
    expect(api.withdraw).toHaveBeenCalledTimes(1);
  });

  it('off after a withdrawal; on opens the request and Allow turns it on', async () => {
    const api = makeApi('withdrawn');
    const r = await render(<CoachRomanSwitch colors={colors} styles={styles} api={api} />);
    await fireEvent(await r.findByTestId('coach-settings-roman-ai-switch'), 'valueChange', true);
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
