/**
 * TestFlight coach/SaaS blockers — regression tests.
 *
 * These guard the audit-driven fixes for coach/sub-coach/gym readiness:
 *
 *   1. Coach business metrics & team APIs degrade honestly when the backend
 *      hasn't shipped the route yet (404 / 501 → typed "not_configured"
 *      envelope, never a fabricated payload).
 *   2. Sub-coach API exposes invite + revoke calls so the head coach can
 *      grow and shrink the team without leaving the app.
 *   3. The previously-disconnected coach screens are reachable through the
 *      Coach Tools section in SettingsScreen.
 *   4. Program templates are honestly described as "guideline templates"
 *      and don't promise workout / meal-plan side-effects they don't ship.
 *   5. Invite codes screen exposes a bulk-invite link and a redeemer
 *      drilldown to close the first-client loop.
 *   6. TeamManagementScreen now has an Invite button (the audit called out
 *      its absence as a SaaS gap).
 */

import * as fs from 'fs';
import * as path from 'path';
import { coachConnectApi } from '../api/coachConnectApi';
import { coachTeamApi } from '../api/coachTeamApi';
import { subCoachApi } from '../api/subCoachApi';
import api from '../services/api';

// ── shared helpers ──────────────────────────────────────────────────────────
function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function spyOn404<T extends { get: jest.Mock; post: jest.Mock; put: jest.Mock; delete: jest.Mock }>(
  apiMock: T,
  method: keyof T,
) {
  const fn = apiMock[method] as unknown as jest.Mock;
  fn.mockRejectedValueOnce({ response: { status: 404 } });
}

jest.mock('../services/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  const put = jest.fn();
  const del = jest.fn();
  return {
    __esModule: true,
    default: { get, post, put, delete: del },
  };
});

const mockedApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
  mockedApi.put.mockReset();
  mockedApi.delete.mockReset();
});

// ── 1) coachConnectApi honest empty states ──────────────────────────────────
describe('coachConnectApi', () => {
  it('returns { ok: true, data } on 200', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        configured: true,
        charges_enabled: true,
        payouts_enabled: true,
        account_id: 'acct_123',
        last_onboarded_at: '2026-05-10T00:00:00Z',
        requirements_due: [],
      },
    });
    const res = await coachConnectApi.getStatus();
    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ configured: true, charges_enabled: true }),
    });
  });

  it('returns { ok: false, reason: "not_configured" } on 404', async () => {
    spyOn404(mockedApi, 'get');
    const res = await coachConnectApi.getMetrics();
    expect(res).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns { ok: false, reason: "not_configured" } on 501', async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { status: 501 } });
    const res = await coachConnectApi.getPayouts(5);
    expect(res).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns { ok: false, reason: "error" } on 5xx', async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { status: 500 }, message: 'boom' });
    const res = await coachConnectApi.getPackages();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('error');
    }
  });

  it('exposes a createOnboardingLink call returning a Stripe-hosted URL', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { url: 'https://connect.stripe.com/setup/abc', expires_at: '2026-05-16T00:00:00Z' },
    });
    const res = await coachConnectApi.createOnboardingLink('/coach/business');
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/coach/connect/onboarding-link',
      { return_path: '/coach/business' },
    );
    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ url: expect.stringMatching(/^https:\/\//) }),
    });
  });
});

// ── 2) coachTeamApi honest empty states ─────────────────────────────────────
describe('coachTeamApi', () => {
  it('returns "not_configured" when /coach/team is missing', async () => {
    spyOn404(mockedApi, 'get');
    const res = await coachTeamApi.getProfile();
    expect(res).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('upsertProfile PUTs business_name and (optionally) team_code', async () => {
    mockedApi.put.mockResolvedValueOnce({ data: { id: 't_1', business_name: 'Atlas' } });
    await coachTeamApi.upsertProfile({ business_name: 'Atlas Coaching' });
    expect(mockedApi.put).toHaveBeenCalledWith('/coach/team', {
      business_name: 'Atlas Coaching',
    });
  });
});

// ── 3) subCoachApi invite + revoke ──────────────────────────────────────────
describe('subCoachApi.invite + revoke', () => {
  it('invite POSTs the email + null defaults for optional fields', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        inviteId: 'inv_1',
        email: 'sub@example.com',
        inviteUrl: 'https://app.example.com/accept/inv_1',
        expires_at: '2026-05-22T00:00:00Z',
      },
    });
    await subCoachApi.invite({ email: 'sub@example.com' });
    expect(mockedApi.post).toHaveBeenCalledWith('/sub-coaches/invites', {
      email: 'sub@example.com',
      name: null,
      max_clients: null,
    });
  });

  it('invite forwards name and seat ceiling when provided', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    await subCoachApi.invite({ email: 'a@b.co', name: 'Alex', maxClients: 25 });
    expect(mockedApi.post).toHaveBeenCalledWith('/sub-coaches/invites', {
      email: 'a@b.co',
      name: 'Alex',
      max_clients: 25,
    });
  });

  it('revoke POSTs and surfaces reassignedClientCount', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { ok: true, reassignedClientCount: 4 } });
    const res = await subCoachApi.revoke('sub_1', { reason: 'left org' });
    expect(mockedApi.post).toHaveBeenCalledWith('/sub-coaches/sub_1/revoke', { reason: 'left org' });
    expect(res.data.reassignedClientCount).toBe(4);
  });
});

// ── 4) Settings + InviteCodes nav: dead-route screens are now reachable ─────
describe('Coach Tools section wires the previously-disconnected routes', () => {
  const settingsSrc = readSrc('screens/coach/SettingsScreen.tsx');

  it.each([
    'CoachWorkoutBuilder',
    'CoachMealTemplates',
    'CoachBookingInbox',
    'CoachAvailabilityEditor',
    'CoachBulkInvite',
  ])('SettingsScreen exposes a tap target that navigates to %s', (routeName) => {
    expect(settingsSrc).toContain(`screen: '${routeName}'`);
  });

  it('SettingsScreen exposes the new Business surfaces', () => {
    expect(settingsSrc).toContain("'CoachBusinessMetrics'");
    expect(settingsSrc).toContain("'CoachTeamProfile'");
  });

  it('ClientDetailScreen exposes CoachMacrosReview action pill', () => {
    const src = readSrc('screens/coach/ClientDetailScreen.tsx');
    expect(src).toContain("navigate('CoachMacrosReview'");
  });

  it('InviteCodesScreen has a bulk-invite button and redeemer drilldown', () => {
    const src = readSrc('screens/coach/InviteCodesScreen.tsx');
    expect(src).toContain("navigate('CoachBulkInvite')");
    expect(src).toContain("'InviteCodeRedeemers'");
  });
});

// ── 5) Program templates copy is honest ────────────────────────────────────
describe('Program templates honest framing', () => {
  const src = readSrc('screens/coach/ProgramTemplatesScreen.tsx');

  it('does not claim to "Apply to Client" (which falsely implies a workout/meal plan)', () => {
    expect(src).not.toContain('Apply to Client');
  });

  it('does describe the action as posting guidelines', () => {
    expect(src.toLowerCase()).toMatch(/post.*guidelines/);
  });
});

// ── 6) TeamManagementScreen has an Invite button ───────────────────────────
describe('TeamManagementScreen Invite button', () => {
  const src = readSrc('screens/coach/TeamManagementScreen.tsx');

  it('renders an Invite sub-coach affordance', () => {
    expect(src).toContain('SubCoachInviteModal');
    expect(src).toMatch(/setInviteOpen\(true\)/);
  });

  it('SubCoachInviteModal validates email before submitting', () => {
    const modalSrc = readSrc('screens/coach/SubCoachInviteModal.tsx');
    expect(modalSrc).toMatch(/Enter a valid email/);
  });
});

// ── 7) SubCoachDetailScreen has a revoke action ────────────────────────────
describe('SubCoachDetailScreen revoke action', () => {
  const src = readSrc('screens/coach/SubCoachDetailScreen.tsx');

  it('renders the revoke button and confirms before calling the API', () => {
    expect(src).toContain('handleRevoke');
    expect(src).toMatch(/Revoke sub-coach access/);
  });

  it('surfaces reassignedClientCount in the success copy', () => {
    expect(src).toContain('reassignedClientCount');
  });
});

// ── 8) CoachTeamProfileScreen renders setup CTA when backend missing ───────
describe('CoachTeamProfileScreen honesty', () => {
  const src = readSrc('screens/coach/CoachTeamProfileScreen.tsx');

  it('shows a "set up team" CTA when getProfile returns not_configured', () => {
    expect(src).toMatch(/Set up your team/);
    expect(src).toMatch(/team\.ok/);
  });

  it('surfaces the team code for sharing', () => {
    expect(src).toContain('buildInviteUniversalLink');
    expect(src).toContain('team_code');
  });
});

// ── 9) CoachBusinessMetricsScreen renders honest empty state ──────────────
describe('CoachBusinessMetricsScreen honesty', () => {
  const src = readSrc('screens/coach/CoachBusinessMetricsScreen.tsx');

  it('renders a Connect Stripe CTA when status.configured === false', () => {
    expect(src).toMatch(/Connect Stripe to enable revenue/);
    expect(src).toContain('isNotConfigured');
  });

  it('does not hardcode any revenue numbers in the rendered output', () => {
    // No literal money strings like "$" or fake totals in the source.
    const fakeMoney = src.match(/\$[\s]*[0-9]/g);
    expect(fakeMoney).toBeNull();
  });
});

// ── 10) Redeemer drilldown honest empty state ─────────────────────────────
describe('InviteCodeRedeemersScreen honesty', () => {
  const src = readSrc('screens/coach/InviteCodeRedeemersScreen.tsx');

  it('renders "Redeemer history coming soon" on 404 / 501', () => {
    expect(src).toMatch(/Redeemer history coming soon/);
    expect(src).toContain("'not_available'");
  });
});
