# Role-specific mobile experience spec

This pack defines what each role gets on mobile, end to end, so the product can be split cleanly between **clients**, **coaches**, and (optionally) **admins** without one role's surface bleeding into another's.

This is a **docs-only draft**. No `src/`, `app.json`, `eas.json`, `package.json`, CI, or `new-website` files are touched. Implementation of any one role belongs in its own follow-up PR with code, tests, and per-module README updates.

It is the fourth sibling to:

- PR **#92** — `docs/expansion/` — operator-readiness expansion (next 11 features)
- PR **#93** — `docs/platform-readiness/` — cross-cutting platform pack
- PR **#94** — `docs/expansion-wave-2/` — coaching feature pack
- PR **#95** — `docs/expansion-map/` — living index DONE / PREPARED / CURRENT WAVE / FUTURE
- PR **#96** — `docs/whop-expansion/` — Whop-style one-stop-shop coach surfaces

Where the packs above describe *new features*, this pack describes the *role contract*: which app each role opens, what the home screen looks like, what shared infrastructure is reused, and where the line is drawn so a coach never opens what feels like "a client app with extra buttons."

## Files

```
docs/role-experience/
├── README.md                 this index + cross-cutting constraints
├── 01-client-app.md          Client App Experience (mobile-first, paying member)
├── 02-coach-app.md           Coach App Experience (business command centre)
└── 03-admin-companion.md     Admin Mobile Companion (optional; web is primary)
```

## The product split (settled)

- **Clients** get a clear, calm, mobile-first app. One thought per screen. The current shipped surface (4 icons-only tabs + More stack) is the floor; Wave 2 features extend it without adding chrome.
- **Coaches** get a *separate experience* — at minimum a different navigator and home screen, ideally a different bundle and store listing once the surface stabilises. The coach app is a **business command centre**, not a client app with extra buttons. Density is higher, KPIs lead, and the tab bar is a different set of nouns (Clients / Dashboard / Templates / Messages / Settings today, Storefront / Programs / Community / Money on the horizon).
- **Admins** get a website dashboard as the primary experience (out of scope for this repo). An *optional* mobile companion exists only for incident response — alerts, account holds, dunning escalations, support tickets — and is feature-gated.

## What exists today (shipped surface)

A new contributor can pick up the role split because the bones are already in there. This section is a snapshot of `main` on the day this brief was written; treat it as a read-once orientation, not a contract.

### Routing the user to a role at boot — `src/navigation/RootNavigator.tsx`

`bootstrapAuth()` reads the supabase token from `secureStorage`, the `user_data` blob from `AsyncStorage`, and the `needs_role_selection` flag, and resolves to one of:

| `AuthState` | What mounts | Notes |
| --- | --- | --- |
| `loading` | `<ActivityIndicator />` | Until auth resolves. |
| `unauthenticated` | `AuthNavigator` | Welcome / Login / Create Account / Forgot Password / Role. |
| `onboarding` | `LeanOnboardingNavigator` | 3-question lean flow for new clients (`LeanQ1–Q3`). Original 10-step `OnboardingNavigator` preserved for legacy users only. |
| `coach` | `CoachNavigator` | 5-tab coach experience. |
| `student` | `ClientNavigator` | 4-tab client experience. |

The role enum the mobile app understands is `coach | student`. The `student` literal is historical; the role on the backend / surfaces is **client**. New code should prefer "client" in copy and comments, leaving `'student'` only as the wire value where it already exists.

### Client surface — `src/screens/client/`

- 4 bottom tabs, icons-only: `Home / WorkoutTab / Log / MoreTab`.
- `HomeStack` lives behind the Home tab (`HomeMain / Habits / Notifications / Messages`).
- `WorkoutStack` lives behind Train (`WorkoutMain / ActiveWorkout / RoutineBuilder / CoachGuidelines`).
- `Log` is a single screen.
- `MoreStack` houses everything else (`MoreIndex / ProfileMain / Recipes / RecipeDetail / GroceryList / ShoppingList / PrepGuide / Fast / Community / Progress / Settings / Widgets / Report / Learn / Plan / TrustCenter / Preferences / AIGuide / Membership`). There is no global FAB — `AIGuide` is reached from the **Guidance** row on `MoreScreen`.
- Offline-first writes for food logs (`services/foodLogQueue`), persistent React Query cache, AsyncStorage flags, expo-sqlite for content, SecureStore for tokens.

### Coach surface — `src/screens/coach/`

- 5 bottom tabs: `ClientsStack / Dashboard / Templates / Messages / SettingsStack`.
- `ClientsStack` (`ClientsList / ClientDetail / ClientMessages / InviteCodes`).
- `Dashboard` is `CoachHomeScreen` — KPIs + alerts feed.
- `Templates` is `ProgramTemplatesScreen`.
- `Messages` is the inbox; per-client thread is `ClientMessages` inside the Clients stack.
- `SettingsStack` (`SettingsHome → Billing → TrustCenter`).
- Coach Help-centre entry point landed in PR #84 (configurable `HELP_BASE_URL`).
- The shared `TrustCenterScreen` lives outside both folders so both navigators can reach it.

### Admin surface

There is no admin role today. The web dashboard is the primary admin surface and lives in a separate repo. The optional mobile companion described in `03-admin-companion.md` does not have any code in `main` — it is purely spec.

## Future / spec-only — what this pack defines but does not build

- A **dedicated coach bundle** (own bundle id, store listing, deep-link host) is described as a future state in `02-coach-app.md`. Today the coach experience ships in the same binary as the client experience, gated by `user.role`. The split is a packaging decision, not a code rewrite.
- **Role switching** for users who legitimately hold both roles (a coach who is also enrolled as a client of another coach) is not implemented; `02-coach-app.md` defines the contract.
- **Admin Mobile Companion** (incident response, alerts, account holds) is fully spec-only; `03-admin-companion.md` lays out scope, gates, and the explicit decision to not build it on day one.
- **Junior / head coach** sub-roles are spec'd in `docs/platform-readiness/04-role-based-navigation-architecture.md` and depend on backend Team Mode (PR #118). This pack references those primitives but does not duplicate them.

## Gaps and audits this pack acknowledges

The packs that came before this one already named the gaps; this pack does not re-spec them. It frames each one in terms of the role split:

- **`docs/expansion/06-coach-checkins-widget.md`**, **`08-coach-attention-panel.md`**, **`19-coach-revenue-dashboard.md`** — surfaces that turn the coach Dashboard from "today's logs + alerts" into a true command centre. The role split assumes those briefs land on `Dashboard`, not on a new tab.
- **`docs/expansion-wave-2/10-do-we-have-this-already.md`** — gap analysis for challenges, leaderboards, content boards, programs, assignments, messaging v2. The coach app's *Programs* and *Community* future tabs depend on those briefs.
- **`docs/whop-expansion/00-gap-map.md`** — the one-stop-shop reuse / conflict map. Storefront / Offers / Marketplace / Affiliates / Communities / Events / Rewards / Copilot are coach-side surfaces; the role split formalises which ones live in the coach app vs the client app.
- **`docs/platform-readiness/04-role-based-navigation-architecture.md`** — the technical spine: how `RootNavigator` decides what to mount, how junior-coach gating works, how to add a third role without rewriting the navigators.

## Cross-cutting constraints (called out once here)

These are properties of the mobile shell as it exists today on `main`. None of them are changed by this PR; every brief is written under them.

- **Expo / EAS identity is immutable**: `owner: the-growth-project`, `slug: tgp-health-and-wellness`, `expo.extra.eas.projectId: 3aeadee6-34c5-4231-85b9-aff9f7ea3c5a`, `bundleIdentifier / package: com.growthproject.app`, `scheme: tgp`. A future coach bundle would *add* a second EAS project; it would not rename the existing one.
- **Theme tokens (`src/theme/`) are the single source of truth.** Coach density is achieved through tokenised spacing, not through hardcoded values or a competing palette.
- **Quiet-luxury doctrine (`docs/QUIET_LUXURY_DOCTRINE.md`) governs every UI decision** for both roles. The coach app is denser, not louder. No emoji. No "Coming Soon". No celebrations.
- **Auth shape per `docs/HANDOFF.md` §4.** Supabase JWT, role on the user record, `RootNavigator` switches on `user.role`.
- **`src/services/api.ts` is the single HTTP entry point.** Both roles consume it. The backend filters every response to the calling JWT's tenancy.
- **`new-website` is out of scope.** The directory does not exist in this repo; this PR does not introduce it.

## Read order

A new contributor picking up the role split cold should read in this order:

1. This README (context + the split).
2. `01-client-app.md` (the floor — what a paying member sees today and tomorrow).
3. `02-coach-app.md` (the command centre — and the split rationale).
4. `03-admin-companion.md` (the optional mobile surface; understand why it is *not* day one).
5. The sibling packs above for feature depth (#92 / #93 / #94 / #95 / #96).

## What this pack is not

- Not a Figma replacement. UX details (spacing, copy, motion) belong in Figma + `QUIET_LUXURY_DOCTRINE.md`.
- Not a backend spec. API contracts are mobile's *consumption shape*, the starting point for negotiation with the backend, not the final word.
- Not a roadmap. Sequencing belongs in the planning tool. Each brief includes a *suggested* phasing but flags it as non-binding.
- Not permission to start any of these surfaces. Each still needs its own implementation PR.

## Operator handoff

- Owning surfaces: every screen named in `01-client-app.md` and `02-coach-app.md` already has a per-module README under `src/screens/{client,coach}/`. Implementation PRs update those READMEs.
- "Done means": when the coach app feels like a *different* app on first open — different home, different tab nouns, different density — without the user having to read a single tooltip to understand why.
- If the coach split is ever rolled back to a single bundle, this pack stays useful as the in-binary role contract.
