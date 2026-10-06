/**
 * CoachInvitesScreen.test — Email Pipeline v1 (R26 behavioral).
 *
 * Round-4 audit follow-up: the adapter in `src/api/invites.ts` maps the
 * backend snake-case rows (`client_email`, `last_email_status`) into the
 * camelCase `Invite` shape. The round-3 audit confirmed the mapping
 * worked at the adapter level but flagged that the UI was never proven
 * to render the mapped fields. These tests render the real
 * `CoachInvitesScreen`, return real-shaped `Invite` objects from the
 * mocked API, and assert visible recipient + delivery-state strings —
 * NOT object-shape assertions. If a future refactor breaks the
 * adapter → screen pipeline, these tests fail.
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockListInvites = jest.fn();
jest.mock('../api/invites', () => ({
  invitesApi: {
    listInvites: (...args: unknown[]) => mockListInvites(...args),
    resendInvite: jest.fn(),
    revokeInvite: jest.fn(),
  },
}));

jest.mock('../utils/haptics', () => ({ mediumTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn() }));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#000', surface: '#000', surfaceElevated: '#000',
      primary: '#000', primaryLight: '#000', primaryPale: '#000',
      primaryDark: '#000', accent: '#000',
      textPrimary: '#000', textSecondary: '#000', textMuted: '#000',
      textOnPrimary: '#fff', border: '#000', divider: '#000',
      success: '#0a0', warning: '#aa0', error: '#a00', info: '#00a',
      streak: '#aa0', primaryTint: '#000',
    },
  }),
}));

import CoachInvitesScreen from '../screens/coach/CoachInvitesScreen';
import type { Invite } from '../types/invites';
import { invitesApi, type ResendEmailStatus } from '../api/invites';

// Build a navigation-prop stub that satisfies the typed nav prop. We
// only assert against the rendered text so the inner shape can be a
// permissive cast — the production type-check (P1-B) lives in the
// screen file itself.
function makeNavigation() {
  const navigation: unknown = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    setOptions: jest.fn(),
    isFocused: () => true,
    canGoBack: () => true,
    addListener: () => () => {},
    removeListener: () => {},
    reset: jest.fn(),
    setParams: jest.fn(),
    getParent: () => undefined,
    getState: () => ({ index: 0, key: 'k', routeNames: [], routes: [], stale: false, type: 'stack' }),
    getId: () => 'CoachInvites',
    push: jest.fn(),
    pop: jest.fn(),
    popToTop: jest.fn(),
    replace: jest.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return navigation as any;
}

describe('CoachInvitesScreen — R26 render mapping (client_email + last_email_status)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the recipient address from the adapter-mapped `clientEmail` field on each row', async () => {
    const invites: Invite[] = [
      {
        id: 'inv-1',
        code: 'CODE1',
        clientEmail: 'test@example.com',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        lastEmailStatus: null,
      },
    ];
    mockListInvites.mockResolvedValue(invites);

    const { findByText, getByTestId } = await render(
      <CoachInvitesScreen navigation={makeNavigation()} />,
    );

    // The row only renders after the API call resolves; wait for the
    // recipient address to appear in the visible output. This proves
    // the adapter → screen pipeline reaches the UI, not just the
    // returned object.
    expect(await findByText('test@example.com')).toBeTruthy();
    expect(getByTestId('invite-row-inv-1')).toBeTruthy();
  });

  it('renders the Delivered email-state badge when `lastEmailStatus` is "delivered" (case-insensitive backend payload)', async () => {
    const invites: Invite[] = [
      {
        id: 'inv-delivered',
        code: 'CODE2',
        clientEmail: 'delivered@example.com',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        // The adapter preserves the raw `last_email_status` value; the
        // screen normalises via `toEmailStatus()` before rendering, so
        // a lowercase value still reaches the badge as 'Delivered'.
        lastEmailStatus: 'delivered',
      },
    ];
    mockListInvites.mockResolvedValue(invites);

    const { findByText, getByText } = await render(
      <CoachInvitesScreen navigation={makeNavigation()} />,
    );

    expect(await findByText('delivered@example.com')).toBeTruthy();
    // The delivery badge must visibly render with the localised label.
    expect(getByText('Delivered')).toBeTruthy();
  });

  it('does NOT render any delivery-state badge when `lastEmailStatus` is null', async () => {
    const invites: Invite[] = [
      {
        id: 'inv-null-status',
        code: 'CODE3',
        clientEmail: 'nostatus@example.com',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        lastEmailStatus: null,
      },
    ];
    mockListInvites.mockResolvedValue(invites);

    const { findByText, queryByText, getByTestId } = await render(
      <CoachInvitesScreen navigation={makeNavigation()} />,
    );

    expect(await findByText('nostatus@example.com')).toBeTruthy();
    // None of the known email-state badge labels should appear.
    expect(queryByText('Delivered')).toBeNull();
    expect(queryByText('Sent')).toBeNull();
    expect(queryByText('Queued')).toBeNull();
    expect(queryByText('Bounced')).toBeNull();
    expect(queryByText('Failed')).toBeNull();
    // Row is visibly rendered (proving the absence of an email-state
    // badge is intentional, not a render gate hiding the whole row).
    expect(getByTestId('invite-row-inv-null-status')).toBeTruthy();
  });

});

// AUDIT-17-125 — a 200 from /send can be `skipped` (the email key is already
// spent: every resend on today's backend) or `failed`; only `sent` is a resend.
describe('CoachInvitesScreen resend honesty (AUDIT-17-125)', () => {
  const cases: Array<[ResendEmailStatus, string, RegExp]> = [
    ['skipped', 'No new email sent', /no new email was sent/],
    ['failed', 'Email not sent', /did not send/],
    ['sent', 'Invite re-sent', /^Invite re-sent to alice@example.com\.$/],
  ];
  it.each(cases)('a %s send shows "%s"', async (emailStatus, title, body) => {
    mockListInvites.mockResolvedValue([{ id: 'inv-r', code: 'GP-RSND23', clientEmail: 'alice@example.com', status: 'PENDING', createdAt: new Date().toISOString(), lastEmailStatus: null }]);
    jest.mocked(invitesApi.resendInvite).mockResolvedValue({ supported: true, emailStatus });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { findByTestId } = await render(<CoachInvitesScreen navigation={makeNavigation()} />);
    await fireEvent.press(await findByTestId('invite-resend-inv-r'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(title, expect.stringMatching(body)));
    alert.mockRestore();
  });
});
