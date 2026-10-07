/**
 * Coachless Home (A1-COACHLESS): banner, featured coach, code sheet with live
 * validation and an idempotent join, welcome moment, hand-off to the Day 1
 * plan sheet, and the scripted Roman card. The HTTP layer (services/api) is
 * mocked, so every test proves component -> coachlessApi -> exact route.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
let mockFlagOn = true;
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { coachless_home: mockFlagOn } }),
}));
let mockUser: { id: string; coach_id?: string } | null = { id: 'client-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
const mockPatch = jest.fn(async (_patch: unknown) => undefined);
jest.mock('../../../lib/userCache', () => ({ patchUserCache: (p: unknown) => mockPatch(p), readUserCacheSync: () => null }));
let mockIosHidden = false;
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => mockIosHidden }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../PackageSelectionSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (p: { initialPackageId?: string | null }) => (
      <Text testID="plan-sheet">{`plan sheet ${p.initialPackageId ?? 'none'}`}</Text>
    ),
  };
});

import CoachlessHomeSlot from '../CoachlessHomeSlot';
import { coachlessFailureOf, COACHLESS_CODES } from '../../../api/coachlessApi';
import { refusalLine } from '../coachlessCopy';

const PKG = {
  id: 'pkg-49',
  name: 'Monthly coaching',
  description: null,
  amount_cents: 4900,
  currency: 'usd',
  billing_type: 'recurring',
  interval: 'month',
  interval_count: 1,
};
const COACH = { id: 'coach-1', name: 'Alex Rivera', photo_url: null, business_name: 'Rivera Strength', bio: null };
const OFFER = 'Offer text from the owner config.';
const PITCH = 'Pitch text from the owner config. Interested?';

function homeAccepting() {
  return {
    eligible: true,
    coach_attached: false,
    banner: { title: 'Banner title from the server', offer_text: OFFER, code: 'GP-TOP' },
    roman_card: { text: PITCH, code: 'GP-TOP' },
    roman_card_hidden_reason: null,
    featured_coach: { name: COACH.name, photo_url: null, business_name: COACH.business_name, package: PKG },
  };
}

function redeemOk(over: Record<string, unknown> = {}) {
  return {
    status: 'attached',
    already_attached: false,
    coach: COACH,
    next: { featured_package: PKG, packages_available: 2 },
    grant: null,
    replayed: false,
    ...over,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function routePost(handlers: Record<string, (body: unknown, cfg: unknown) => unknown>) {
  mockPost.mockImplementation(async (url: string, body: unknown, cfg: unknown) => {
    const h = handlers[url];
    if (!h) return { data: { recorded: true, visible: true } };
    return h(body, cfg);
  });
}

async function renderSlot() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={qc}>
      <CoachlessHomeSlot />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockNavigate.mockReset();
  mockPatch.mockClear();
  mockFlagOn = true;
  mockIosHidden = false;
  mockUser = { id: 'client-1' };
  mockGet.mockResolvedValue({ data: homeAccepting() });
});

describe('CoachlessHomeSlot gate', () => {
  it('renders nothing and calls nothing while the server flag is off', async () => {
    mockFlagOn = false;
    await renderSlot();
    expect(screen.queryByTestId('coachless-banner')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('renders nothing for a client who already has a coach', async () => {
    mockUser = { id: 'client-1', coach_id: 'coach-9' };
    await renderSlot();
    expect(screen.queryByTestId('coachless-banner')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('renders nothing when the server says not eligible or the kill switch answers 404', async () => {
    mockGet.mockResolvedValueOnce({ data: { ...homeAccepting(), eligible: false, banner: null, roman_card: null } });
    await renderSlot();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/coachless/home', expect.anything()));
    expect(screen.queryByTestId('coachless-banner')).toBeNull();

    mockGet.mockRejectedValueOnce({ response: { status: 404, data: { code: 'coachless_disabled' } } });
    await renderSlot();
    expect(screen.queryByTestId('coachless-banner')).toBeNull();
  });
});

describe('CoachlessHomeSlot banner and story', () => {
  it('shows the server banner, offer and featured coach; Use code -> live check -> Join -> welcome -> plan sheet', async () => {
    routePost({
      '/coachless/coach-code/check': () => ({ data: { valid: true, coach: COACH } }),
      '/coachless/coach-code/redeem': () => ({ data: redeemOk() }),
    });
    await renderSlot();
    expect(await screen.findByText('Banner title from the server')).toBeTruthy();
    expect(screen.getByText(OFFER)).toBeTruthy();
    expect(screen.getByTestId('coachless-featured-coach')).toBeTruthy();
    expect(screen.getByText('Monthly coaching, $49.00 a month')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('coachless-use-code'));
    expect(screen.getByTestId('coach-code-input').props.value).toBe('GP-TOP');
    expect(await screen.findByText('Coach: Alex Rivera', {}, { timeout: 2000 })).toBeTruthy();
    expect(mockPost).toHaveBeenCalledWith('/coachless/coach-code/check', { code: 'GP-TOP' }, expect.anything());

    await fireEvent.press(screen.getByTestId('coach-code-join'));
    expect(await screen.findByText('Alex Rivera is now your coach.')).toBeTruthy();
    const redeem = mockPost.mock.calls.find((c) => c[0] === '/coachless/coach-code/redeem');
    expect(redeem?.[1]).toEqual({ code: 'GP-TOP' });
    expect(redeem?.[2].headers['Idempotency-Key']).toMatch(UUID);
    expect(mockPatch).toHaveBeenCalledWith({ coach_id: 'coach-1' });
    expect(screen.getByText('Next, start the plan: Monthly coaching, $49.00 a month.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('coach-code-next-cta'));
    expect(await screen.findByText('plan sheet pkg-49', {}, { timeout: 2000 })).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled(); // Android: the Day 1 sheet, not a navigation
  });

  it('iOS (non-P2P purchases hidden): Choose a plan opens the labelled 1:1 coaching screen, never the plan sheet', async () => {
    mockIosHidden = true;
    routePost({
      '/coachless/coach-code/check': () => ({ data: { valid: true, coach: COACH } }),
      '/coachless/coach-code/redeem': () => ({ data: redeemOk() }),
    });
    await renderSlot();
    await fireEvent.press(await screen.findByTestId('coachless-use-code'));
    await fireEvent.press(screen.getByTestId('coach-code-join'));
    expect(await screen.findByText('Alex Rivera is now your coach.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('coach-code-next-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'ClientPackages' });
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByTestId('plan-sheet')).toBeNull();
  });

  it('reuses the Idempotency-Key when Join is retried for the same code, and uses a new one for a new code', async () => {
    const keys: string[] = [];
    let fail = true;
    routePost({
      '/coachless/coach-code/check': () => ({ data: { valid: true, coach: COACH } }),
      '/coachless/coach-code/redeem': (_b, cfg) => {
        keys.push((cfg as { headers: Record<string, string> }).headers['Idempotency-Key']);
        if (fail) return Promise.reject({ message: 'Network Error' });
        return { data: redeemOk() };
      },
    });
    await renderSlot();
    await fireEvent.press(await screen.findByTestId('coachless-enter-code'));
    expect(screen.getByTestId('coach-code-input').props.value).toBe('');
    await fireEvent.changeText(screen.getByTestId('coach-code-input'), 'gp-one');
    await fireEvent.press(screen.getByTestId('coach-code-join'));
    expect(await screen.findByText(refusalLine({ code: 'network', status: 0, requestId: null }))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('coach-code-join'));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);

    await fireEvent.changeText(screen.getByTestId('coach-code-input'), 'GP-TWO');
    fail = false;
    await fireEvent.press(screen.getByTestId('coach-code-join'));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[2]).toMatch(UUID);
  });

  it('shows the specific refusal for a failed check and for a refused join', async () => {
    routePost({
      '/coachless/coach-code/check': () => ({ data: { valid: false, code: 'coach_not_accepting' } }),
      '/coachless/coach-code/redeem': () =>
        Promise.reject({ response: { status: 410, data: { code: 'code_expired', request_id: 'req-1' } } }),
    });
    await renderSlot();
    await fireEvent.press(await screen.findByTestId('coachless-use-code'));
    expect(
      await screen.findByText(refusalLine({ code: 'coach_not_accepting', status: 200, requestId: null }), {}, { timeout: 2000 }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('coach-code-join'));
    expect(await screen.findByText('That code has expired. Ask the coach for a new one.')).toBeTruthy();
  });

  it('a code that grants an active plan ends on Done; a coach with no plans leads to the coach thread', async () => {
    let n = 0;
    routePost({
      '/coachless/coach-code/check': () => ({ data: { valid: true, coach: COACH } }),
      '/coachless/coach-code/redeem': () => {
        n += 1;
        return n === 1
          ? { data: redeemOk({ grant: { status: 'created', purchase_id: 'p1', package_id: 'pkg-c' } }) }
          : { data: redeemOk({ next: { featured_package: null, packages_available: 0 } }) };
      },
    });
    await renderSlot();
    await fireEvent.press(await screen.findByTestId('coachless-use-code'));
    await fireEvent.press(screen.getByTestId('coach-code-join'));
    expect(await screen.findByText('Your plan with Alex Rivera is active.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('coach-code-next-cta'));
    expect(screen.queryByTestId('coach-code-sheet')).toBeNull();

    await fireEvent.press(screen.getByTestId('coachless-use-code'));
    await fireEvent.press(screen.getByTestId('coach-code-join'));
    expect(await screen.findByText('Message Alex Rivera')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('coach-code-next-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Messages');
  });

  it('a code whose free plan waits for consent never leads to paying', async () => {
    routePost({
      '/coachless/coach-code/check': () => ({ data: { valid: true, coach: COACH } }),
      '/coachless/coach-code/redeem': () => ({
        data: redeemOk({ grant: { status: 'pending_consent', purchase_id: 'p2', package_id: 'pkg-c' } }),
      }),
    });
    await renderSlot();
    await fireEvent.press(await screen.findByTestId('coachless-use-code'));
    await fireEvent.press(screen.getByTestId('coach-code-join'));
    expect(await screen.findByText(/This code includes a plan with Alex Rivera/)).toBeTruthy();
    expect(screen.queryByText('Choose a plan')).toBeNull();
    await fireEvent.press(screen.getByTestId('coach-code-next-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Messages');
    expect(screen.queryByTestId('plan-sheet')).toBeNull();
  });

  it('while the featured coach is not accepting: no offer, no featured coach, no Roman card, only Enter a coach code', async () => {
    mockGet.mockResolvedValue({
      data: {
        ...homeAccepting(),
        banner: { title: 'Banner title from the server', offer_text: null, code: null },
        roman_card: null,
        roman_card_hidden_reason: 'not_accepting',
        featured_coach: null,
      },
    });
    await renderSlot();
    expect(await screen.findByText('Banner title from the server')).toBeTruthy();
    expect(screen.queryByTestId('coachless-offer')).toBeNull();
    expect(screen.queryByTestId('coachless-use-code')).toBeNull();
    expect(screen.queryByTestId('coachless-roman-card')).toBeNull();
    expect(screen.getByText('Enter a coach code')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalledWith('/coachless/roman-card/seen', expect.anything(), expect.anything());
  });
});

describe('CoachlessHomeSlot Roman card', () => {
  it('shows the server pitch, records one impression, opens the sheet with the code, and persists Not now', async () => {
    routePost({});
    await renderSlot();
    expect(await screen.findByText(PITCH)).toBeTruthy();
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/coachless/roman-card/seen', {}, expect.anything()),
    );
    expect(mockPost.mock.calls.filter((c) => c[0] === '/coachless/roman-card/seen')).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('coachless-roman-yes'));
    expect(screen.getByTestId('coach-code-input').props.value).toBe('GP-TOP');
    await fireEvent.press(screen.getByTestId('coach-code-cancel'));

    await fireEvent.press(screen.getByTestId('coachless-roman-not-now'));
    expect(screen.queryByTestId('coachless-roman-card')).toBeNull();
    expect(mockPost).toHaveBeenCalledWith('/coachless/roman-card/not-now', {}, expect.anything());
  });
});

describe('coachless refusal copy', () => {
  it('maps every server code and the transport cases to specific copy', () => {
    for (const code of COACHLESS_CODES) {
      const f = coachlessFailureOf({ response: { status: 409, data: { code } } });
      expect(f.code).toBe(code);
      expect(refusalLine(f).length).toBeGreaterThan(20);
    }
    expect(coachlessFailureOf({ message: 'Network Error' }).code).toBe('network');
    expect(coachlessFailureOf({ response: { status: 429, data: {} } }).code).toBe('rate_limited');
    expect(coachlessFailureOf({ response: { status: 400, data: { message: ['code must match'] } } }).code).toBe(
      'bad_format',
    );
    expect(
      refusalLine(coachlessFailureOf({ response: { status: 500, data: { code: 'redemption_failed', request_id: 'req-9' } } })),
    ).toContain('reference req-9');
  });
});
