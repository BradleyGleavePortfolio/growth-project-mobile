/**
 * M-FEATURED-123: the owner's Featured coach editor. The HTTP layer
 * (services/api) is mocked, so every test proves screen -> featuredCoachApi
 * -> exact route and body, and that each server refusal has its own line.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPut = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), put: (...a: unknown[]) => mockPut(...a) },
}));
jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'owner-1', email: 'owner@example.test', name: 'Bradley Gleave', role: 'owner' }),
}));
jest.mock('../../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../../components/PackageSelectionSheet', () => ({ __esModule: true, default: () => null }));

import FeaturedCoachEditorScreen from '../FeaturedCoachEditorScreen';
import { pitchPrice, suggestedPitch } from '../featuredCoachCopy';

const PKG = { id: 'pkg-49', name: 'Monthly coaching', description: null, amount_cents: 4900, currency: 'usd', billing_type: 'recurring', interval: 'month', interval_count: 1 };
const OTHER = { id: 'coach-x', name: 'Alex Rivera', email: 'alex@example.test', business_name: null, packages: [] };
const BRADLEY = { id: 'coach-b', name: 'Bradley Gleave', email: 'coach@example.test', business_name: 'TGP', packages: [PKG] };
const EMPTY_VIEW = {
  config: null,
  resolved: { configured: false, banner_title: 'Enter coach code for coaching and programs', accepting_clients: false, coach: null, package: null },
};
const PITCH = "Sir/Ma'am, just so you're aware, TGP's top coach has available slots. Enter code GP-BRADLEY and join for $49/mo. Interested?";

function routeGet(coaches: unknown) {
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/admin/featured-coach') return { data: EMPTY_VIEW };
    if (url === '/admin/featured-coach/coaches') {
      if (coaches instanceof Error) throw coaches;
      return { data: { coaches } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

function httpError(status: number, data: Record<string, unknown> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
}

function savedConfig(body: Record<string, unknown>) {
  return {
    config: { ...body, banner_title: body.banner_title ?? 'Enter coach code for coaching and programs' },
    resolved: { ...EMPTY_VIEW.resolved, configured: true, accepting_clients: true, coach: null, package: PKG },
    code_created: true,
  };
}

async function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FeaturedCoachEditorScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockPut.mockReset();
});

describe('Featured coach editor', () => {
  it('preselects the coach account with the owner name, GP-BRADLEY, its package and the suggested pitch', async () => {
    routeGet([OTHER, BRADLEY]);
    await renderEditor();
    await screen.findByTestId('featured-coach-editor');
    expect(screen.getByTestId('featured-coach-coach-b').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('featured-coach-coach-x').props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('featured-code').props.value).toBe('GP-BRADLEY');
    expect(screen.getByTestId('featured-package-pkg-49').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('featured-pitch').props.value).toBe(PITCH);
    // Preview: switches off -> neutral banner only, Roman card hidden with the reason.
    expect(screen.getByTestId('coachless-banner')).toBeTruthy();
    expect(screen.queryByTestId('coachless-offer')).toBeNull();
    expect(screen.getByTestId('featured-roman-hidden').props.children).toBe('Roman card is off.');
  });

  it('live preview shows the offer, the coach card and the Roman card once both switches are on', async () => {
    routeGet([BRADLEY]);
    await renderEditor();
    await screen.findByTestId('featured-coach-editor');
    await fireEvent.changeText(screen.getByTestId('featured-offer-text'), '1:1 coaching with the top coach, $49/mo.');
    await fireEvent(screen.getByTestId('featured-accepting'), 'valueChange', true);
    await fireEvent(screen.getByTestId('featured-roman'), 'valueChange', true);
    expect(screen.getByTestId('coachless-offer').props.children).toBe('1:1 coaching with the top coach, $49/mo.');
    expect(screen.getByTestId('coachless-featured-coach')).toBeTruthy();
    expect(screen.getByTestId('coachless-roman-card')).toBeTruthy();
    expect(screen.getByText(PITCH)).toBeTruthy();
  });

  it('the pitch follows the code until the owner edits it', async () => {
    routeGet([BRADLEY]);
    await renderEditor();
    await screen.findByTestId('featured-coach-editor');
    await fireEvent.changeText(screen.getByTestId('featured-code'), 'gp-top');
    expect(screen.getByTestId('featured-pitch').props.value).toBe(suggestedPitch('GP-TOP', '$49/mo'));
    await fireEvent.changeText(screen.getByTestId('featured-pitch'), 'Own words.');
    await fireEvent.changeText(screen.getByTestId('featured-code'), 'GP-NEW');
    expect(screen.getByTestId('featured-pitch').props.value).toBe('Own words.');
  });

  it('saves the full config with create_code_if_missing and default caps, then confirms the new code', async () => {
    routeGet([BRADLEY]);
    mockPut.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({ data: savedConfig(body) }));
    await renderEditor();
    await screen.findByTestId('featured-coach-editor');
    await fireEvent(screen.getByTestId('featured-accepting'), 'valueChange', true);
    await fireEvent(screen.getByTestId('featured-roman'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('featured-save'));
    await screen.findByTestId('featured-saved');
    expect(mockPut).toHaveBeenCalledWith(
      '/admin/featured-coach',
      {
        coach_user_id: 'coach-b', code: 'GP-BRADLEY', package_id: 'pkg-49', banner_title: 'Enter coach code for coaching and programs',
        offer_text: null, roman_pitch_text: PITCH, accepting_clients: true, roman_enabled: true, roman_min_hours_between: 24,
        roman_max_per_week: 3, roman_snooze_days: 14, roman_max_not_now: 2, create_code_if_missing: true,
      },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(screen.getByTestId('featured-saved').props.children).toBe('Saved. Code GP-BRADLEY was created for Bradley Gleave.');
  });

  it.each([
    ['featured_code_other_coach', 400, 'code', 'That code already belongs to a different coach.'],
    ['featured_code_unknown', 400, 'code', 'That code does not exist yet.'],
    ['featured_coach_invalid', 400, 'coach', 'That account is not a coach account.'],
    ['featured_package_invalid', 400, 'package', 'That package is not an active package of this coach.'],
    ['no code', 403, 'form', 'Only the owner account can change the featured coach.'],
    ['no code', 400, 'form', 'The server did not accept one of the fields.'],
    ['no code', 429, 'form', 'Too many saves in a short time.'],
  ])('refusal %s (%i) has its own line under the %s field', async (code, status, where, line) => {
    routeGet([BRADLEY]);
    mockPut.mockRejectedValue(httpError(status, code === 'no code' ? {} : { code }));
    await renderEditor();
    await screen.findByTestId('featured-coach-editor');
    await fireEvent.press(screen.getByTestId('featured-save'));
    const shown = await screen.findByTestId(`featured-error-${where}`);
    expect(String(shown.props.children).startsWith(line)).toBe(true);
  });

  it('a server failure names the request reference; no connection says so', async () => {
    routeGet([BRADLEY]);
    mockPut.mockRejectedValueOnce(httpError(500, { request_id: 'req-123' }));
    await renderEditor();
    await screen.findByTestId('featured-coach-editor');
    await fireEvent.press(screen.getByTestId('featured-save'));
    expect((await screen.findByTestId('featured-error-form')).props.children).toContain('reference req-123');
    mockPut.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { response: undefined }));
    await fireEvent.press(screen.getByTestId('featured-save'));
    const offline = 'No connection. Check the internet connection, then tap Save again.';
    await waitFor(() => expect(screen.getByTestId('featured-error-form').props.children).toBe(offline));
  });

  it('a cap outside its range is caught before the request', async () => {
    routeGet([BRADLEY]);
    await renderEditor();
    await screen.findByTestId('featured-coach-editor');
    await fireEvent.changeText(screen.getByTestId('featured-cap-roman_max_per_week'), '15');
    await fireEvent.press(screen.getByTestId('featured-save'));
    expect(screen.getByTestId('featured-error-caps').props.children).toBe('Roman cards per week, at most: enter a whole number from 1 to 14.');
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('before the server offers the coach list, the configured coach stays editable', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/admin/featured-coach/coaches') throw httpError(404);
      return {
        data: {
          config: {
            coach_user_id: 'coach-b', code: 'GP-BRADLEY', package_id: 'pkg-49', banner_title: 'Title',
            offer_text: 'Offer', roman_pitch_text: 'Saved pitch', accepting_clients: true, roman_enabled: true,
            roman_min_hours_between: 48, roman_max_per_week: 2, roman_snooze_days: 7, roman_max_not_now: 3,
          },
          resolved: { configured: true, banner_title: 'Title', accepting_clients: true, coach: { id: 'coach-b', name: 'Bradley Gleave', photo_url: null, business_name: 'TGP' }, package: PKG },
        },
      };
    });
    await renderEditor();
    await screen.findByTestId('featured-list-missing');
    expect(screen.getByTestId('featured-coach-coach-b').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('featured-pitch').props.value).toBe('Saved pitch');
    expect(screen.getByTestId('featured-cap-roman_min_hours_between').props.value).toBe('48');
  });

  it('a load failure says what happened and offers Try again', async () => {
    mockGet.mockRejectedValue(httpError(403));
    await renderEditor();
    expect((await screen.findByTestId('featured-load-error')).props.children).toBe('Only the owner account can open the featured coach settings.');
    expect(screen.getByTestId('featured-retry')).toBeTruthy();
  });

  it('pitch price reads like the owner wrote it', () => {
    expect(pitchPrice(PKG)).toBe('$49/mo');
    expect(pitchPrice({ ...PKG, amount_cents: 30000, interval_count: 3 })).toBe('$300/3 mo');
    expect(pitchPrice({ ...PKG, billing_type: 'one_time', interval: null, amount_cents: 9950 })).toBe('$99.50');
  });
});
