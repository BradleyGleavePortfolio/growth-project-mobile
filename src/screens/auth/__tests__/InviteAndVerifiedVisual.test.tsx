import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { radius, typography } from '../../../theme/tokens';
const mockAccept = jest.fn(), mockSession = jest.fn();
jest.mock('../../../api/invites', () => ({ invitesApi: { acceptInvite: (...a: unknown[]) => mockAccept(...a) } }));
jest.mock('../../../services/secureStorage', () => ({ secureStorage: { getItem: () => mockSession() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../../../constants/colors').default }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import AcceptInviteScreen from '../AcceptInviteScreen';
import EmailVerifiedScreen from '../EmailVerifiedScreen';

type InviteProps = React.ComponentProps<typeof AcceptInviteScreen>;
type VerifiedProps = React.ComponentProps<typeof EmailVerifiedScreen>;
function nav(routes = ['EmailVerified']) {
  return { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(),
    getState: jest.fn().mockReturnValue({ index: routes.length - 1, routes: routes.map(name => ({ name })) }) };
}
function invite(navigation = nav()) {
  const stub: Partial<InviteProps['navigation']> = navigation;
  return <AcceptInviteScreen navigation={stub as InviteProps['navigation']}
    route={{ key: 'invite', name: 'AcceptInvite', params: { token: 'GP-TEST1' } }} />;
}
function verified(navigation = nav(), status: 'confirmed' | 'link_problem' = 'confirmed') {
  const stub: Partial<VerifiedProps['navigation']> = navigation;
  return <EmailVerifiedScreen navigation={stub as VerifiedProps['navigation']}
    route={{ key: 'verified', name: 'EmailVerified', params: { status } }} />;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue(null);
  mockAccept.mockResolvedValue({ accepted: true, coachName: 'Coach Avery', email: 'member@example.test' });
});

describe('Invite copy and frozen action parity', () => {
  it.each([null, 'session'])('never equates invite validation with attachment (session=%s)', async session => {
    mockSession.mockResolvedValue(session);
    const navigation = nav(), view = await render(invite(navigation));
    expect(await view.findByText('Invite ready')).toBeTruthy();
    expect(view.getByText('Coach Avery')).toBeTruthy();
    expect(view.queryByText(/linked to|You're in/)).toBeNull();
    const label = session ? 'Continue to app' : 'Sign in';
    await fireEvent.press(view.getByLabelText(label));
    expect(navigation.navigate).toHaveBeenCalledWith(...(session
      ? ['Welcome'] : ['Login', { email: 'member@example.test' }]));
    if (!session) {
      await fireEvent.press(view.getByLabelText('Create account'));
      expect(navigation.navigate).toHaveBeenCalledWith('CreateAccount', {
        invite_code: 'GP-TEST1', email: 'member@example.test',
      });
    }
  });
  it('no coach name stays neutral and creates no invented coach', async () => {
    mockAccept.mockResolvedValue({ accepted: true });
    const view = await render(invite());
    expect(await view.findByText('This invite is ready to use.')).toBeTruthy();
    expect(view.queryByText('Coach Avery')).toBeNull();
    expect(view.queryByText(/linked to your coach/)).toBeNull();
  });
  it.each(['expired', 'already_accepted', 'invalid'])('%s keeps Welcome with an accurate label', async reason => {
    mockAccept.mockResolvedValue({ accepted: false, reason });
    const navigation = nav(), view = await render(invite(navigation));
    const button = await view.findByLabelText('Back to welcome');
    await fireEvent.press(button);
    expect(navigation.navigate).toHaveBeenCalledWith('Welcome');
  });
  it('network failure retains both Welcome and the retry effect', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAccept.mockRejectedValueOnce(new Error('Network unavailable'));
    const navigation = nav(), view = await render(invite(navigation));
    await fireEvent.press(await view.findByLabelText('Back to welcome'));
    expect(navigation.navigate).toHaveBeenCalledWith('Welcome');
    await fireEvent.press(view.getByLabelText('Try again'));
    expect(await view.findByText('Invite ready')).toBeTruthy();
    expect(mockAccept).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
  });
  it('loading is factual and success has one forest primary with a hairline secondary', async () => {
    mockAccept.mockReturnValueOnce(new Promise(() => {}));
    const loading = await render(invite());
    expect(loading.getByText('Checking your invite…')).toBeTruthy();
    await loading.unmount();
    const view = await render(invite());
    const primary = await view.findByTestId('accept-success-login');
    const secondary = view.getByTestId('accept-success-signup');
    // B-SMALLFIX-135: the rounded button token (12), never the old 4 pt literal.
    expect(StyleSheet.flatten(primary.props.style)).toMatchObject({ minHeight: 52, borderRadius: radius.button });
    expect(StyleSheet.flatten(secondary.props.style).backgroundColor).toBeUndefined();
    expect(StyleSheet.flatten(view.getByText('Coach Avery').props.style).fontFamily).toBe('CormorantGaramond_400Regular');
  });
});

describe('Email verification frozen action parity', () => {
  it('cold start retains confirmed copy and replaces Login', async () => {
    const navigation = nav(), view = await render(verified(navigation));
    expect(view.getByText('Email confirmed')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Sign in'));
    expect(navigation.replace).toHaveBeenCalledWith('Login');
    expect(StyleSheet.flatten(view.getByText('Sign in').props.style).textTransform).toBeUndefined();
  });
  it('the forest action uses radius.button on every state (B-SMALLFIX-135)', async () => {
    const confirmed = await render(verified());
    expect(confirmed.getByLabelText('Sign in')).toHaveStyle({ borderRadius: radius.button });
    await confirmed.unmount();
    const open = await render(verified(nav(['CreateAccount', 'EmailVerified'])));
    expect(open.getByLabelText('Continue')).toHaveStyle({ borderRadius: radius.button });
  });
  it('the title uses the theme title line height, so Android keeps its descenders (B-SMALL2-135)', async () => {
    const view = await render(verified(nav(), 'link_problem'));
    const title = StyleSheet.flatten(view.getByText('This link has expired or was already used').props.style);
    expect(title).toMatchObject({ fontSize: typography.h1.fontSize, lineHeight: typography.h1.lineHeight });
    expect(title.lineHeight).toBeGreaterThanOrEqual(1.2 * Number(title.fontSize));
  });
  it('open signup retains Continue and goes back', async () => {
    const navigation = nav(['CreateAccount', 'EmailVerified']), view = await render(verified(navigation));
    expect(view.getByText(/finish/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Continue'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
  it('link problem preserves Sign in and Contact support', async () => {
    const navigation = nav(), view = await render(verified(navigation, 'link_problem'));
    expect(view.getByText('This link has expired or was already used')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Sign in'));
    expect(navigation.replace).toHaveBeenCalledWith('Login');
    await fireEvent.press(view.getByLabelText('Contact support'));
    expect(navigation.navigate).toHaveBeenCalledWith('SupportInbox');
  });
});
