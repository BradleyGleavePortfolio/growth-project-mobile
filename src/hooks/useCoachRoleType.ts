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
 */

import { useEffect, useState } from 'react';
import { coachTeamApi } from '../api/coachTeamApi';
import { readUserCache } from '../lib/userCache';
import { authEvents } from '../utils/authEvents';

export type CoachRoleType = 'head_coach' | 'sub_coach' | 'unknown';

export function useCoachRoleType(): CoachRoleType {
  const [role, setRole] = useState<CoachRoleType>('unknown');

  useEffect(() => {
    let mounted = true;

    const resolve = async () => {
      try {
        const user = await readUserCache();
        if (!user || user.role !== 'coach') {
          if (mounted) setRole('unknown');
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
          setRole('unknown');
          return;
        }
        const me = result.data.find((m) => m.id === user.id);
        if (!me) {
          setRole('unknown');
          return;
        }
        setRole(me.role === 'head_coach' ? 'head_coach' : 'sub_coach');
      } catch {
        if (mounted) setRole('unknown');
      }
    };

    void resolve();

    const onLogin = () => {
      setRole('unknown');
      void resolve();
    };
    const onLogout = () => setRole('unknown');
    authEvents.on('login', onLogin);
    authEvents.on('logout', onLogout);

    return () => {
      mounted = false;
      authEvents.off('login', onLogin);
      authEvents.off('logout', onLogout);
    };
  }, []);

  return role;
}
