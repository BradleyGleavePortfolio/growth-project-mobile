/**
 * useCoachRoleType
 *
 * Resolves whether the currently authenticated coach is a head coach or a
 * sub-coach. Sub-coaches must NOT see team-management surfaces because the
 * underlying `/sub-coaches` and `/coach/team/members` endpoints are scoped
 * to head coaches; mounting those screens for a sub-coach surfaces a
 * permanent retry-error state for a feature they don't own.
 *
 * Resolution is "fail closed": while the role is `unknown` (network in
 * flight, members endpoint not yet implemented, etc.) callers should treat
 * the user as NOT a head coach. The TeamStack tab only appears once we have
 * a positive `head_coach` confirmation.
 *
 * The canonical signal lives in `/coach/team/members`. Each entry carries
 * `role: 'head_coach' | 'sub_coach'`, and we match the cached current user
 * id against the roster to decide.
 *
 * `useCoachTeamStatus` also reports whether the roster holds at least one
 * sub-coach. The members route lists every coach as the head coach of their
 * own (often empty) roster, so role alone cannot tell a coach who runs a
 * team from one who does not.
 */

import { useEffect, useState } from 'react';
import { coachTeamApi } from '../api/coachTeamApi';
import { readUserCache } from '../lib/userCache';
import { authEvents } from '../utils/authEvents';

export type CoachRoleType = 'head_coach' | 'sub_coach' | 'unknown';

export interface CoachTeamStatus {
  role: CoachRoleType;
  /** True only once the roster shows at least one sub-coach. */
  hasSubCoaches: boolean;
}

const UNKNOWN_STATUS: CoachTeamStatus = { role: 'unknown', hasSubCoaches: false };

export function useCoachTeamStatus(): CoachTeamStatus {
  const [status, setStatus] = useState<CoachTeamStatus>(UNKNOWN_STATUS);

  useEffect(() => {
    let mounted = true;

    const resolve = async () => {
      try {
        const user = await readUserCache();
        if (!user || user.role !== 'coach') {
          if (mounted) setStatus(UNKNOWN_STATUS);
          return;
        }
        const result = await coachTeamApi.getMembers();
        if (!mounted) return;
        if (!result.ok) {
          // Backend hasn't shipped the route yet, or an outage. Fail closed
          // so a sub-coach never sees a feature they don't own. Head coaches
          // on a broken backend lose the tab until the next session — the
          // upgrade-gate alternative would falsely tell paying customers they
          // need to upgrade, which is worse.
          setStatus(UNKNOWN_STATUS);
          return;
        }
        const me = result.data.find((m) => m.id === user.id);
        if (!me) {
          setStatus(UNKNOWN_STATUS);
          return;
        }
        setStatus({
          role: me.role === 'head_coach' ? 'head_coach' : 'sub_coach',
          hasSubCoaches: result.data.some((m) => m.role === 'sub_coach'),
        });
      } catch {
        if (mounted) setStatus(UNKNOWN_STATUS);
      }
    };

    void resolve();

    const onLogin = () => {
      setStatus(UNKNOWN_STATUS);
      void resolve();
    };
    const onLogout = () => setStatus(UNKNOWN_STATUS);
    authEvents.on('login', onLogin);
    authEvents.on('logout', onLogout);

    return () => {
      mounted = false;
      authEvents.off('login', onLogin);
      authEvents.off('logout', onLogout);
    };
  }, []);

  return status;
}

export function useCoachRoleType(): CoachRoleType {
  return useCoachTeamStatus().role;
}
