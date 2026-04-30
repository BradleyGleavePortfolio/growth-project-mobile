# 20 — Team mode — roles, permissions, junior coach UX, client assignment visibility

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app (deep changes)
**Owner:** Mobile (coach-side); coordinates closely with backend
**Cross-repo:** Backend draft PR **#118 (Team Mode)** — defines the role
model, permission scopes, and assignment endpoints this feature consumes.

## WHY

Today the coach app assumes one coach owns one set of clients. Real
coaching businesses are teams: a head coach hires juniors, juniors
handle day-to-day, and clients are assigned. Without team mode, every
junior either signs in as the head coach (a security hole) or runs a
separate account (no consolidated view). Team mode is the foundation
that turns the coach app from a solo tool into an agency tool, and
it's the largest single mobile change in this expansion pack.

This is the feature most likely to compromise tenant safety if rushed.
Treat the README as a contract.

## WHEN to build

Strictly after backend PR #118 is merged and the role / scope model is
stable. Mobile cannot lead this — the *server* enforces permissions;
mobile only renders correctly. Building mobile-first risks shipping a
UI that asserts capabilities the backend doesn't grant.

Sequencing inside team mode itself:
1. Read-only awareness: render team membership and assignment in the
   existing coach app, no new actions.
2. Junior coach UX: limit junior-account capabilities by role.
3. Head coach actions: assign / reassign clients, invite team members.

## WHERE in the repo

Almost every coach surface is touched. Plan the changes in the order
above; do not flag-flip until step 3 is complete.

- New screens:
  - `src/screens/coach/TeamScreen.tsx` — list of team members, their
    role, current assigned-client count.
  - `src/screens/coach/TeamMemberDetailScreen.tsx` — head-coach view:
    role, assigned clients, "Reassign clients" / "Remove from team".
  - `src/screens/coach/AssignClientScreen.tsx` — a small modal/screen
    for assigning a client to a team member.
- Modified screens:
  - `ClientsListScreen.tsx`: add a per-row "Assigned to" pill
    (head-coach view) or hide clients not assigned to the current
    junior (junior view).
  - `ClientDetailScreen.tsx`: show assignee; expose "Reassign" only
    if the current user has `clients:reassign` scope.
  - `CoachHomeScreen.tsx`: dashboard rollups respect the viewer's
    scope. Junior sees their assigned clients; head sees all.
  - `InviteCodesScreen.tsx`: codes can optionally pre-bind to a
    specific team member's clientele.
  - `SettingsScreen.tsx`: row "Team" → `TeamScreen` (head-coach
    only).
- Service layer: every `coachApi.*` call already runs JWT-scoped on
  the backend. The mobile change is *rendering* — hide controls the
  current role can't perform; never rely on the absence of a button
  for security (the backend is the enforcer).
- Auth / session: extend `useCurrentUser` (or wherever the user
  object lives) to expose `role: 'head_coach' | 'junior_coach' | 'client'`
  and `scopes: string[]` from the JWT claims.
- Type: `src/types/team.ts`.

## WHO owns and uses it

- **Builder:** Mobile coach team, working in lockstep with backend
  on the role/scope model.
- **Primary users:**
  - **Head coach** — manages team, assigns clients, sees everything
    their team sees plus team-wide rollups.
  - **Junior coach** — sees only their assigned clients; cannot
    reassign, cannot invite team members, cannot see team-wide
    revenue (#19).
- **Indirect:** Clients see no change. Team membership is
  invisible to them; they message whichever coach is assigned.

## WHAT MVP includes

- Two roles: `head_coach`, `junior_coach`. Anything more
  fine-grained (e.g. read-only viewer) is out of scope.
- Junior coach UX limits:
  - Sees only assigned clients in `ClientsListScreen`.
  - Cannot open `TeamScreen` (row hidden).
  - Cannot see team-wide MRR or revenue dashboard (#19) — sees only
    their own assignment-attributed revenue if/when that's modelled,
    otherwise revenue is hidden entirely for juniors in v1.
  - Can still send nudges, see check-ins, and open
    `ClientDetailScreen` for assigned clients.
- Head coach UX:
  - Sees all clients with an "Assigned to" pill.
  - Can reassign clients from `ClientDetailScreen` action sheet.
  - Can invite team members and revoke them from `TeamScreen`.
  - Sees team-wide rollups on home and revenue.
- Assignment visibility on client side: **none**. Clients are not
  told who they were reassigned to via the app; the assigned coach
  can introduce themselves via messages.

### Out of scope for v1

- Read-only or analyst roles.
- Granular per-feature scopes (e.g. "junior can author programs but
  not reassign"). Either you're junior or head.
- Client-visible assignment notifications.
- Team-wide messaging / shared inbox.
- Bulk reassign / hand-off workflows.

## HOW to implement safely

1. **Backend is the enforcer.** Every list endpoint already filters
   by JWT. The new dimension is `assigned_to` for junior accounts.
   The mobile app must not pass `team_id` or `assigned_to` as
   parameters; the JWT scopes the response.
2. **Render-by-scope, never by client-side guess.** The user object
   exposes `scopes`; controls and screens render only when the
   relevant scope is present. If the JWT changes mid-session, refetch
   on resume rather than caching scopes for a long time.
3. **Mistaken-role failsafe.** If the JWT claims `junior_coach` but
   the backend returns 403 on a junior-allowed endpoint, surface a
   "Your account permissions changed — sign in again" toast. Don't
   silently degrade.
4. **Onboarding for new juniors.** A junior signing in for the first
   time should see an empty `ClientsListScreen` with an honest empty
   state ("Your head coach hasn't assigned clients yet"), not the
   solo-coach onboarding flow.
5. **Reassign is destructive-feeling but not destructive.** Confirm
   with a sheet that names both coaches; do not let a misclick lose a
   client. The action is reversible by another reassign, but the
   moment-of-tap matters.
6. **Cross-feature interactions:**
   - #08 (attention panel): junior sees only their assigned clients;
     head sees all, with assignee column.
   - #19 (revenue): junior either sees attribution-scoped revenue or
     no revenue tab at all (decide with the team; v1 hides if
     attribution model isn't ready).
   - #06 (check-ins widget): junior sees only their clients.

## Screens / navigation sketch

```
Head coach
─────────
SettingsScreen
  └─ "Team"  ──► TeamScreen
                  ├─ List of members + roles + assigned-client counts
                  ├─ Tap row  ──► TeamMemberDetailScreen
                  │                ├─ Assigned clients
                  │                ├─ Reassign clients
                  │                └─ Remove from team
                  └─ "Invite team member"  ──► invite flow

ClientsListScreen
  └─ Each row: "Assigned to <name>" pill
ClientDetailScreen
  └─ "Assigned to <name>" + "Reassign" action

Junior coach
────────────
ClientsListScreen
  └─ Only assigned clients (or empty state)
SettingsScreen
  └─ No "Team" row
CoachHomeScreen
  └─ Dashboard scoped to assigned clients
```

## API contract dependency

(All defined by backend PR #118.)

- `GET /coach/team` → `{ members: TeamMember[] }` (head only)
- `POST /coach/team/invite` body `{ email, role }` → invite
- `DELETE /coach/team/:member_id`
- `GET /coach/clients` — already exists; backend now scopes by
  `assigned_to` for junior callers and includes `assigned_to` in
  each row for head callers.
- `POST /coach/clients/:id/assign` body `{ assignee_user_id }`
- JWT claims: `role`, `team_id`, `scopes`.

## Feature flag / rollout

- Flag: `features.teamMode`.
- Roll out in three sub-flags so mobile can land changes without
  exposing them:
  - `features.teamMode.read` — render assignee pills, expose
    role-aware empty states. No actions.
  - `features.teamMode.juniorRestrictions` — junior accounts see
    scoped data only.
  - `features.teamMode.headActions` — assignment, invite, remove.
- Flip in order. Each flip is reversible.
- Kill switch reverts all three to off; mobile renders as if team
  mode never shipped.

## Testing plan

- Unit: scope-based render rules for every gated control.
- Unit: empty-state copy for unassigned juniors.
- Component: reassign flow, invite flow, remove flow with
  confirmation.
- Integration: head invites junior → junior signs in → junior sees
  empty list → head assigns client → junior sees the client on
  next refresh.
- Integration: 403 on a junior-allowed endpoint surfaces the
  "permissions changed" toast.
- Manual: cross-account walkthrough on real devices, both
  platforms.
- Security: confirm that *removing* a button does not gate a
  capability — backend must enforce on every relevant endpoint, and
  attempts via a hand-rolled request return 403.

## Risks

- **Tenant leakage.** The largest risk in the app. A junior who
  sees a non-assigned client's data because mobile hid the wrong
  thing is a serious incident. Mobile rendering and backend scoping
  must agree, and backend is the source of truth.
- **JWT staleness.** A demoted junior whose token still claims
  `head_coach` for an hour is a problem. Coordinate token TTL with
  backend; surface the "permissions changed" toast on any 403 to
  catch the gap.
- **Onboarding confusion.** A junior signing in for the first time
  should not see the solo-coach onboarding. Detect role on
  post-auth bootstrap.
- **Scope creep.** Pressure to add a third role, per-feature
  scopes, or client-visible assignment will be high. Hold the line
  in v1.

## Dependencies

- Backend PR #118.
- Affects #06, #08, #19 — coordinate with their owners on scope
  rendering before flipping `juniorRestrictions` on.
- No new npm dependencies expected; this is a permissions/render
  change, not a new capability surface.

## Acceptance criteria

- [ ] All three sub-flags off → no behaviour change anywhere in the
      coach app.
- [ ] `features.teamMode.read` on → assignee pills render
      correctly; empty states honest; no new actions exposed.
- [ ] `features.teamMode.juniorRestrictions` on → junior accounts
      see only assigned clients across all coach surfaces (#06,
      #08, dashboard, `ClientsListScreen`).
- [ ] `features.teamMode.headActions` on → head can invite,
      assign, reassign, remove.
- [ ] Backend 403 on any gated endpoint surfaces the
      permissions-changed toast.
- [ ] No hardcoded hex; theme tokens only.
- [ ] `src/screens/coach/README.md` updated; new
      `src/screens/coach/TeamScreen.tsx` and `TeamMemberDetail`
      documented.
- [ ] Security review signed off — mobile gating relies on backend
      enforcement, never the other way round.
