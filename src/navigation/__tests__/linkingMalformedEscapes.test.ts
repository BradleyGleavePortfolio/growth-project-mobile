// DEEP-LINK-GUARD-M: an incoming link whose %-encoding does not decode is
// refused before the navigator reads it (Dependabot alerts 78 and 28), and
// every real link routes exactly as on main. Made-up values only.

// RootNavigator pulls in a tree of native/Expo dependencies it doesn't need
// for the linking config alone. Mock the components it renders so importing
// `linking` is cheap and side-effect-free (copied from linkingConfig.test.ts).
jest.mock('../AuthNavigator', () => () => null);
jest.mock('../ClientNavigator', () => () => null);
jest.mock('../CoachNavigator', () => () => null);
jest.mock('../OnboardingNavigator', () => () => null);
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
// R9: the navigator's own parser, wrapped in a pass-through spy.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    __esModule: true,
    ...actual,
    getStateFromPath: jest.fn((...args: unknown[]) => actual.getStateFromPath(...args)),
  };
});

import { getStateFromPath } from '@react-navigation/native';
import { linking } from '../RootNavigator';

const parserSpy = jest.mocked(getStateFromPath);

function resolve(url: string) {
  // Strip the prefix the way React Navigation does before calling our
  // getStateFromPath. RN's deep-link receiver removes the scheme/host prefix
  // and feeds the path-and-beyond into the override.
  const prefixes = linking.prefixes;
  let stripped = url;
  for (const p of prefixes) {
    if (url.startsWith(p)) {
      stripped = url.slice(p.length);
      break;
    }
  }
  if (!stripped.startsWith('/')) stripped = '/' + stripped;
  return linking.getStateFromPath!(stripped, linking.config as never);
}

// One %-escape the built-in decoder rejects, and a lone lead byte.
const MALFORMED = '%ff';
const MALFORMED_LEAD = '%C2';

const REFUSED: Array<[string, string]> = [
  ['R1 welcome', `tgp://welcome?x=${MALFORMED}`],
  ['R2 login', `tgp://login?x=${MALFORMED}`],
  ['R3 sign-in return', `tgp://auth/callback?code=${MALFORMED}&state=s1`],
  ['R4 join', `https://app.trygrowthproject.com/join/GP-ABC123?ref=${MALFORMED_LEAD}`],
  ['R5 invite accept', `tgp://invite/accept/tok_abc123?x=${MALFORMED}`],
  ['R6 password reset query', `tgp://reset-password?x=${MALFORMED}`],
  [
    'R7 password reset fragment',
    `tgp://reset-password#access_token=${MALFORMED}&refresh_token=r1&type=recovery`,
  ],
  ['R8 fragment after a query', `tgp://welcome?a=1#${MALFORMED}`],
  ['R10 after a second question mark', `tgp://join/GP-ABC123?ref=a?b=${MALFORMED}`],
];

type Routed = [string, string, unknown];

// Each literal is main's own output for the link (G7).
const ROUTED: Routed[] = [
  [
    'G1 password reset',
    'tgp://reset-password#access_token=hdr1.body2.sig3&expires_in=3600&refresh_token=r1Ab&token_type=bearer&type=recovery',
    {
      routes: [
        {
          name: 'ResetPassword',
          path: '/reset-password?access_token=hdr1.body2.sig3&expires_in=3600&refresh_token=r1Ab&token_type=bearer&type=recovery',
          params: {
            access_token: 'hdr1.body2.sig3',
            expires_in: '3600',
            refresh_token: 'r1Ab',
            token_type: 'bearer',
            type: 'recovery',
          },
        },
      ],
    },
  ],
  [
    'G1 password reset with a query',
    'tgp://reset-password?foo=1#access_token=A',
    {
      routes: [
        {
          name: 'ResetPassword',
          path: '/reset-password?foo=1&access_token=A',
          params: { access_token: 'A', foo: '1' },
        },
      ],
    },
  ],
  [
    'G2 sign-in return',
    'tgp://auth/callback?code=4%2F0Ab_c-D&state=s1',
    {
      routes: [
        {
          name: 'AuthCallback',
          path: '/auth/callback?code=4%2F0Ab_c-D&state=s1',
          params: { code: '4/0Ab_c-D', state: 's1' },
        },
      ],
    },
  ],
  [
    'G3 invite accept',
    'tgp://invite/accept/tok_abc123',
    {
      routes: [
        { name: 'AcceptInvite', params: { token: 'tok_abc123' }, path: '/invite/accept/tok_abc123' },
      ],
    },
  ],
  [
    'G3 invite accept universal link',
    'https://app.trygrowthproject.com/invite/accept/tok%2Babc',
    {
      routes: [
        { name: 'AcceptInvite', params: { token: 'tok+abc' }, path: '/invite/accept/tok%2Babc' },
      ],
    },
  ],
  [
    'G4 join universal link',
    'https://app.trygrowthproject.com/join/GP-ABC123',
    {
      routes: [
        { name: 'CreateAccount', params: { invite_code: 'GP-ABC123' }, path: '/join/GP-ABC123' },
      ],
    },
  ],
  [
    'G4 join with an encoded value',
    'tgp://join/GP-ABC123?ref=Jos%C3%A9+Q',
    {
      routes: [
        {
          name: 'CreateAccount',
          params: { invite_code: 'GP-ABC123', ref: 'José Q' },
          path: '/join/GP-ABC123?ref=Jos%C3%A9+Q',
        },
      ],
    },
  ],
  [
    'G5 payment return',
    'com.growthproject.app://checkout/success?session_id=cs_test_a1B2c3',
    {
      routes: [
        {
          name: 'MoreTab',
          state: {
            routes: [
              {
                name: 'CheckoutReturn',
                params: { outcome: 'success', session_id: 'cs_test_a1B2c3' },
                path: '/checkout/success?session_id=cs_test_a1B2c3',
              },
            ],
          },
        },
      ],
    },
  ],
  [
    'G5 payment cancel',
    'com.growthproject.app://checkout/cancel',
    {
      routes: [
        {
          name: 'MoreTab',
          state: {
            routes: [{ name: 'CheckoutReturn', params: { outcome: 'cancel' }, path: '/checkout/cancel' }],
          },
        },
      ],
    },
  ],
  [
    'G6 email confirmation',
    'tgp://verified#access_token=A&refresh_token=B',
    { routes: [{ name: 'EmailVerified', path: 'verified?status=confirmed', params: { status: 'confirmed' } }] },
  ],
  [
    'G6 email confirmation link problem',
    'tgp://verified#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    {
      routes: [
        { name: 'EmailVerified', path: 'verified?status=link_problem', params: { status: 'link_problem' } },
      ],
    },
  ],
  [
    'G6 email confirmation with malformed %-encoding',
    `tgp://verified#${MALFORMED}`,
    { routes: [{ name: 'EmailVerified', path: 'verified?status=confirmed', params: { status: 'confirmed' } }] },
  ],
  [
    'G9 multi-byte escapes beside & and =',
    'tgp://join/GP-ABC123?a=%C3%A9&b=%E2%82%AC=x',
    {
      routes: [
        {
          name: 'CreateAccount',
          params: { invite_code: 'GP-ABC123', a: 'é', b: '€=x' },
          path: '/join/GP-ABC123?a=%C3%A9&b=%E2%82%AC=x',
        },
      ],
    },
  ],
  [
    'G9 plus, empty value and repeated key',
    'tgp://join/GP-ABC123?ref=a+b&empty=&k=1&k=2',
    {
      routes: [
        {
          name: 'CreateAccount',
          params: { invite_code: 'GP-ABC123', empty: '', k: ['1', '2'], ref: 'a b' },
          path: '/join/GP-ABC123?ref=a+b&empty=&k=1&k=2',
        },
      ],
    },
  ],
  [
    'G9 escaped separators',
    'tgp://join/GP-ABC123?ref=a%26b%3Dc%2F%2B',
    {
      routes: [
        {
          name: 'CreateAccount',
          params: { invite_code: 'GP-ABC123', ref: 'a&b=c/+' },
          path: '/join/GP-ABC123?ref=a%26b%3Dc%2F%2B',
        },
      ],
    },
  ],
  [
    'G9 second question mark',
    'tgp://join/GP-ABC123?ref=a?b=c',
    {
      routes: [
        {
          name: 'CreateAccount',
          params: { invite_code: 'GP-ABC123', ref: 'a' },
          path: '/join/GP-ABC123?ref=a?b=c',
        },
      ],
    },
  ],
  [
    'G9 fragment after a query',
    'tgp://welcome?a=1#top',
    { routes: [{ name: 'Welcome', path: '/welcome?a=1#top', params: { a: '1#top' } }] },
  ],
  ['G9 fragment on a non-reset path', 'tgp://welcome#top', undefined],
  ['G9 sign-in return with a fragment', 'tgp://auth/callback#access_token=A&refresh_token=B', undefined],
  ['G9 welcome', 'tgp://welcome', { routes: [{ name: 'Welcome', path: '/welcome' }] }],
  ['G9 login', 'tgp://login', { routes: [{ name: 'Login', path: '/login' }] }],
];

describe('links with malformed %-encoding are refused before the navigator reads them', () => {
  beforeEach(() => {
    parserSpy.mockClear();
  });

  it.each(REFUSED)('%s: a link with malformed %%-encoding is refused', (_id, url) => {
    const refused = resolve(url) === undefined;
    expect(refused).toBe(true);
  });

  it('R9: the navigator parser never receives a link with malformed %-encoding', () => {
    for (const [, url] of REFUSED) resolve(url);
    const parserCalled = parserSpy.mock.calls.length > 0;
    expect(parserCalled).toBe(false);
  });
});

describe('every real link routes exactly as on main', () => {
  it.each(ROUTED)('%s routes as on main', (_id, url, expected) => {
    expect(resolve(url)).toEqual(expected);
  });

  it('G5: payment return links stay with the app link router', () => {
    for (const url of [
      'com.growthproject.app://checkout/success?session_id=cs_test_a1B2c3',
      'com.growthproject.app://checkout/cancel',
    ]) {
      expect(linking.filter!(url)).toBe(false);
    }
  });
});
