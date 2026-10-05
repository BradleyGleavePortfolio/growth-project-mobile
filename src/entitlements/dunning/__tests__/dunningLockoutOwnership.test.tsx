/**
 * B-LOCK-118 / B-LOCK2-120 (#353): the lockout belongs to the signed-in
 * account and the mounted screens (B-353-1, B-353-2, including an End my plan
 * confirmation), a reversed payment says R-DISPUTE-PAUSE on every surface
 * (B-353-3 / B-353-6 / B-353-7), no first person in client copy (B-353-3), the
 * overlay is modal for screen readers (B-353-4), and the screens stay
 * truthful against today's production backend (no dunning routes, flag off).
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, isHiddenFromAccessibility, render, waitFor } from '@testing-library/react-native';
import { authEvents } from '../../../utils/authEvents';
import { SUPPORT_EMAIL } from '../../../constants/support';
import type { ClientDunningStatus } from '../dunningApi';
import { dunningLockoutStore } from '../dunningLockoutStore';
import { DunningLockoutProvider, useDunning } from '../DunningLockoutProvider';
import { DunningBanner, bannerCopy } from '../DunningBanner';
import { DunningLockoutScreen, lockoutNextStep, lockoutSummary } from '../DunningLockoutScreen';
import { UpdateCardScreen, endPlanAlertBody, updateCardIntro } from '../UpdateCardScreen';
import { __resetStripeSdkForTests } from '../updateCard';

jest.mock('../../../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../../../theme/tokens').default;
  return {
    useTheme: () => ({ semanticColors: realTokens.lightTokens, tokens: realTokens, colorScheme: 'light' }),
  };
});

const mockCaptureError = jest.fn();
jest.mock('../../../services/sentry', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('../../../services/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

const mockSdk = {
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async (): Promise<Record<string, unknown>> => ({})),
  handleNextAction: jest.fn(async () => ({ paymentIntent: { status: 'Succeeded' } })),
  handleURLCallback: jest.fn(async () => true),
};
jest.mock('@stripe/stripe-react-native', () => mockSdk);

/** Same rule as main's src/lib/ai/__tests__/aiClientCopy.guard.test.ts. */
const FIRST_PERSON = /\b(we|we're|we've|we'll|us|our|ours)\b/i;

const LOCKED: ClientDunningStatus = {
  enabled: true,
  state: 'locked',
  kind: 'payment',
  lock_waived: false,
  purchase_id: 'p1',
  amount_cents: 15000,
  currency: 'usd',
  failed_at: '2026-10-01T15:00:00.000Z',
  lockout_at: '2026-10-11T15:00:00.000Z',
  locked_at: '2026-10-11T15:07:00.000Z',
  day: 10,
  coach_name: 'Avery',
  card_last4: '4242',
  card_brand: 'visa',
};
const PAST_DUE: ClientDunningStatus = { ...LOCKED, state: 'past_due', locked_at: null, day: 3 };
const DISPUTE_LOCKED: ClientDunningStatus = { ...LOCKED, kind: 'dispute' };
const DISPUTE_PAST_DUE: ClientDunningStatus = { ...PAST_DUE, kind: 'dispute' };
const CLEAR: ClientDunningStatus = { ...LOCKED, state: 'none', amount_cents: null, day: null, locked_at: null };
const QUOTE = {
  quote_id: 'q1',
  complete: true,
  lines: [{ invoice_id: 'in_1', purchase_id: 'p1', currency: 'usd', amount_cents: 15000 }],
  totals: [{ currency: 'usd', amount_cents: 15000 }],
  disputes: [],
};
const SETUP = {
  setup_intent_id: 'seti_1',
  setup_intent_client_secret: 'seti_1_secret',
  ephemeral_key: 'ek_1',
  customer_id: 'cus_1',
  publishable_key: 'pk_test_backend',
  merchant_display_name: 'The Growth Project',
};
const PAID = {
  outcome: 'paid',
  amount_paid_cents: 15000,
  amount_due_cents: 0,
  currency: 'usd',
  paid_totals: [{ currency: 'usd', amount_cents: 15000 }],
  due_totals: [],
  access_restored: true,
  access_state: 'restored',
};
const NOW = Date.parse('2026-10-04T12:00:00.000Z');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function networkError() {
  return Object.assign(new Error('Network Error'), { response: undefined });
}

/** Production's answer for a route it does not have (no `code`). */
function productionNotFound(path: string) {
  return Object.assign(new Error('Request failed with status code 404'), {
    response: {
      status: 404,
      data: { statusCode: 404, message: `Cannot GET /api${path}`, error: 'Not Found', path: `/api${path}` },
      headers: {},
    },
  });
}

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return textOf((node as { children?: unknown }).children ?? null);
}

let route: string | undefined = 'HomeMain';
let ctx: ReturnType<typeof useDunning> = null;
function Reader() {
  ctx = useDunning();
  return <Text testID="status">{ctx?.status?.state ?? 'unknown'}</Text>;
}

function Provider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  return (
    <DunningLockoutProvider
      enabled={enabled}
      onMessageCoach={jest.fn()}
      onOpenDataExport={jest.fn()}
      onOpenDeleteAccount={jest.fn()}
      onSignOut={jest.fn()}
      onOpenUpdateCard={jest.fn()}
      getCurrentRouteName={() => route}
      subscribeToRouteChanges={() => () => undefined}
    >
      {children}
    </DunningLockoutProvider>
  );
}

function lockoutProps(status: ClientDunningStatus | null) {
  return {
    status,
    loadError: null,
    refreshing: false,
    onRefresh: jest.fn(),
    onUpdateCard: jest.fn(),
    onEndPlan: jest.fn(),
    onMessageCoach: jest.fn(),
    onOpenDataExport: jest.fn(),
    onOpenDeleteAccount: jest.fn(),
    onSignOut: jest.fn(),
    supportReference: null,
  };
}

function cardRoutes(confirm: Record<string, unknown> = PAID, quote: Record<string, unknown> = QUOTE) {
  mockPost.mockImplementation(async (url: string) => ({ data: url.endsWith('/setup-intent') ? SETUP : confirm }));
  return (status: ClientDunningStatus) =>
    mockGet.mockImplementation(async (url: string) => ({ data: url.endsWith('/quote') ? quote : status }));
}

beforeEach(() => {
  jest.clearAllMocks();
  dunningLockoutStore.__resetForTests();
  __resetStripeSdkForTests();
  mockGet.mockReset();
  mockPost.mockReset();
  mockSdk.presentPaymentSheet.mockImplementation(async () => ({}));
  route = 'HomeMain';
  ctx = null;
});

describe('B-353-1: the lockout belongs to the signed-in account', () => {
  it('sign-out (client tree unmounts) clears the lock: the next account does not see it while its read is pending', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const a = await render(<Provider><Text>app</Text></Provider>);
    await act(async () => {
      dunningLockoutStore.reportLocked({ requestId: 'req-a' });
    });
    await a.findByTestId('dunning-lockout-screen');
    await a.unmount();
    expect(dunningLockoutStore.isLocked()).toBe(false);
    mockGet.mockReset();
    mockGet.mockImplementation(() => new Promise(() => undefined));
    const b = await render(<Provider><Text>app</Text></Provider>);
    expect(b.queryByTestId('dunning-lockout-overlay')).toBeNull();
  });

  it('the next account offline: no lock and no previous request reference', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const a = await render(<Provider><Text>app</Text></Provider>);
    await act(async () => {
      dunningLockoutStore.reportLocked({ requestId: 'req-a' });
    });
    await a.findByTestId('dunning-lockout-screen');
    await a.unmount();
    mockGet.mockReset();
    mockGet.mockRejectedValue(networkError());
    const b = await render(<Provider><Text>app</Text></Provider>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/checkout/dunning'));
    await act(async () => undefined);
    expect(b.queryByTestId('dunning-lockout-overlay')).toBeNull();
    expect(dunningLockoutStore.lastSignal()).toBeNull();
  });

  it("a retired provider's late locked read cannot lock the next account", async () => {
    const old = deferred<{ data: ClientDunningStatus }>();
    // B's first read is clear; any later read fails, so nothing heals a wrong lock.
    mockGet
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ data: CLEAR })
      .mockRejectedValue(networkError());
    const a = await render(<Provider><Reader /></Provider>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await a.unmount();
    const b = await render(<Provider><Reader /></Provider>);
    await waitFor(() => expect(b.getByTestId('status').props.children).toBe('none'));
    await act(async () => old.resolve({ data: LOCKED }));
    expect(b.queryByTestId('dunning-lockout-screen')).toBeNull();
    expect(dunningLockoutStore.isLocked()).toBe(false);
  });

  it('a read started before sign-out (same provider still mounted) is dropped after the auth event', async () => {
    const old = deferred<{ data: ClientDunningStatus }>();
    mockGet.mockReturnValueOnce(old.promise);
    const screen = await render(<Provider><Reader /></Provider>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await act(async () => {
      authEvents.emit('logout');
    });
    await act(async () => old.resolve({ data: LOCKED }));
    expect(screen.queryByTestId('dunning-lockout-screen')).toBeNull();
    expect(screen.getByTestId('status').props.children).toBe('unknown');
  });

  it('an older clear answer cannot overwrite a newer locked read (latest read wins)', async () => {
    const old = deferred<{ data: ClientDunningStatus }>();
    mockGet.mockReturnValueOnce(old.promise).mockResolvedValue({ data: LOCKED });
    const screen = await render(<Provider><Reader /></Provider>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await act(async () => {
      await ctx?.refresh();
    });
    await screen.findByTestId('dunning-lockout-screen');
    await act(async () => old.resolve({ data: CLEAR }));
    expect(screen.queryByTestId('dunning-lockout-screen')).not.toBeNull();
    expect(dunningLockoutStore.isLocked()).toBe(true);
  });

  it('an older failure cannot replace a newer answer with an error', async () => {
    const old = deferred<{ data: ClientDunningStatus }>();
    mockGet.mockReturnValueOnce(old.promise).mockResolvedValue({ data: LOCKED });
    const screen = await render(<Provider><Reader /></Provider>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await act(async () => {
      await ctx?.refresh();
    });
    await screen.findByTestId('dunning-lockout-screen');
    await act(async () => old.reject(networkError()));
    expect(screen.queryByTestId('dunning-lockout-load-error')).toBeNull();
  });

  it('End my plan answered after sign-out shows nothing and does not refresh', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const cancel = deferred<{ data: Record<string, unknown> }>();
    mockGet.mockResolvedValue({ data: LOCKED });
    mockPost.mockReturnValueOnce(cancel.promise);
    const screen = await render(<Provider><Reader /></Provider>);
    await screen.findByTestId('dunning-lockout-screen');
    await fireEvent.press(screen.getByTestId('dunning-lockout-end-plan'));
    const buttons = alert.mock.calls[0][2] as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1].onPress?.();
    });
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const reads = mockGet.mock.calls.length;
    await act(async () => {
      authEvents.emit('logout');
    });
    await act(async () =>
      cancel.resolve({
        data: {
          outcome: 'ended',
          purchase_id: 'p1',
          access_ends_at: null,
          voided_invoice_count: 1,
          voided_amount_cents: 15000,
          currency: 'usd',
        },
      }),
    );
    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls.length).toBe(reads);
    alert.mockRestore();
  });

  it('CONTROL: the current account still sees its own lockout from a status read', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const screen = await render(<Provider><Reader /></Provider>);
    await screen.findByTestId('dunning-lockout-screen');
    expect(dunningLockoutStore.isLocked()).toBe(true);
  });
});

describe('B-353-2: a retired Update card screen starts no further step', () => {
  it('leaving while the quote is pending: no SetupIntent, no card form', async () => {
    route = 'UpdateCard';
    const quote = deferred<{ data: typeof QUOTE }>();
    mockGet.mockImplementation((url: string) => (url.endsWith('/quote') ? quote.promise : Promise.resolve({ data: CLEAR })));
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    const pressed = fireEvent.press(screen.getByTestId('update-card-add'));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/checkout/payment-method/quote'));
    await screen.unmount();
    await act(async () => {
      quote.resolve({ data: QUOTE });
      await pressed;
    });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockSdk.presentPaymentSheet).not.toHaveBeenCalled();
  });

  it('a late card-form return after leaving sends no confirm', async () => {
    route = 'UpdateCard';
    const present = deferred<Record<string, unknown>>();
    mockSdk.presentPaymentSheet.mockImplementation(() => present.promise);
    cardRoutes()(CLEAR);
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    const pressed = fireEvent.press(screen.getByTestId('update-card-add'));
    await waitFor(() => expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1));
    await screen.unmount();
    await act(async () => {
      present.resolve({});
      await pressed;
    });
    expect(mockPost.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false);
  });

  it('a sign-out while the card form is open (screen still mounted) sends no confirm', async () => {
    route = 'UpdateCard';
    const present = deferred<Record<string, unknown>>();
    mockSdk.presentPaymentSheet.mockImplementation(() => present.promise);
    cardRoutes()(CLEAR);
    const screen = await render(<UpdateCardScreen />);
    const pressed = fireEvent.press(screen.getByTestId('update-card-add'));
    await waitFor(() => expect(mockSdk.presentPaymentSheet).toHaveBeenCalledTimes(1));
    await act(async () => {
      authEvents.emit('logout');
    });
    await act(async () => {
      present.resolve({});
      await pressed;
    });
    expect(mockPost.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false);
  });

  it('CONTROL: a current screen pays and shows the receipt', async () => {
    route = 'UpdateCard';
    cardRoutes()(CLEAR);
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    await fireEvent.press(screen.getByTestId('update-card-add'));
    await screen.findByTestId('update-card-result-paid');
    expect(mockPost).toHaveBeenCalledWith('/v1/checkout/payment-method/confirm', {
      setup_intent_id: 'seti_1',
      approved_invoices: [{ invoice_id: 'in_1', amount_cents: 15000, currency: 'usd' }],
    });
  });
});

describe('B-353-2: an End my plan confirmation belongs to the screen, account and plan that opened it', () => {
  const ENDED = { outcome: 'ended', purchase_id: 'p1', voided_invoice_count: 1, voided_amount_cents: 15000, currency: 'usd' };
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => alert.mockRestore());
  const confirmOf = (call = 0) =>
    (alert.mock.calls[call][2] as Array<{ style?: string; onPress?: () => void }>).find((b) => b.style === 'destructive')
      ?.onPress;
  const cancels = () => mockPost.mock.calls.filter(([url]) => String(url).endsWith('/cancel'));

  it('Update card: accepted after the screen left (provider still mounted), no cancel is sent', async () => {
    route = 'UpdateCard';
    mockGet.mockResolvedValue({ data: LOCKED });
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    await fireEvent.press(await screen.findByTestId('update-card-end-plan'));
    const confirm = confirmOf();
    await screen.rerender(<Provider><Text>elsewhere</Text></Provider>);
    await act(async () => confirm?.());
    expect(cancels()).toEqual([]);
  });

  it('Update card and lockout: accepted after the account changed, no cancel for either account', async () => {
    route = 'UpdateCard';
    mockGet.mockResolvedValue({ data: LOCKED });
    const card = await render(<Provider><UpdateCardScreen /></Provider>);
    await fireEvent.press(await card.findByTestId('update-card-end-plan'));
    const props = lockoutProps(LOCKED);
    const lockout = await render(<DunningLockoutScreen {...props} />);
    await fireEvent.press(lockout.getByTestId('dunning-lockout-end-plan'));
    await act(async () => {
      authEvents.emit('logout');
    });
    await act(async () => {
      confirmOf(0)?.();
      confirmOf(1)?.();
    });
    expect(cancels()).toEqual([]);
    expect(props.onEndPlan).not.toHaveBeenCalled();
  });

  it('lockout: accepted after the lockout lifted, no cancel; the plan sent is the one the dialog showed', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    mockPost.mockResolvedValue({ data: ENDED });
    const screen = await render(<Provider><Reader /></Provider>);
    await fireEvent.press(await screen.findByTestId('dunning-lockout-end-plan'));
    const stale = confirmOf();
    await act(async () => {
      dunningLockoutStore.clear();
    });
    await act(async () => stale?.());
    expect(cancels()).toEqual([]);
    // Live: the status moves to another plan while the dialog is open; the confirmed plan is the one sent.
    await act(async () => {
      dunningLockoutStore.reportLocked({ requestId: 'req-2' });
    });
    await fireEvent.press(await screen.findByTestId('dunning-lockout-end-plan'));
    mockGet.mockResolvedValue({ data: { ...LOCKED, purchase_id: 'p2' } });
    await act(async () => {
      await ctx?.refresh();
    });
    await act(async () => confirmOf(1)?.());
    expect(cancels()).toEqual([['/v1/checkout/subscriptions/p1/cancel', {}]]);
  });

  it('a cancel already sent when the screen leaves: no late dialog, and the provider re-reads the server truth', async () => {
    route = 'UpdateCard';
    mockGet.mockResolvedValue({ data: LOCKED });
    const sent = deferred<{ data: typeof ENDED }>();
    mockPost.mockImplementation(() => sent.promise);
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    await fireEvent.press(await screen.findByTestId('update-card-end-plan'));
    await act(async () => confirmOf()?.());
    expect(cancels()).toHaveLength(1);
    await screen.rerender(<Provider><Text>elsewhere</Text></Provider>);
    const reads = mockGet.mock.calls.length;
    mockGet.mockResolvedValue({ data: CLEAR });
    await act(async () => sent.resolve({ data: ENDED }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls.length).toBeGreaterThan(reads);
  });

  it('CONTROL: a live confirmation on Update card cancels the plan it showed and shows the outcome', async () => {
    route = 'UpdateCard';
    mockGet.mockResolvedValue({ data: LOCKED });
    mockPost.mockResolvedValue({ data: ENDED });
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    await fireEvent.press(await screen.findByTestId('update-card-end-plan'));
    await act(async () => confirmOf()?.());
    expect(cancels()).toEqual([['/v1/checkout/subscriptions/p1/cancel', {}]]);
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  });
});

describe('B-353-2 / B-353-3 (Sol): a reversed payment is described as one', () => {
  it('the dispute lockout states R-DISPUTE-PAUSE, leads with Message coach, offers no card or cancel path', async () => {
    mockGet.mockResolvedValue({ data: DISPUTE_LOCKED });
    const screen = await render(<Provider><Reader /></Provider>);
    await screen.findByTestId('dunning-lockout-screen');
    const text = textOf(screen.toJSON());
    expect(text).toContain('Your access has ended');
    expect(text).toContain(
      'Your bank reversed a payment of $150.00 to Avery. Your access has ended and billing is paused. Your coach, Avery, decides whether to restart it. It does not restart on its own or with a new card.',
    );
    expect(text).not.toMatch(/has not gone through|was declined|charged right away|add a card that works/i);
    expect(text).not.toMatch(/sort it out|settle|Already paid|Access pauses on/i);
    expect(screen.getByTestId('dunning-lockout-next-step').props.children).toBe(
      `Message Avery to talk about restarting. For any other question, email ${SUPPORT_EMAIL}.`,
    );
    expect(screen.getByTestId('dunning-lockout-message-coach')).toBeTruthy();
    expect(screen.queryByTestId('dunning-lockout-update-card')).toBeNull();
    expect(screen.queryByTestId('dunning-lockout-end-plan')).toBeNull();
    expect(screen.getByTestId('dunning-lockout-support')).toBeTruthy();
  });

  it('D2c dispute pause (reason dispute_paused, no amount, no lock date): same facts; a payment lock keeps its card path', async () => {
    const d2c = { ...DISPUTE_LOCKED, kind: null, reason: 'dispute_paused' as const, amount_cents: null, lockout_at: null };
    const screen = await render(<DunningLockoutScreen {...lockoutProps(d2c)} />);
    expect(textOf(screen.toJSON())).toMatch(/Your bank reversed a payment to Avery\. Your access has ended and billing is paused\./);
    expect(screen.queryByTestId('dunning-lockout-update-card')).toBeNull();
    const payment = await render(<DunningLockoutScreen {...lockoutProps(LOCKED)} />);
    expect(payment.getByTestId('dunning-lockout-update-card')).toBeTruthy();
    expect(payment.getByTestId('dunning-lockout-end-plan')).toBeTruthy();
    expect(textOf(payment.toJSON())).toContain('Already paid? Pull down to check again.');
  });

  it('End my plan body for a reversed payment (no screen offers it): access already ended, the coach decides', () => {
    const body = endPlanAlertBody(DISPUTE_LOCKED);
    expect(body).toContain('Access to this plan has already ended and its billing is paused. Your coach decides whether to restart it.');
    expect(body).toContain('If you end it, the plan ends now instead.');
    expect(body).not.toMatch(/sort it out|settle|Your access ends now|unpaid \$150\.00 is canceled/);
  });

  it('the lockout End my plan dialog keeps the paid-in-the-meantime caveat (one shared body)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = await render(<DunningLockoutScreen {...lockoutProps(LOCKED)} />);
    await fireEvent.press(screen.getByTestId('dunning-lockout-end-plan'));
    expect(alert.mock.calls[0][1]).toBe(endPlanAlertBody(LOCKED));
    expect(alert.mock.calls[0][1]).toContain('If a payment went through in the meantime, you keep the period you paid for');
    alert.mockRestore();
  });

  it('Update card intro and banner for a reversed payment: the three facts, no date, no charge, no card or support fix', () => {
    expect(updateCardIntro(DISPUTE_LOCKED)).toBe(
      'Your bank took back a payment of $150.00 to Avery. Your access has ended and billing is paused. Your coach, Avery, decides whether to restart it. It does not restart on its own or with a new card.',
    );
    for (const s of [DISPUTE_LOCKED, DISPUTE_PAST_DUE, { ...DISPUTE_LOCKED, lock_waived: true }]) {
      const intro = updateCardIntro(s);
      expect(intro).toMatch(/access has ended and billing is paused/i);
      expect(intro).not.toMatch(/charged to it right away|comes back|did not go through|future payments|sort it out|settle/);
    }
    // A dispute on one plan while another keeps access: the facts are scoped to that plan.
    expect(updateCardIntro({ ...DISPUTE_LOCKED, lock_waived: true })).toContain('For that plan, access has ended');
    const banner = bannerCopy(DISPUTE_PAST_DUE, NOW);
    expect(banner.body).toBe(
      'Your bank reversed a payment of $150.00 to Avery. For that plan, access has ended and billing is paused. Your coach, Avery, decides whether to restart it. It does not restart on its own or with a new card.',
    );
    expect(banner.body).not.toMatch(/Update your card|did not go through|Access pauses on|unless|Oct/);
  });

  it('the dispute banner offers Message coach only; a dispute that closes stays paused (no automatic restore)', async () => {
    mockGet.mockResolvedValue({ data: { ...DISPUTE_PAST_DUE, lock_waived: true } });
    const screen = await render(
      <Provider>
        <Reader />
        <DunningBanner surface="HomeScreen" />
      </Provider>,
    );
    await screen.findByTestId('dunning-banner');
    expect(screen.queryByTestId('dunning-banner-update-card')).toBeNull();
    // The bank closes the dispute: D2c still reports the pause until the coach restarts the plan.
    mockGet.mockResolvedValue({ data: { ...DISPUTE_PAST_DUE, lock_waived: true, reason: 'dispute_paused' } });
    await act(async () => {
      await ctx?.refresh();
    });
    expect(textOf(screen.getByTestId('dunning-banner'))).toContain('access has ended and billing is paused');
  });

  it('a dispute-only Save card shows what happened: nothing charged, the reversal still open', async () => {
    route = 'UpdateCard';
    cardRoutes(
      {
        outcome: 'saved',
        amount_paid_cents: 0,
        amount_due_cents: 0,
        currency: 'usd',
        paid_totals: [],
        due_totals: [],
        access_restored: false,
        access_state: 'unchanged',
        plans: [{ purchase_id: 'p1', dispute_open: true }],
      },
      {
        quote_id: 'q_d',
        complete: true,
        lines: [],
        totals: [],
        disputes: [{ purchase_id: 'p1', coach_name: 'Avery', amount_cents: 15000, currency: 'usd' }],
      },
    )(DISPUTE_LOCKED);
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    await fireEvent.press(screen.getByTestId('update-card-add'));
    const result = await screen.findByTestId('update-card-result-saved');
    const body = textOf(result);
    expect(body).toContain('There was no open invoice to pay, so nothing was charged.');
    expect(body).toContain('For that plan, access has ended and billing is paused.');
    expect(textOf(screen.toJSON())).not.toMatch(/was declined|sort it out|settle/);
    expect(screen.queryByTestId('update-card-end-plan')).toBeNull();
    expect(screen.getByTestId('update-card-message-coach')).toBeTruthy();
  });

  it('a payment plan whose quote also names a reversed payment says so before the card form', async () => {
    route = 'UpdateCard';
    const present = deferred<Record<string, unknown>>();
    mockSdk.presentPaymentSheet.mockImplementation(() => present.promise);
    cardRoutes(PAID, {
      ...QUOTE,
      disputes: [{ purchase_id: 'p2', coach_name: 'Blake', amount_cents: 9000, currency: 'usd' }],
    })(LOCKED);
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    void fireEvent.press(screen.getByTestId('update-card-add'));
    const note = await screen.findByTestId('update-card-quote-dispute');
    expect(note.props.children).toBe(
      'Your bank reversed a payment of $90.00 to Blake. For that plan, access has ended and billing is paused. Your coach, Blake, decides whether to restart it. It does not restart on its own or with a new card.',
    );
    await act(async () => present.resolve({ error: { code: 'Canceled' } }));
  });
});

describe('B-353-3: no first person in rendered client copy', () => {
  it.each([
    ['payment lock', LOCKED],
    ['dispute lock', DISPUTE_LOCKED],
    ['status not loaded', null],
  ])('lockout screen (%s)', async (_label, status) => {
    const screen = await render(<DunningLockoutScreen {...lockoutProps(status)} />);
    expect(textOf(screen.toJSON())).not.toMatch(FIRST_PERSON);
  });

  it.each([
    ['locked', LOCKED],
    ['past due', PAST_DUE],
    ['dispute', DISPUTE_LOCKED],
    ['clear', CLEAR],
  ])('Update card screen (%s)', async (_label, status) => {
    mockGet.mockResolvedValue({ data: status });
    route = 'UpdateCard';
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(textOf(screen.toJSON())).not.toMatch(FIRST_PERSON);
  });

  it('banner, summaries, next steps and end-plan bodies', () => {
    const all = [PAST_DUE, DISPUTE_PAST_DUE, { ...PAST_DUE, lock_waived: true }].flatMap((s) => {
      const b = bannerCopy(s, NOW);
      return [b.title, b.body, lockoutSummary(s), lockoutNextStep(s), endPlanAlertBody(s), updateCardIntro(s)];
    });
    for (const t of all) {
      expect(t).not.toMatch(FIRST_PERSON);
      expect(t).not.toContain('!');
    }
  });
});

describe('C-353-3: a waived or passed lock date is never shown as a deadline', () => {
  it('lock waived: no date, no keep-access deadline', () => {
    const body = bannerCopy({ ...PAST_DUE, lock_waived: true }, NOW).body;
    expect(body).not.toMatch(/by \w+day/);
    expect(body).toContain('Update your card to settle it.');
  });

  it('lock date already passed: no date', () => {
    expect(bannerCopy(PAST_DUE, Date.parse('2026-10-12T00:00:00.000Z')).body).not.toMatch(/by \w+day/);
  });
});

describe('B-353-4: the lockout is modal for screen readers', () => {
  it('while the lockout shows, the app underneath is hidden; after it lifts, it is reachable again', async () => {
    mockGet.mockResolvedValue({ data: LOCKED });
    const screen = await render(<Provider><Text>app content</Text></Provider>);
    await screen.findByTestId('dunning-lockout-screen');
    expect(isHiddenFromAccessibility(screen.getByText('app content', { includeHiddenElements: true }))).toBe(true);
    expect(screen.getByTestId('dunning-lockout-overlay').props.accessibilityViewIsModal).toBe(true);
    await act(async () => {
      dunningLockoutStore.clear();
    });
    expect(isHiddenFromAccessibility(screen.getByText('app content'))).toBe(false);
  });
});

describe("truthful against today's production backend (no dunning routes, flag off)", () => {
  it('status route missing (production 404 envelope): no lockout, no banner, nothing reported', async () => {
    mockGet.mockRejectedValue(productionNotFound('/v1/checkout/dunning'));
    const screen = await render(
      <Provider>
        <Text>home</Text>
        <DunningBanner surface="HomeScreen" />
      </Provider>,
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/checkout/dunning'));
    await act(async () => undefined);
    expect(screen.queryByTestId('dunning-lockout-overlay')).toBeNull();
    expect(screen.queryByTestId('dunning-banner')).toBeNull();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('flag off ({ enabled: false }) is never a lock, whatever state it carries', async () => {
    mockGet.mockResolvedValue({ data: { ...LOCKED, enabled: false } });
    const screen = await render(<Provider><Reader /></Provider>);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByTestId('dunning-lockout-overlay')).toBeNull();
    expect(dunningLockoutStore.isLocked()).toBe(false);
  });

  it('Update card on a server without the card routes says it is not available and nothing was charged', async () => {
    route = 'UpdateCard';
    mockGet.mockImplementation(async (url: string) => {
      if (url.endsWith('/quote')) throw productionNotFound('/v1/checkout/payment-method/quote');
      throw productionNotFound('/v1/checkout/dunning');
    });
    const screen = await render(<Provider><UpdateCardScreen /></Provider>);
    await fireEvent.press(screen.getByTestId('update-card-add'));
    const err = await screen.findByTestId('update-card-error');
    expect(err.props.children).toContain('not available yet, so nothing was charged');
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockSdk.presentPaymentSheet).not.toHaveBeenCalled();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });
});
