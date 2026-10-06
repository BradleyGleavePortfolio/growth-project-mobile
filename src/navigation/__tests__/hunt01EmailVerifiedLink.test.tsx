/**
 * HUNT-01-124 (B-HUNT01-1): the sign-up confirmation email returns to
 * `tgp://verified` (backend `SUPABASE_REDIRECT_URL` default). The app had no
 * route for it, so tapping Confirm opened the app on whatever screen was
 * last shown (Welcome after a cold start) with nothing saying the email was
 * confirmed or what to do next. These tests drive the real URLs Supabase
 * sends through the linking config and render the landing screen.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../AuthNavigator', () => () => null);
jest.mock('../ClientNavigator', () => () => null);
jest.mock('../CoachNavigator', () => () => null);
jest.mock('../OnboardingNavigator', () => () => null);
jest.mock('../LeanOnboardingNavigator', () => () => null);
jest.mock('../../components/OfflineBanner', () => () => null);
jest.mock('../../screens/client/Day1WinScreen', () => () => null);
jest.mock('../../services/support/crisp.service', () => ({
  initCrisp: jest.fn(),
  syncCrispIdentity: jest.fn(),
}));
jest.mock('../../services/firstWinApi', () => ({
  firstWinApi: { getStatus: jest.fn(), markComplete: jest.fn() },
  WinType: {},
}));
jest.mock('../../services/authActions', () => ({ signOut: jest.fn() }));
jest.mock('../../hooks/useLeanOnboardingReconcile', () => ({
  useLeanOnboardingReconcile: () => {},
}));
jest.mock('../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../screenshots', () => ({ isScreenshotMode: () => false }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { linking } from '../RootNavigator';
import EmailVerifiedScreen from '../../screens/auth/EmailVerifiedScreen';

function resolve(url: string) {
  let stripped = url;
  for (const p of linking.prefixes) {
    if (url.startsWith(p)) {
      stripped = url.slice(p.length);
      break;
    }
  }
  if (!stripped.startsWith('/')) stripped = '/' + stripped;
  return linking.getStateFromPath!(stripped, linking.config as never);
}

function findRoute(
  state: ReturnType<typeof resolve> | null | undefined,
  name: string,
): { name: string; params?: Record<string, unknown> } | undefined {
  if (!state) return undefined;
  for (const route of state.routes ?? []) {
    if (route.name === name) return route as never;
    const child = (route as { state?: typeof state }).state;
    if (child) {
      const nested = findRoute(child, name);
      if (nested) return nested;
    }
  }
  return undefined;
}

describe('confirmation link routing (tgp://verified)', () => {
  it('routes the success redirect to EmailVerified and never carries the session tokens', () => {
    const route = findRoute(
      resolve('tgp://verified#access_token=AAA.BBB.CCC&expires_in=3600&refresh_token=RRR&token_type=bearer&type=signup'),
      'EmailVerified',
    );
    expect(route).toBeDefined();
    expect(route?.params).toEqual({ status: 'confirmed' });
    expect(JSON.stringify(route)).not.toMatch(/AAA|RRR|access_token|refresh_token/);
  });

  it('routes a bare tgp://verified to EmailVerified', () => {
    const route = findRoute(resolve('tgp://verified'), 'EmailVerified');
    expect(route).toBeDefined();
    expect(route?.params).toEqual({ status: 'confirmed' });
  });

  it('routes an expired or already-used link to the link-problem state', () => {
    const route = findRoute(
      resolve(
        'tgp://verified#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
      'EmailVerified',
    );
    expect(route?.params).toEqual({ status: 'link_problem' });
  });

  it('treats a query-string error the same way', () => {
    const route = findRoute(resolve('tgp://verified?error=access_denied'), 'EmailVerified');
    expect(route?.params).toEqual({ status: 'link_problem' });
  });

  it('leaves the reset-password route and its tokens unchanged', () => {
    const route = findRoute(
      resolve('tgp://reset-password#access_token=A&refresh_token=B&type=recovery'),
      'ResetPassword',
    );
    expect(route?.params).toMatchObject({ access_token: 'A', refresh_token: 'B' });
  });
});

function navWith(routes: string[]) {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    getState: () => ({ index: routes.length - 1, routes: routes.map((name) => ({ name })) }),
  };
}

describe('EmailVerifiedScreen', () => {
  it('after a cold start, says the email is confirmed and opens Login', async () => {
    const navigation = navWith(['EmailVerified']);
    const view = await render(
      <EmailVerifiedScreen
        navigation={navigation as never}
        route={{ key: 'k', name: 'EmailVerified', params: { status: 'confirmed' } } as never}
      />,
    );
    expect(view.getByText('Email confirmed')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Sign in'));
    expect(navigation.replace).toHaveBeenCalledWith('Login');
  });

  it('when the sign-up screen is still open, goes back to it so I verified my email finishes sign-in', async () => {
    const navigation = navWith(['Welcome', 'CreateAccount', 'EmailVerified']);
    const view = await render(
      <EmailVerifiedScreen
        navigation={navigation as never}
        route={{ key: 'k', name: 'EmailVerified', params: { status: 'confirmed' } } as never}
      />,
    );
    expect(view.getByText(/I verified my email/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Continue'));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('explains an expired or used link and offers sign-in and support', async () => {
    const navigation = navWith(['EmailVerified']);
    const view = await render(
      <EmailVerifiedScreen
        navigation={navigation as never}
        route={{ key: 'k', name: 'EmailVerified', params: { status: 'link_problem' } } as never}
      />,
    );
    expect(view.getByText('This link has expired or was already used')).toBeTruthy();
    expect(view.queryByText('Email confirmed')).toBeNull();
    await fireEvent.press(view.getByLabelText('Contact support'));
    expect(navigation.navigate).toHaveBeenCalledWith('SupportInbox');
    await fireEvent.press(view.getByLabelText('Sign in'));
    expect(navigation.replace).toHaveBeenCalledWith('Login');
  });

  it('copy has no first person, exclamation marks or emojis', async () => {
    for (const status of ['confirmed', 'link_problem'] as const) {
      const view = await render(
        <EmailVerifiedScreen
          navigation={navWith(['EmailVerified']) as never}
          route={{ key: 'k', name: 'EmailVerified', params: { status } } as never}
        />,
      );
      const text = JSON.stringify(view.toJSON());
      expect(text).not.toMatch(/\b(I'm|we|We|our|Our|us)\b|!/);
      expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      view.unmount();
    }
  });
});
