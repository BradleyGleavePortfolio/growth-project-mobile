// src/__tests__/CoachPackageEditScreen.lockPreview.test.tsx
//
// PR-18 M1 items 2+3 — coach editor: preview-as-buyer + lock-pricing UX.
//
// What we assert (RTL mount):
//   1. Lock-pricing helper copy renders when the package has subscribers, and
//      is ABSENT when subscriberCount === 0. Fields are NOT over-disabled
//      (price input stays editable).
//   2. "Preview as buyer" opens a modal rendering the coachPreview surface
//      with the disabled-checkout banner (built from local draft + original,
//      no network fetch).
//   3. A PACKAGE_PRICING_LOCKED save error surfaces the actionable lock alert
//      (not the generic "Could not save").

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

// ── Theme mock ──────────────────────────────────────────────────────────────
jest.mock('../theme/ThemeProvider', () => {
  const tokensModule = jest.requireActual('../theme/tokens');
  const realTokens = tokensModule.default;
  const CanonicalColors = jest.requireActual('../constants/colors').default;
  const colors = {
    ...CanonicalColors,
    dark: CanonicalColors.textPrimary,
    white: CanonicalColors.textOnPrimary,
    gold: CanonicalColors.warning,
    orange: CanonicalColors.error,
  };
  return {
    useTheme: () => ({
      colors,
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      tierColors: {
        accentBorder: realTokens.colors.forest,
        accentBg: 'rgba(44,74,54,0.06)',
        accentFg: realTokens.colors.forest,
        badgeShadow: realTokens.shadows.sm,
      },
      colorScheme: 'light',
    }),
  };
});

jest.mock('expo-font', () => ({ isLoaded: () => true }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'c@x.com', name: 'Coach Lee' }),
}));

const mockCaptureError = jest.fn();
jest.mock('../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));
const mockSignOut = jest.fn(async () => undefined);
jest.mock('../services/authActions', () => ({
  signOut: () => mockSignOut(),
}));

const mockUpdate = jest.fn();
const mockPublish = jest.fn();
const mockUnpublish = jest.fn();
jest.mock('../api/packagesApi', () => {
  const actual = jest.requireActual('../api/packagesApi');
  return {
    ...actual,
    coachPackagesApi: {
      update: (...a: unknown[]) => mockUpdate(...a),
      create: jest.fn(),
      archive: jest.fn(),
      publish: (...a: unknown[]) => mockPublish(...a),
      unpublish: (...a: unknown[]) => mockUnpublish(...a),
    },
  };
});

import CoachPackageEditScreen from '../screens/coach/payments/CoachPackageEditScreen';
import type { CoachPackage } from '../api/packagesApi';
import { toBackendUpdate } from '../api/packagesApi';

function pkg(overrides: Partial<CoachPackage> = {}): CoachPackage {
  return {
    id: 'pkg_1',
    coachUserId: 'u1',
    title: 'Strength Builder',
    description: 'Get strong.',
    priceCents: 9900,
    currency: 'usd',
    billingInterval: 'monthly',
    intervalCount: 1,
    trialDays: null,
    features: ['Programming', 'Form checks'],
    status: 'active',
    shareToken: 'tok_123',
    subscriberCount: 0,
    monthlyRevenueCents: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    ...overrides,
  };
}

function makeProps(initialPackage: CoachPackage) {
  const nav = { navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn() };
  return {
    nav,
    navigation: nav as never,
    route: { params: { packageId: initialPackage.id, initialPackage } } as never,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('CoachPackageEditScreen — lock-pricing UX', () => {
  it('shows the lock helper copy when the package has subscribers', async () => {
    const props = makeProps(pkg({ subscriberCount: 3 }));
    const { getByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    expect(
      getByText(/Pricing is locked after subscribers join/),
    ).toBeTruthy();
  });

  it('does NOT show the lock helper copy when there are no subscribers', async () => {
    const props = makeProps(pkg({ subscriberCount: 0 }));
    const { queryByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    expect(queryByText(/Pricing is locked after subscribers join/)).toBeNull();
  });

  it('does not over-disable the price field when locked (still editable)', async () => {
    const props = makeProps(pkg({ subscriberCount: 3 }));
    const { getByDisplayValue } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    const priceInput = getByDisplayValue('99.00');
    // editable is undefined (truthy default) — never explicitly false.
    expect(priceInput.props.editable).not.toBe(false);
  });

  it('surfaces the actionable lock alert on a PACKAGE_PRICING_LOCKED save error', async () => {
    mockUpdate.mockRejectedValue({
      response: { data: { error: 'PACKAGE_PRICING_LOCKED' } },
    });
    const props = makeProps(pkg({ subscriberCount: 3 }));
    const { getByLabelText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Save changes'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await waitFor(() => {
      const calls = (Alert.alert as jest.Mock).mock.calls;
      const locked = calls.find((c) => c[0] === 'Pricing is locked');
      expect(locked).toBeTruthy();
      expect(locked[1]).toMatch(/Create a new package for new pricing/);
    });
  });
});

describe('CoachPackageEditScreen — preview as buyer', () => {
  it('opens the coachPreview surface with the disabled-checkout banner', async () => {
    const props = makeProps(pkg({ subscriberCount: 0 }));
    const { getByLabelText, getByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Preview as buyer'));
    await waitFor(() =>
      expect(
        getByText('Buyer preview — checkout is disabled for coaches.'),
      ).toBeTruthy(),
    );
    // The disabled CTA exists in preview; no functional pay path.
    expect(getByLabelText('Checkout disabled in preview')).toBeTruthy();
  });
});

describe('CoachPackageEditScreen — S-FEE price rule ($19.99 minimum or free)', () => {
  it('shows the price rule under the price field', async () => {
    const props = makeProps(pkg());
    const { getByTestId } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    expect(getByTestId('package-price-helper').props.children).toBe(
      'Paid packages start at $19.99, or make it free.',
    );
  });

  it('blocks saving a paid price under $19.99 and says what to do', async () => {
    const props = makeProps(pkg());
    const { getByDisplayValue, getByLabelText, getAllByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.changeText(getByDisplayValue('99.00'), '10.00');
    await fireEvent.press(getByLabelText('Save changes'));
    expect(mockUpdate).not.toHaveBeenCalled();
    // Inline under the field and as the save error.
    expect(getAllByText('Paid packages start at $19.99, or make it free.').length).toBe(2);
  });

  it('blocks a free recurring package with the one-time message', async () => {
    const props = makeProps(pkg());
    const { getByDisplayValue, getByLabelText, getAllByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.changeText(getByDisplayValue('99.00'), '0');
    await fireEvent.press(getByLabelText('Save changes'));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(
      getAllByText(
        'Free packages are one-time. Switch billing to One-time, or set a price of $19.99 or more.',
      ).length,
    ).toBe(2);
  });

  it('keeps a package saved under $19.99 editable while its price is unchanged', async () => {
    mockUpdate.mockResolvedValue({ data: pkg({ priceCents: 1000 }) });
    const props = makeProps(pkg({ priceCents: 1000 }));
    const { getByLabelText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Save changes'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  });

  it('shows the server price message when the backend rejects the price', async () => {
    mockUpdate.mockRejectedValue({
      response: {
        data: {
          error: 'PACKAGE_RECURRING_PRICE_BELOW_MINIMUM',
          message:
            'The recurring price starts at $19.99. Set it to $19.99 or more, or remove the recurring price.',
        },
      },
    });
    const props = makeProps(pkg());
    const { getByLabelText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Save changes'));
    await waitFor(() => {
      const calls = (Alert.alert as jest.Mock).mock.calls;
      const hit = calls.find((c) => c[0] === 'Check the price');
      expect(hit).toBeTruthy();
      expect(hit[1]).toMatch(/recurring price starts at \$19\.99/);
    });
  });
});

// #321 fix round (Sol B-321-1): every save failure says what happened, keeps
// the edits, and offers a working next action; unknown failures carry a
// reference and reach Sentry. Real screen, real mapper.
describe('CoachPackageEditScreen — save failures (B-321-1)', () => {
  type Button = { text: string; style?: string; onPress?: () => void };
  const lastAlert = () => {
    const calls = (Alert.alert as jest.Mock).mock.calls;
    const c = calls[calls.length - 1];
    return { title: c[0] as string, message: c[1] as string, buttons: (c[2] ?? []) as Button[] };
  };
  const press = (buttons: Button[], text: string) => {
    const b = buttons.find((x) => x.text === text);
    if (!b?.onPress) throw new Error(`no button ${text}`);
    b.onPress();
  };
  async function saveWith(rejection: unknown, initial = pkg()) {
    mockUpdate.mockRejectedValueOnce(rejection);
    const props = makeProps(initial);
    const screen = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(screen.getByLabelText('Save changes'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    return { ...screen, props };
  }

  it('500 with request_id: reference, Try again, Contact support, Sentry event under the same reference', async () => {
    const { props, getByText } = await saveWith({
      response: {
        status: 500,
        data: { statusCode: 500, message: 'Internal server error', error: 'Internal Server Error', request_id: 'sol321-reference' },
      },
    });
    const a = lastAlert();
    expect(a.title).toBe('Could not save the package');
    expect(a.message).toBe(
      'Your changes were not saved. There was a problem on our side. Your changes are still here. Tap Try again, or contact support and quote reference SOL321RE.',
    );
    expect(a.buttons.map((b) => b.text)).toEqual(['Try again', 'Contact support', 'Close']);
    // the reference stays on screen after the dialog closes
    expect(getByText(/quote reference SOL321RE/)).toBeTruthy();
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [event, ctx] = mockCaptureError.mock.calls[0];
    expect((event as Error).message).toBe('package_save_update_failed');
    expect(ctx).toEqual({
      flow: 'package_save',
      mode: 'update',
      status: 500,
      code: null,
      reference: 'sol321-reference',
    });
    // never the request body or prices
    expect(JSON.stringify(ctx)).not.toMatch(/9900|Strength Builder/);
    press(a.buttons, 'Contact support');
    expect(props.nav.navigate).toHaveBeenCalledWith('SupportInbox');
    // Try again re-sends the current form and can succeed
    mockUpdate.mockResolvedValueOnce({ data: pkg() });
    press(a.buttons, 'Try again');
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(lastAlert().title).toBe('Package updated'));
  });

  it('network error: says nothing was saved, offers Try again, no Sentry noise', async () => {
    await saveWith({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
    const a = lastAlert();
    expect(a.title).toBe('No connection');
    expect(a.message).toBe(
      'We could not reach the server. Your changes were not saved. Your changes are still here. Check your connection, then tap Try again.',
    );
    expect(a.buttons.map((b) => b.text)).toEqual(['Try again', 'Close']);
    expect(mockCaptureError).not.toHaveBeenCalled();
    mockUpdate.mockResolvedValueOnce({ data: pkg() });
    press(a.buttons, 'Try again');
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
  });

  it('timeout: the server took too long, Try again', async () => {
    await saveWith({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' });
    expect(lastAlert().title).toBe('The server took too long');
    expect(lastAlert().buttons.map((b) => b.text)).toEqual(['Try again', 'Close']);
  });

  it('401: session ended, Sign in', async () => {
    await saveWith({ response: { status: 401, data: { statusCode: 401, message: 'Unauthorized' } } });
    const a = lastAlert();
    expect(a.title).toBe('Please sign in again');
    expect(a.message).toBe('Your session has ended. Your changes were not saved. Sign in again, then save the package.');
    press(a.buttons, 'Sign in');
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('403 plan not active: Open billing', async () => {
    const { props } = await saveWith({
      response: { status: 403, data: { statusCode: 403, error: 'SUBSCRIPTION_INACTIVE', message: 'Subscription inactive' } },
    });
    press(lastAlert().buttons, 'Open billing');
    expect(props.nav.navigate).toHaveBeenCalledWith('Billing');
  });

  it('404: package gone, Back to packages', async () => {
    const { props } = await saveWith({
      response: { status: 404, data: { statusCode: 404, code: 'PACKAGE_NOT_FOUND', error: 'PACKAGE_NOT_FOUND', message: 'No package with id pkg_1' } },
    });
    expect(lastAlert().title).toBe('Package not found');
    press(lastAlert().buttons, 'Back to packages');
    expect(props.nav.navigate).toHaveBeenCalledWith('CoachPackagesList');
  });

  it('reads the machine `code` (not only `error`): a price refusal with error "Bad Request" is still the price message', async () => {
    await saveWith({
      response: {
        status: 400,
        data: {
          statusCode: 400,
          code: 'PACKAGE_PRICE_BELOW_MINIMUM',
          error: 'Bad Request',
          message: 'Paid packages start at $19.99, or make it free.',
        },
      },
    });
    const a = lastAlert();
    expect(a.title).toBe('Check the price');
    expect(a.message).toBe('Paid packages start at $19.99, or make it free.');
    expect(a.buttons.map((b) => b.text)).toEqual(['OK']);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it.each([
    ['500 with an empty body', { response: { status: 500, data: {} } }],
    ['502 with a text body', { response: { status: 502, data: 'Bad gateway' } }],
    ['network error', { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' }],
    ['429', { response: { status: 429, data: { message: 'ThrottlerException: Too Many Requests' } } }],
  ])('never shows a generic message (%s)', async (_label, rejection) => {
    await saveWith(rejection);
    const a = lastAlert();
    expect(a.message).not.toMatch(/Something went wrong|Please check your inputs and try again/);
    expect(a.message).not.toMatch(/^Please try again\.?$/);
    expect(a.message).not.toContain('!');
    expect(a.buttons.length).toBeGreaterThan(0);
  });

  it('C-321-1: a package saved under $19.99 cannot change its billing interval without meeting the floor', async () => {
    const props = makeProps(pkg({ priceCents: 1000, billingInterval: 'monthly' }));
    const { getByLabelText, getAllByText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Yearly'));
    await fireEvent.press(getByLabelText('Save changes'));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getAllByText('Paid packages start at $19.99, or make it free.').length).toBeGreaterThan(0);
  });
});

// S-FEE round 4 (#321 B-321-3 and publish/unpublish).
describe('CoachPackageEditScreen — billing edits and publishing', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockPublish.mockReset();
    mockUnpublish.mockReset();
    (Alert.alert as jest.Mock).mockClear();
  });

  it('an edit-mode billing change reaches the PATCH body', async () => {
    mockUpdate.mockResolvedValue({ data: pkg({ billingInterval: 'one_time' }) });
    const props = makeProps(pkg());
    const { getByLabelText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('One-time'));
    await fireEvent.press(getByLabelText('Save changes'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const [id, input] = mockUpdate.mock.calls[0];
    expect(id).toBe('pkg_1');
    expect(input.billingInterval).toBe('one_time');
    // The real request builder turns the screen's input into the PATCH body.
    expect(toBackendUpdate(input)).toMatchObject({
      billing_type: 'one_time',
      billing_interval: null,
      amount_cents: 9900,
    });
    await waitFor(() =>
      expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[1] === 'Changes saved.')).toBe(true),
    );
  });

  it('a name-only edit does not send billing fields', async () => {
    mockUpdate.mockResolvedValue({ data: pkg({ billingInterval: 'yearly' }) });
    const props = makeProps(pkg({ billingInterval: 'yearly' }));
    const { getByLabelText, getByDisplayValue } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.changeText(getByDisplayValue('Strength Builder'), 'Strength Plus');
    await fireEvent.press(getByLabelText('Save changes'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const input = mockUpdate.mock.calls[0][1];
    expect(input.title).toBe('Strength Plus');
    expect(input.billingInterval).toBeUndefined();
    expect(input.intervalCount).toBeUndefined();
  });

  it('a draft shows Publish; publishing calls the API and says it is on sale', async () => {
    mockPublish.mockResolvedValue({ data: pkg({ status: 'active' }) });
    const props = makeProps(pkg({ status: 'draft' }));
    const { getByLabelText, getByTestId } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    expect(getByTestId('package-publish-state').props.children).toMatch(/^Draft\./);
    await fireEvent.press(getByLabelText('Publish package'));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith('pkg_1'));
    await waitFor(() =>
      expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Package published')).toBe(true),
    );
    expect(getByLabelText('Unpublish package')).toBeTruthy();
  });

  it('a first publish below $19.99 shows the floor copy with the price fix', async () => {
    mockPublish.mockRejectedValue({
      response: { status: 400, data: { code: 'PACKAGE_PRICE_BELOW_MINIMUM', message: 'Paid packages start at $19.99, or make it free.' } },
    });
    const props = makeProps(pkg({ status: 'draft', priceCents: 1000 }));
    const { getByLabelText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Publish package'));
    await waitFor(() => {
      const c = (Alert.alert as jest.Mock).mock.calls.find((x) => x[0] === 'Check the price');
      expect(c?.[1]).toBe('Paid packages start at $19.99, or make it free.');
    });
  });

  it('an on-sale package can be unpublished', async () => {
    mockUnpublish.mockResolvedValue({ data: pkg({ status: 'draft' }) });
    const props = makeProps(pkg({ status: 'active' }));
    const { getByLabelText } = await render(
      <CoachPackageEditScreen navigation={props.navigation} route={props.route} />,
    );
    await fireEvent.press(getByLabelText('Unpublish package'));
    await waitFor(() => expect(mockUnpublish).toHaveBeenCalledWith('pkg_1'));
    expect(getByLabelText('Publish package')).toBeTruthy();
  });
});
