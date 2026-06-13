/**
 * coachTeamP0Blockers.test
 *
 * Regression tests for the five P0 blockers identified in the
 * Coach Team Management audit (audit-coach-team.md). Each block here maps
 * 1:1 to one of the P0 IDs from the audit so a future regression is easy
 * to trace.
 *
 *   P0-1  TeamStack tab must be gated on head_coach role.
 *   P0-2  Sub-coach invite modal must dedupe + block double-submit.
 *   P0-3  Sub-coach invite modal must clamp `maxClients` ≤ remaining seats.
 *   P0-4  Revoke flows must distinguish 409 (race) and surface a structured
 *         message.
 *   P0-5  CoachInvitesScreen.load must surface load errors with retry,
 *         never the empty-state.
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert } from 'react-native';
import {
  render,
  fireEvent,
  waitFor,
  act,
  renderHook,
} from '@testing-library/react-native';

// ── Shared theme / haptics / clipboard stubs ─────────────────────────────────

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary: '#000',
      primaryLight: '#000',
      primaryPale: '#000',
      primaryDark: '#000',
      accent: '#000',
      background: '#000',
      surface: '#000',
      surfaceElevated: '#000',
      textPrimary: '#000',
      textSecondary: '#000',
      textMuted: '#000',
      textOnPrimary: '#fff',
      border: '#000',
      divider: '#000',
      success: '#0a0',
      warning: '#aa0',
      error: '#a00',
      info: '#00a',
      streak: '#aa0',
      primaryTint: '#000',
    },
  }),
  ThemeColors: {},
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
  errorTap: jest.fn(),
  selectionTap: jest.fn(),
}));

// ── Controllable mocks for subCoachApi, coachTeamApi, invites, userCache ─────

const mockSubCoachInvite = jest.fn();
const mockSubCoachRevoke = jest.fn();
jest.mock('../api/subCoachApi', () => ({
  subCoachApi: {
    invite: (...a: unknown[]) => mockSubCoachInvite(...a),
    revoke: (...a: unknown[]) => mockSubCoachRevoke(...a),
    listSubCoaches: jest.fn(),
    getSubCoach: jest.fn(),
    getAnalytics: jest.fn(),
    reassignClient: jest.fn(),
  },
}));

const mockGetMembers = jest.fn();
jest.mock('../api/coachTeamApi', () => ({
  coachTeamApi: {
    getProfile: jest.fn(),
    getMembers: (...a: unknown[]) => mockGetMembers(...a),
    upsertProfile: jest.fn(),
  },
}));

const mockListInvites = jest.fn();
const mockRevokeInvite = jest.fn();
const mockResendInvite = jest.fn();
jest.mock('../api/invites', () => ({
  invitesApi: {
    listInvites: (...a: unknown[]) => mockListInvites(...a),
    revokeInvite: (...a: unknown[]) => mockRevokeInvite(...a),
    resendInvite: (...a: unknown[]) => mockResendInvite(...a),
  },
}));

const mockReadUserCache = jest.fn();
jest.mock('../lib/userCache', () => ({
  readUserCache: (...a: unknown[]) => mockReadUserCache(...a),
}));

jest.mock('../utils/authEvents', () => ({
  authEvents: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));

// Pull the screens / hook AFTER the mocks above are registered.
import SubCoachInviteModal from '../screens/coach/SubCoachInviteModal';
import CoachInvitesScreen from '../screens/coach/CoachInvitesScreen';
import { useCoachRoleType } from '../hooks/useCoachRoleType';

beforeEach(() => {
  mockSubCoachInvite.mockReset();
  mockSubCoachRevoke.mockReset();
  mockGetMembers.mockReset();
  mockListInvites.mockReset();
  mockRevokeInvite.mockReset();
  mockResendInvite.mockReset();
  mockReadUserCache.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-1 — TeamStack tab is gated on head_coach role
// ─────────────────────────────────────────────────────────────────────────────

describe('P0-1: TeamStack role gating in CoachNavigator', () => {
  it('useCoachRoleType returns head_coach when current user is in members as head_coach', async () => {
    mockReadUserCache.mockResolvedValue({
      id: 'u-head',
      email: 'h@ex.com',
      role: 'coach',
    });
    mockGetMembers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'u-head',
          name: 'Head',
          email: 'h@ex.com',
          role: 'head_coach',
          assigned_clients: 0,
          max_clients: 50,
          created_at: '',
        },
      ],
    });

    const { result } = await renderHook(() => useCoachRoleType());
    await waitFor(() => expect(result.current).toBe('head_coach'));
  });

  it('useCoachRoleType returns sub_coach when current user is in members as sub_coach', async () => {
    mockReadUserCache.mockResolvedValue({
      id: 'u-sub',
      email: 's@ex.com',
      role: 'coach',
    });
    mockGetMembers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'u-head',
          name: 'Head',
          email: 'h@ex.com',
          role: 'head_coach',
          assigned_clients: 0,
          max_clients: 50,
          created_at: '',
        },
        {
          id: 'u-sub',
          name: 'Sub',
          email: 's@ex.com',
          role: 'sub_coach',
          assigned_clients: 0,
          max_clients: 25,
          created_at: '',
        },
      ],
    });

    const { result } = await renderHook(() => useCoachRoleType());
    await waitFor(() => expect(result.current).toBe('sub_coach'));
  });

  it('useCoachRoleType fails closed (returns unknown) when members endpoint is unavailable', async () => {
    mockReadUserCache.mockResolvedValue({
      id: 'u-x',
      email: 'x@ex.com',
      role: 'coach',
    });
    mockGetMembers.mockResolvedValue({ ok: false, reason: 'not_configured' });

    const { result } = await renderHook(() => useCoachRoleType());
    // Wait one tick to let the effect run, then assert it never escaped 'unknown'.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current).toBe('unknown');
  });

  it('CoachNavigator source only mounts the TeamStack tab when showTeamTab is true', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'navigation', 'CoachNavigator.tsx'),
      'utf8',
    );
    expect(src).toMatch(/showTeamTab && \(/);
    expect(src).toContain('useCoachRoleType');
    expect(src).toContain("coachRoleType === 'head_coach'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-2 + P0-3 — SubCoachInviteModal hardening
// ─────────────────────────────────────────────────────────────────────────────

describe('P0-2 + P0-3: SubCoachInviteModal dedupe, double-submit guard, seat clamp', () => {
  async function mountModal(
    props: {
      existingEmails?: string[];
      remainingSeats?: number;
    } = {},
  ) {
    return await render(
      <SubCoachInviteModal
        visible
        onDismiss={() => undefined}
        onInvited={() => undefined}
        existingEmails={props.existingEmails}
        remainingSeats={props.remainingSeats}
      />,
    );
  }

  it('P0-2: rejects a duplicate email already present on the roster', async () => {
    const { getByTestId, getByLabelText, queryByText } = await mountModal({
      existingEmails: ['Existing@ex.com'],
    });
    await fireEvent.changeText(getByLabelText('Sub-coach email'), 'existing@ex.com');
    await act(async () => {
      await fireEvent.press(getByTestId('sub-coach-invite-submit'));
    });
    await waitFor(() =>
      expect(queryByText(/already exists on your team/i)).not.toBeNull(),
    );
    expect(mockSubCoachInvite).not.toHaveBeenCalled();
  });

  it('P0-2: blocks a double-tap mid-flight so only one Stripe seat is provisioned', async () => {
    let resolveFn: ((v: unknown) => void) | undefined;
    mockSubCoachInvite.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    const { getByTestId, getByLabelText } = await mountModal();
    await fireEvent.changeText(getByLabelText('Sub-coach email'), 'a@ex.com');

    // First tap — kicks off the request.
    await act(async () => {
      await fireEvent.press(getByTestId('sub-coach-invite-submit'));
    });
    // Second and third taps before the first resolves.
    await act(async () => {
      await fireEvent.press(getByTestId('sub-coach-invite-submit'));
      await fireEvent.press(getByTestId('sub-coach-invite-submit'));
    });

    expect(mockSubCoachInvite).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFn?.({
        data: {
          inviteId: 'i1',
          email: 'a@ex.com',
          inviteUrl: 'https://x',
          expires_at: '',
        },
      });
    });
  });

  it('P0-2: surfaces a structured message when the backend returns 409 (dedupe race)', async () => {
    mockSubCoachInvite.mockRejectedValueOnce({
      response: { status: 409, data: { message: 'duplicate' } },
    });

    const { getByTestId, getByLabelText, findByText } = await mountModal();
    await fireEvent.changeText(getByLabelText('Sub-coach email'), 'a@ex.com');
    await fireEvent.press(getByTestId('sub-coach-invite-submit'));

    await findByText(/already has a pending or active sub-coach invite/i);
  });

  it('P0-3: refuses maxClients > remainingSeats and names the headroom', async () => {
    const { getByTestId, getByLabelText, findByText } = await mountModal({
      remainingSeats: 5,
    });
    await fireEvent.changeText(getByLabelText('Sub-coach email'), 'a@ex.com');
    await fireEvent.changeText(getByLabelText('Max clients'), '99999');
    await fireEvent.press(getByTestId('sub-coach-invite-submit'));
    await findByText(/Only 5 seats available on your plan/i);
    expect(mockSubCoachInvite).not.toHaveBeenCalled();
  });

  it('P0-3: refuses any positive maxClients when remainingSeats is 0', async () => {
    const { getByTestId, getByLabelText, findByText } = await mountModal({
      remainingSeats: 0,
    });
    await fireEvent.changeText(getByLabelText('Sub-coach email'), 'a@ex.com');
    await fireEvent.changeText(getByLabelText('Max clients'), '1');
    await fireEvent.press(getByTestId('sub-coach-invite-submit'));
    await findByText(/No seats available on your plan/i);
    expect(mockSubCoachInvite).not.toHaveBeenCalled();
  });

  it('P0-3: allows maxClients ≤ remainingSeats', async () => {
    mockSubCoachInvite.mockResolvedValueOnce({
      data: {
        inviteId: 'i1',
        email: 'a@ex.com',
        inviteUrl: 'https://x',
        expires_at: '',
      },
    });
    const { getByTestId, getByLabelText } = await mountModal({ remainingSeats: 10 });
    await fireEvent.changeText(getByLabelText('Sub-coach email'), 'a@ex.com');
    await fireEvent.changeText(getByLabelText('Max clients'), '5');
    await fireEvent.press(getByTestId('sub-coach-invite-submit'));
    await waitFor(() =>
      expect(mockSubCoachInvite).toHaveBeenCalledWith({
        email: 'a@ex.com',
        name: undefined,
        maxClients: 5,
      }),
    );
  });

  it('P0-3: skips the clamp when remainingSeats is undefined (unknown headroom)', async () => {
    mockSubCoachInvite.mockResolvedValueOnce({
      data: {
        inviteId: 'i1',
        email: 'a@ex.com',
        inviteUrl: 'https://x',
        expires_at: '',
      },
    });
    const { getByTestId, getByLabelText } = await mountModal();
    await fireEvent.changeText(getByLabelText('Sub-coach email'), 'a@ex.com');
    await fireEvent.changeText(getByLabelText('Max clients'), '99999');
    await fireEvent.press(getByTestId('sub-coach-invite-submit'));
    await waitFor(() => expect(mockSubCoachInvite).toHaveBeenCalled());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-4 — Revoke flows must handle 409
// ─────────────────────────────────────────────────────────────────────────────

describe('P0-4: revoke 409 handling', () => {
  it('CoachInvitesScreen source treats 409 as a refresh-and-message, not "Unknown error"', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'screens', 'coach', 'CoachInvitesScreen.tsx'),
      'utf8',
    );
    expect(src).toMatch(/status === 409/);
    expect(src).toMatch(/already accepted by someone else/i);
    // No raw "Unknown error" fallback for revoke any longer.
    const revokeCatchBlock = src.split('Revoke failed')[1] ?? '';
    expect(revokeCatchBlock).not.toMatch(/Unknown error/);
  });

  it('SubCoachDetailScreen source handles 409 distinctly from generic failure', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'screens', 'coach', 'SubCoachDetailScreen.tsx'),
      'utf8',
    );
    expect(src).toMatch(/status === 409/);
    expect(src).toMatch(/Already changed/);
    expect(src).toContain('errorMessage(');
  });

  it('CoachInvitesScreen — revoke handler triggers a list refresh on 409', async () => {
    mockListInvites
      .mockResolvedValueOnce([
        {
          id: 'i1',
          code: 'CODE',
          clientEmail: 'a@ex.com',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          lastEmailStatus: 'SENT',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'i1',
          code: 'CODE',
          clientEmail: 'a@ex.com',
          status: 'ACCEPTED',
          createdAt: new Date().toISOString(),
          lastEmailStatus: 'SENT',
        },
      ]);
    mockRevokeInvite.mockRejectedValueOnce({
      response: { status: 409, data: { message: 'already accepted' } },
    });

    const { getByTestId } = await render(
      <CoachInvitesScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never}
      />,
    );

    await waitFor(() => expect(mockListInvites).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByTestId('invite-revoke-i1')).toBeTruthy());

    const alertSpy = Alert.alert as unknown as jest.Mock;
    await fireEvent.press(getByTestId('invite-revoke-i1'));
    // 0: title, 1: message, 2: buttons array.
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{
      text: string;
      onPress?: () => Promise<void> | void;
    }>;
    const revokeBtn = buttons.find((b) => b.text === 'Revoke');
    await act(async () => {
      await revokeBtn?.onPress?.();
    });

    await waitFor(() => expect(mockListInvites).toHaveBeenCalledTimes(2));
    const allTitles = alertSpy.mock.calls.map((c) => c[0]);
    expect(allTitles).toContain('Already accepted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-5 — CoachInvitesScreen must surface load errors with retry, not empty
// ─────────────────────────────────────────────────────────────────────────────

describe('P0-5: CoachInvitesScreen load-error surfacing', () => {
  it('renders the error state (NOT the empty state) when the list fails to load', async () => {
    mockListInvites.mockRejectedValueOnce({
      response: { status: 500, data: { message: 'backend exploded' } },
    });

    const { getByTestId, queryByTestId } = await render(
      <CoachInvitesScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never}
      />,
    );

    await waitFor(() =>
      expect(getByTestId('coach-invites-error-state')).toBeTruthy(),
    );
    expect(queryByTestId('coach-invites-empty')).toBeNull();
    expect(getByTestId('coach-invites-error-state-retry')).toBeTruthy();
  });

  it('retry button re-invokes the loader and clears the error on success', async () => {
    mockListInvites
      .mockRejectedValueOnce({
        response: { status: 500, data: { message: 'backend exploded' } },
      })
      .mockResolvedValueOnce([]);

    const { getByTestId, queryByTestId } = await render(
      <CoachInvitesScreen
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never}
      />,
    );

    await waitFor(() =>
      expect(getByTestId('coach-invites-error-state-retry')).toBeTruthy(),
    );
    await act(async () => {
      await fireEvent.press(getByTestId('coach-invites-error-state-retry'));
    });

    await waitFor(() => expect(mockListInvites).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getByTestId('coach-invites-empty')).toBeTruthy());
    expect(queryByTestId('coach-invites-error-state')).toBeNull();
  });

  it('source no longer swallows load errors with bare console.error', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'screens', 'coach', 'CoachInvitesScreen.tsx'),
      'utf8',
    );
    const loadFn = src.split('const load = useCallback')[1]?.split('}, []);')[0] ?? '';
    expect(loadFn).toContain('setLoadError');
    expect(loadFn).not.toMatch(/catch \(err\) \{\s*console\.error/);
  });
});
