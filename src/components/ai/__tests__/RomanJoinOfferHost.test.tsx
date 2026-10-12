/**
 * Owner 62y2 (2)-(3): right after a client with no coach joins a coach, the existing AiConsentSheet
 * opens once with the coached Roman paragraph and box. Allow records the coached version, Roman is on
 * at once and a success haptic plays; Not now keeps Roman off and the sheet never comes back by itself.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RomanJoinOfferHost from '../RomanJoinOfferHost';
import { AI_CONSENT_SHEET_COPY, type AiConsentSheetApi } from '../AiConsentSheet';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { isLiveRomanGrant, resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
} from '../../../lib/consultation/copy';
import {
  noteCachedUser,
  resetRomanJoinOfferForTests,
  romanJoinOfferDue,
  ROMAN_JOIN_OFFER_KEY_PREFIX,
  useRomanJoinOfferHold,
} from '../../../lib/romanJoinOffer';
import { HapticService } from '../../../ui/haptics/haptics.service';
import type { CurrentUser } from '../../../hooks/useCurrentUser';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../join/JoinPackageHost', () => ({ JOIN_SHEET_HANDOFF_MS: 10 }));
let mockUser: CurrentUser | null = null;
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => mockUser }));

const NO_COACH: CurrentUser = { id: 'user-a', email: '', role: 'student', profile: { onboardingCompleted: true } };
const COACHED: CurrentUser = { ...NO_COACH, coach_id: 'coach-1' };
const part = (text: string) => ({ text, sha256: 'a'.repeat(64) });
function status(over: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: 'client-ai-v6',
    needs_reconsent: false,
    copy: { version: 'client-ai-v6', paragraph: part(AI_CONSENT_PARAGRAPH), box_label: part(AI_CONSENT_CHECKBOX_LABEL), sha256: AI_CONSENT_COPY_SHA256 },
    ...over,
  };
}
const LIVE = status({ granted: true, state: 'granted', version: 'client-ai-v6', granted_at: '2026-10-12T10:00:00Z' });

function makeApi(first: AiConsentStatusResponse = status()) {
  const api = {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: first })),
    grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE })),
  };
  return api as typeof api & AiConsentSheetApi;
}
const mark = () => AsyncStorage.getItem(`${ROMAN_JOIN_OFFER_KEY_PREFIX}user-a`);

/** The user cache saw the client without a coach, then with one (any join path). */
async function join() {
  mockUser = COACHED;
  noteCachedUser(NO_COACH, COACHED);
  await waitFor(async () => expect(await mark()).toBe('due'));
}

beforeEach(async () => {
  resetRomanJoinOfferForTests();
  resetAiLedgerWritesForTests();
  await AsyncStorage.clear();
  mockUser = null;
});

describe('RomanJoinOfferHost (owner 62y2)', () => {
  it('opens the existing sheet as "Roman and AI" with the coached paragraph and box, "Allow" and "Not now", after a join', async () => {
    const api = makeApi();
    const r = await render(<RomanJoinOfferHost api={api} />);
    expect(r.queryByTestId('roman-join-offer')).toBeNull();
    await join();
    await waitFor(() => expect(r.getByTestId('roman-join-offer-allow')).toBeTruthy());
    expect(r.getByTestId('roman-join-offer-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    expect(r.getByText(AI_CONSENT_CHECKBOX_LABEL)).toBeTruthy();
    expect(r.getByTestId('roman-join-offer-not-now')).toBeTruthy();
    expect(api.getStatus).toHaveBeenCalledWith();
    // Owner 62y2 option 1: titled "Roman and AI", with "Allow" and "Not now".
    expect(AI_CONSENT_SHEET_COPY.afterJoinTitle).toBe('Roman and AI');
    expect(AI_CONSENT_SHEET_COPY.afterJoinAllow).toBe('Allow');
    expect(AI_CONSENT_SHEET_COPY.notNow).toBe('Not now');
    expect(r.getAllByText('Roman and AI').length).toBeGreaterThan(0);
    expect(r.getByText('Allow')).toBeTruthy();
    expect(r.getByText('Not now')).toBeTruthy();
    expect(r.queryByText(AI_CONSENT_SHEET_COPY.title)).toBeNull();
  });

  it('Allow records client-ai-v6, Roman is on at once, a success haptic plays, and it is done', async () => {
    const success = jest.spyOn(HapticService, 'success');
    const api = makeApi();
    const r = await render(<RomanJoinOfferHost api={api} />);
    await join();
    await waitFor(() => r.getByTestId('roman-join-offer-allow'));
    await fireEvent.press(r.getByTestId('roman-join-offer-allow'));
    await waitFor(() => expect(r.queryByTestId('roman-join-offer')).toBeNull());
    expect(api.grantRoman).toHaveBeenCalledWith(expect.objectContaining({ version: 'client-ai-v6', copy_sha256: AI_CONSENT_COPY_SHA256 }));
    const out = await api.grantRoman.mock.results[0].value;
    expect(out.kind === 'ok' && isLiveRomanGrant(out.status)).toBe(true);
    expect(success).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect(await mark()).toBe('done'));
    success.mockRestore();
  });

  it('Not now records nothing, keeps Roman off, and the sheet never comes back by itself', async () => {
    const success = jest.spyOn(HapticService, 'success');
    const api = makeApi();
    const r = await render(<RomanJoinOfferHost api={api} />);
    await join();
    await waitFor(() => r.getByTestId('roman-join-offer-not-now'));
    await fireEvent.press(r.getByTestId('roman-join-offer-not-now'));
    await waitFor(() => expect(r.queryByTestId('roman-join-offer')).toBeNull());
    expect(api.grantRoman).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    await waitFor(async () => expect(await mark()).toBe('done'));
    const reads = api.getStatus.mock.calls.length;
    // A later change (another join, a sign-in, a new mount) does not bring it back.
    noteCachedUser(NO_COACH, COACHED);
    const again = await render(<RomanJoinOfferHost api={api} />);
    await act(() => new Promise((res) => setTimeout(res, 100)));
    expect(again.queryByTestId('roman-join-offer')).toBeNull();
    expect(r.queryByTestId('roman-join-offer')).toBeNull();
    expect(api.getStatus).toHaveBeenCalledTimes(reads);
    success.mockRestore();
  });

  it('a client whose Roman grant is already live is not asked; the offer is done', async () => {
    const api = makeApi(LIVE);
    const r = await render(<RomanJoinOfferHost api={api} />);
    mockUser = COACHED;
    noteCachedUser(NO_COACH, COACHED);
    await waitFor(async () => expect(await mark()).toBe('done'));
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(r.queryByTestId('roman-join-offer')).toBeNull();
  });

  it.each([
    ['an error', { kind: 'error', status: 500 } as AiConsentOutcome],
    ['no reply', { kind: 'error', status: null } as AiConsentOutcome],
  ])('when the first read after the join fails (%s), the sheet still opens; Try again, then Allow, records the grant', async (_l, failed) => {
    const success = jest.spyOn(HapticService, 'success');
    const api = makeApi();
    api.getStatus.mockResolvedValueOnce(failed).mockResolvedValueOnce(failed);
    const r = await render(<RomanJoinOfferHost api={api} />);
    await join();
    await waitFor(() => expect(r.getByTestId('roman-join-offer-try-again')).toBeTruthy());
    expect(await mark()).toBe('due');
    await fireEvent.press(r.getByTestId('roman-join-offer-try-again'));
    await waitFor(() => r.getByTestId('roman-join-offer-allow'));
    await fireEvent.press(r.getByTestId('roman-join-offer-allow'));
    await waitFor(() => expect(r.queryByTestId('roman-join-offer')).toBeNull());
    expect(api.grantRoman).toHaveBeenCalledWith(expect.objectContaining({ version: 'client-ai-v6', copy_sha256: AI_CONSENT_COPY_SHA256 }));
    expect(success).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect(await mark()).toBe('done'));
    success.mockRestore();
  });

  it('a client with no coach is never shown it, and the server is not asked', async () => {
    const api = makeApi();
    mockUser = NO_COACH;
    noteCachedUser(null, NO_COACH);
    const r = await render(<RomanJoinOfferHost api={api} />);
    await act(() => new Promise((res) => setTimeout(res, 100)));
    expect(r.queryByTestId('roman-join-offer')).toBeNull();
    expect(api.getStatus).not.toHaveBeenCalled();
  });

  it('waits while the coach-code or package sheet is on screen, then opens', async () => {
    function JoinSheet({ open }: { open: boolean }) {
      useRomanJoinOfferHold(open);
      return null;
    }
    const api = makeApi();
    const r = await render(
      <>
        <JoinSheet open />
        <RomanJoinOfferHost api={api} />
      </>,
    );
    await join();
    await act(() => new Promise((res) => setTimeout(res, 100)));
    expect(romanJoinOfferDue()).toBeNull();
    expect(r.queryByTestId('roman-join-offer')).toBeNull();
    expect(api.getStatus).not.toHaveBeenCalled();
    await r.rerender(
      <>
        <JoinSheet open={false} />
        <RomanJoinOfferHost api={api} />
      </>,
    );
    await waitFor(() => expect(r.getByTestId('roman-join-offer-allow')).toBeTruthy());
  });
});
