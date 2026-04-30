# 04 — Role-based navigation architecture

> Pre-build brief. Defines how today's coach/student/onboarding split scales to the team-mode roles backend PR #118 introduces, without rewriting `RootNavigator`.

## WHY

Today the navigation root in `src/navigation/RootNavigator.tsx` chooses one of four states based on `bootstrapAuth()`:

- `loading`
- `unauthenticated` → `AuthNavigator`
- `onboarding` → `OnboardingNavigator`
- `coach` → `CoachNavigator`
- `student` → `ClientNavigator`

The decision is binary on `user_data.role`. Backend PR **#118 — Team Mode** introduces an org concept with at least three coach-side roles (head coach, junior coach, viewer) and the possibility of a single human holding more than one role across orgs. The current navigator cannot represent that without a rewrite — and a rewrite of the root navigator is the kind of high-risk change we want to *not* do under deadline pressure.

This brief writes down the extension shape so that when #118 lands, the mobile change is an additive PR, not a rewrite.

## WHEN

Land this brief before the first mobile PR that consumes any data shape from backend #118. There is currently no urgency — #118 is itself a draft. But the brief should exist so #118's mobile counterpart isn't designed in isolation.

## WHERE

When implemented (not in this PR):

- `src/navigation/RootNavigator.tsx` — extended switch, no rewrite.
- `src/hooks/useCurrentUser.ts` — exposes a `roles: Role[]` array (today it exposes a single `role` string).
- `src/lib/auth/role.ts` (new) — single source for "is this user allowed to see screen X" decisions.
- `src/types/user.ts` — `User` type gains `roles?: Role[]` while keeping legacy `role` for one release.
- `src/navigation/CoachNavigator.tsx` — gains conditional screens based on the *active* role within an org.
- `docs/HANDOFF.md` §4.1 — extended state machine.

## WHO

- **Mobile lead**: owns the role-evaluation contract. Any new screen that needs gating routes through `src/lib/auth/role.ts`.
- **Backend lead** (cross-repo, #118): owns the response shape. Mobile follows.
- **Engineer**: when adding a screen, specifies which role(s) can see it via a single declarative annotation (see *HOW*).

## WHAT

Three contract changes, in order of risk:

### 1. `User` type widens, doesn't break

```ts
// today (current src/types/user.ts equivalent)
type User = { id: string; role: 'coach' | 'student' };

// after #118
type Role =
  | 'student'
  | 'coach'                // legacy single-coach
  | 'head_coach'           // org owner (#118)
  | 'junior_coach'         // org member with limited write (#118)
  | 'viewer';              // read-only org member (#118)

type User = {
  id: string;
  role: Role;              // primary / current role, kept for back-compat
  roles?: Role[];          // all roles the user holds (#118)
  activeOrgId?: string;    // when in a multi-org context (#118)
};
```

The `role` field stays for one release after `roles` arrives, so old `user_data` cached in AsyncStorage still parses.

### 2. Role evaluation becomes one function

```ts
// src/lib/auth/role.ts
export function can(user: User | null, capability: Capability): boolean;
```

`Capability` is a string union: `'view-coach-dashboard'`, `'edit-program'`, `'invite-junior-coach'`, etc. Mapping from capability → role lives in this file. A screen never checks `user.role === 'coach'` directly — it asks `can(user, 'view-coach-dashboard')`.

The mapping is *one* file. New roles add new mappings. New screens add new capabilities.

### 3. `RootNavigator` adds one branch, doesn't reshape

The four current states stay. A fifth implicit state — "coach with team-mode org context" — is handled **inside** `CoachNavigator`, not at the root. The root cares only about three things:

- is the user authenticated?
- is onboarding done?
- is this a coach-class role or a client-class role?

Junior-vs-head-coach is a `CoachNavigator`-level decision, gated by `can()`.

## HOW

1. Land the type widening (`Role`, `User.roles`, `User.activeOrgId`) as a non-breaking change. `useCurrentUser()` returns both `role` and `roles`.
2. Introduce `src/lib/auth/role.ts` with the seed capability map. Cover at least: `view-coach-dashboard`, `edit-client-plan`, `invite-client`, `view-revenue-dashboard`, `clone-starter-program`. (These are the capabilities the expansion pack #92 items 12, 14, 18, 19, 20 will need.)
3. Migrate every existing `user.role === 'coach'` check to `can(user, ...)`.
4. Add unit tests covering each capability for each role.
5. Update `docs/HANDOFF.md` §4 with the new state shape and the `can()` contract.

Step 3 is the biggest line-count change but is mechanical. It can be split over multiple PRs.

## Expo / EAS considerations

- No native or build-config change. Pure TS/JS.
- `user_data` lives in AsyncStorage; the migration must tolerate **old shape (no `roles`)** and **new shape**. Test with a fixture that has only `role` set.
- Bundle size impact is negligible (a few hundred bytes for the capability map).
- No new dependency.

## Acceptance criteria

- `useCurrentUser()` returns `{ role, roles, activeOrgId }`. Old user_data with only `role` parses correctly: `roles` defaults to `[role]`.
- Every existing screen-gating check in `src/screens/` and `src/navigation/` is migrated to `can()`. A grep for `user.role ===` returns zero results outside `src/lib/auth/role.ts`.
- Adding a new capability is a one-file change to `src/lib/auth/role.ts`.
- All four current root navigator states still mount the same navigator they did before — no change to the auth/onboarding/coach/student split.

## Rollout strategy

- **Phase 1**: ship the widened type + `useCurrentUser()` change with `roles` defaulting from `role`. No behavioural change.
- **Phase 2**: ship `can()` and migrate existing checks. No behavioural change.
- **Phase 3**: when backend #118 lands, set `roles` from the response and start using `head_coach` / `junior_coach` capabilities. Behavioural change is gated behind the team-mode feature flag (see [`02-feature-flag-consumption.md`](./02-feature-flag-consumption.md)).
- Rollback: each phase is independently revertible. Phase 3 is the only one with user-visible effect, and it sits behind a flag.

## Tests

- Unit (`src/lib/auth/__tests__/role.test.ts`): one test per (role × capability) cell. ~25 tests for the seed matrix.
- Unit (`useCurrentUser`): legacy shape (`role` only), modern shape (`roles` only), both shapes.
- Snapshot or smoke (`RootNavigator`): each of the four states still mounts the expected child navigator.
- Manual: log in as a coach, then as a student, on a build that has the migration. Confirm both flows reach the same screens they did before.

## Risks

- **`user_data` shape drift**: old clients have AsyncStorage entries with only `role`. The migration must read both. Covered by the unit test above.
- **Capability sprawl**: the capability list grows. Mitigation: review additions in PR; group capabilities by domain (`coach.*`, `client.*`, `org.*`) once the list passes ~20 entries.
- **Backend / mobile drift**: if backend #118 ships role names different from this brief's seed list, mobile follows backend, not the other way around. Document the mapping in the brief that becomes the implementation PR.
- **Multi-org UX**: if a single user holds roles in multiple orgs, the UI to switch between them is **not** in scope for this brief. That is a feature on its own; for now the active org is whichever the backend says is primary.

## Dependencies

- Backend PR **#118 — Team Mode** is the source of truth for role names and the response shape. This brief follows.
- Backend PR **#119** (per parent agent) may further define org-scoped permissions; if so, capabilities here gain an `orgId` parameter. The contract is forward-compatible: `can(user, capability, { orgId })`.
- Cross-link with [`09-api-contract-compatibility.md`](./09-api-contract-compatibility.md) for how mobile degrades when the backend doesn't yet return `roles` (treat as `[role]`).

## Operator handoff

- **Owning surface(s)**: `src/lib/auth/role.ts`, `src/types/user.ts`, `src/hooks/useCurrentUser.ts`, `src/navigation/CoachNavigator.tsx`.
- **Out-of-band steps**: confirm with backend lead the exact role names and response field name before phase 3 starts. Update the team-mode feature flag in PostHog with the cohort that gets the new role behaviour.
- **Done means**: an engineer adding a junior-coach-only screen writes one line — `if (!can(user, 'edit-program')) return null;` — and the screen is correctly hidden from non-junior-coach users.
