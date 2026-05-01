# Coach App Experience

The coach app is a **business command centre**. Not a client app with extra buttons — a different home, a different tab bar, a different density, a different mental model. A coach who opens it on Monday morning should immediately see where money, attention, and risk are this week, and act in two taps.

This brief is the role contract for coaches. It rests on the shipped `CoachNavigator` (5 tabs) as the floor and pulls forward what PRs #92 / #93 / #94 / #96 add.

## WHY the coach app must feel like a different app

A client opens the app to log food and read a single CTA. A coach opens it to make business decisions. Those two intents do not share a home screen. They do not share a tab bar. They do not share a density.

The mistake we are explicitly avoiding is *"a client app with a coach mode toggle"*. That shape:

- Buries the coach's first-open KPIs behind a tab swap.
- Forces the client palette (calm, sparse) onto authoring screens that genuinely benefit from density.
- Conflates two notification graphs (client nudges vs business alerts).
- Confuses store reviewers and end users about what the product actually is.

The role split formalises the difference at three levels:

1. **Home and tab nouns**. Different. No `Home` route on the coach side; the coach lands on `Dashboard`.
2. **Density and motion**. The coach app uses tighter spacing tokens, multi-column layouts where the device permits, and modal-heavy authoring. Same theme tokens, different composition.
3. **Eventually, packaging**. A future EAS project + bundle + store listing for the coach app, so a coach can install only the app they need. The split is a packaging decision; the codebase remains a single repo.

## WHEN

- Always available.
- Coach KPIs refresh on focus and on a 30 s `useCoachUnreadPolling`-style interval (already shipped for messages; the `CoachHomeScreen` extends this pattern for `getDashboard` and `getAlerts`).
- Realtime broadcasts ping the coach for inbound client messages; a 60 s safety poll covers WebSocket drops.
- Authoring (Programs, Templates, Storefront, Offers) is online-required.

## WHERE

- Mounted as `CoachNavigator` from `RootNavigator` when `user.role === 'coach'`.
- Source: `src/navigation/CoachNavigator.tsx`.
- Screens: `src/screens/coach/`.

## WHO

- A coach with at least one paying client (or in trial).
- Once Team Mode (backend #118) lands, the same navigator gates **junior coach** vs **head coach** rows per `docs/platform-readiness/04-role-based-navigation-architecture.md`.
- Admins do *not* enter the coach app via `RootNavigator`. The optional admin companion is its own surface — see `03-admin-companion.md`.

## WHAT (Information Architecture)

### Today (shipped — 5 tabs)

| Tab | Route | Wraps | One thought |
| --- | --- | --- | --- |
| Clients | `ClientsStack` | `ClientsList / ClientDetail / ClientMessages / InviteCodes` | "Who needs me?" |
| Dashboard | `Dashboard` | `CoachHomeScreen` | "What is this week?" |
| Templates | `Templates` | `ProgramTemplatesScreen` | "What am I selling them?" |
| Messages | `Messages` | `MessagesScreen` (cross-client inbox) | "Who is talking to me?" |
| Settings | `SettingsStack` | `SettingsHome → Billing → TrustCenter` | "My business." |

### Future (queued in #92 / #94 / #96 — extends, never reduces)

The role split formalises which queued surfaces are coach-only. None of these belong on the client side; none of these introduce a *new* tab without an explicit decision in this section.

The future tab bar (target — implemented incrementally; not landed in any single PR):

| Tab | Lands when | Sources |
| --- | --- | --- |
| Clients | Today (shipped). Adds Attention Panel widget per #92/08. | `ClientsStack` |
| Dashboard | Today (shipped). Adds Check-ins widget (#92/06), Revenue dashboard (#92/19), AI recap CTA (#92/10). | `CoachHomeScreen` |
| Programs | When #94/05 (Programs editor) ships. Replaces / promotes Templates. Houses `ProgramsList / ProgramEditor / Assignment` flows from #94/05–06. | new `ProgramsStack` |
| Community | When #96/07 (Spaces) ships. Houses `Spaces / SpaceDetail / Moderation` for the coach's own community. | new `CommunityStack` |
| Money | When #92/19 + #96/03 + #96/05 + #96/09 ship. Houses Revenue, Affiliates, Subscriptions, TGP-balance ledger, dunning queue. Settings → Billing remains the *self-billing* surface; Money is the *business-billing* surface. | new `MoneyStack` |

Five tabs is the ceiling; if Money joins, Templates folds into Programs and Settings folds into a Profile / Settings menu reachable from the Dashboard header (right-aligned `settings` icon, accessibility label "Settings"). The decision to fold or split is per-PR, not pre-committed by this brief.

### What is *not* on the coach app

- The Log screen.
- The client AI Guide.
- The Membership screen as the client sees it (Settings → Billing covers the coach's own subscription).
- The Recipes / GroceryList / ShoppingList / PrepGuide / Fast / Habits screens.
- The Trophy / streak chrome (excised globally per PR #70).
- A floating chat widget (forbidden by the doctrine).

## HOW (navigation, role entry, role switching)

### Role entry

`RootNavigator.bootstrapAuth()` — same machine as the client. When `user.role === 'coach'`, mount `CoachNavigator` directly (no onboarding gate, no role-selection gate).

### Role switching

A user who legitimately holds both roles — e.g. a coach who is also a paying client of another coach — needs a switcher. Today the user-record only carries one role; the contract for adding a second role lives in `docs/platform-readiness/04-role-based-navigation-architecture.md` and depends on backend Team Mode (PR #118).

Mobile UX (target):

- Settings → **Switch to client view** (when the user has both roles). Persists last-selected role in `AsyncStorage` under `last_active_role`.
- The switch hot-swaps `RootNavigator`'s mounted child without re-auth (a re-auth would be hostile).
- A push notification addressed to "you as a client" never opens the coach app, and vice versa. Notification routing is server-enforced via `role:` payload.

The switcher lands as part of a future PR; this brief defines the shape.

### Future packaging — separate coach bundle

A separate EAS project + Apple Bundle ID + Android package + store listing for the coach app. Spec only.

| Identifier | Today | Future |
| --- | --- | --- |
| EAS project | `tgp-health-and-wellness` (single project) | + `tgp-coach-mobile` (second project) |
| Bundle id / package | `com.growthproject.app` | + `com.growthproject.coach` |
| Scheme | `tgp` | + `tgpcoach` |
| Universal links | `app.trygrowthproject.com` | + `coach.trygrowthproject.com` |
| Owner | `the-growth-project` | unchanged |

Trigger to actually ship the second bundle: when the coach app stops sharing tabs and screens with the client app at a >70% rate, the cost of compiling them together exceeds the cost of splitting. We are not at that threshold today; the spec exists so the move can happen in a single PR series, not a rewrite.

## Onboarding (coach side)

- A new coach is **provisioned server-side**. The app does not surface a "become a coach" CTA. (See `src/screens/coach/README.md` "Release notes".)
- First-open of the coach app shows `Dashboard` with empty-state copy explaining what *would* appear here when clients are attached. Doctrine forbids "Coming Soon" placeholders.
- Coach-side intake — business profile (name, bio), notification preferences, push token — is a quiet first-run inside `Settings → Business profile` rather than a multi-step quiz.
- Profile-completion gate (#83) is client-only; the coach equivalent is the empty `Dashboard` itself.

## Permissions

| Permission | Read by | Why |
| --- | --- | --- |
| Notifications | `expo-notifications` | Inbound client messages, attention-panel alerts. Enabled by default for coaches; opt-out in Settings. |
| Camera | none today; future content-board upload (#94/04) | Optional. App degrades to library picker. |
| Photos | content-board / avatar uploads | Read-only. |
| Microphone | future voice notes (#94/07) | Opt-in per send. |

The coach app does **not** request location, contacts, or background fetch beyond Expo defaults.

## Design differences vs client (this is the hinge)

The client app and coach app share the theme. They do **not** share composition. The differences are tokenised, not hardcoded.

| Dimension | Client | Coach |
| --- | --- | --- |
| Tab count | 4, icons-only, no labels | 5, icons + labels (clarity wins over silence at the business surface) |
| Home | "Today's CTA + 2×2 number grid" | KPI strip + alerts feed + attention panel + revenue snapshot |
| Default density | `spacing.lg` defaults | `spacing.md` defaults; tables and lists use `spacing.sm` |
| Multi-column | None (mobile-first, single column) | Two-column at `width >= 720dp` on tablets / large phones (alerts ⊕ KPIs side-by-side) |
| Typography | Cormorant headlines lead | Inter leads on dashboards; Cormorant only on the dashboard date headline |
| Motion | `motion.duration.base = 400ms`, `decel` | `motion.duration.base = 240ms`, `linear` for table rows; `decel` for navigation |
| Numeric chrome | minimal — single CTA | tabular-numerals, sparklines, deltas, percentages |
| List rows | "card-like", roomy | "row-like", terse — `ListRow` (a named primitive in `docs/platform-readiness/05-reusable-expansion-ui-patterns.md`) |
| Modal usage | rare | frequent (authoring) |
| Empty states | editorial, single sentence | explicit, with the *next action* the coach should take |
| Background | `bone` global | `bone` global, but cards on `cream` so KPI tiles read as separate objects |
| Accent | single forest | single forest (no extra colour-coding for "good vs bad"; deltas use up/down arrows + ink, not green/red) |

What stays identical: theme tokens, type families, accent colour, doctrine compliance (no emoji, no Coming Soon, no celebrations, no hype).

## Shared components vs separate surfaces

### Shared (both roles import directly)

- `src/theme/`, `src/components/AsyncBoundary.tsx`, `src/components/OfflineBanner.tsx`, `src/components/HapticPressable.tsx`, `src/components/FadeInView.tsx`.
- `src/services/api.ts` (single HTTP entry point), `src/services/realtime.ts`, `src/utils/notifications.ts`.
- The Supabase auth state machine in `RootNavigator`.
- `TrustCenterScreen` (intentionally outside both `screens/{client,coach}/` folders so both navigators can mount it).
- The named primitives from platform-readiness/05 (`ListRow`, `KpiTile`, `ChipFilter`, `SectionHeader`, `EmptyState`, `MetaRow`, `Sparkline`, `AttentionTag`).

### Separate (no cross-imports)

- `src/screens/client/` and `src/screens/coach/` are siblings. Neither imports from the other.
- The two `MessagesScreen.tsx` are deliberately distinct: client = one thread; coach = inbox of threads.
- The two `SettingsScreen.tsx` are deliberately distinct: client = personal; coach = business + personal.
- Coach-side authoring (`ProgramTemplatesScreen`, `InviteCodesScreen`, future `OfferBuilderScreen`, future `StorefrontEditorScreen`) has no client counterpart and never imports from `screens/client/`.

When a screen *would* benefit from being shared (e.g. a profile-edit form for both roles), it lives at `src/screens/<RoleAgnostic>Screen.tsx` and is mounted by both navigators. `TrustCenterScreen` is the prior art.

## Notification strategy

The coach app uses two notification channels:

- **Client activity** — new client message, new check-in, weight-trend alert, missed-check-in. High-frequency; can be muted per-client in `ClientDetail`.
- **Business** — payment received, dunning event, application submitted (future #92/14, #96/04), affiliate payout (future #96/05). Low-frequency; never muted by default.

The mobile app subscribes to both, but the server addresses each by `role: 'coach'` and `channel:` so a future client app build never receives them.

Quiet hours and digest-mode are in `Settings → Notification preferences` and are server-backed. The coach can fully silence client-activity outside business hours without affecting business notifications.

A coach **never** receives a client-targeted nudge. A client **never** receives a coach-targeted alert. The mobile app never re-routes a notification client-side.

## Dashboard widgets (the command centre)

`CoachHomeScreen` is the heart of the coach app. The role split commits to keeping it that way.

### Today (shipped)

- Greeting header.
- Logs-today / total-kcal / logging-rate KPIs from `coachApi.getDashboard`.
- Alerts feed (weight increasing, missed workouts) from `coachApi.getAlerts` rendered as the activity feed.
- Empty state when alerts are empty (no "Coming Soon").

### Future widgets (queued)

| Widget | Brief | Notes |
| --- | --- | --- |
| Latest check-ins | #92/06 | Pulls from #92/05 client check-in submissions. |
| Attention panel | #92/08 | Clients flagged by activity decay or coach-defined rules. |
| AI weekly recap | #92/10 | "Generate weekly recap" CTA (depends on backend #117). |
| Voice / tone editor entry | #92/11 | One row in Settings, but the toggle status is exposed on the Dashboard. |
| Ready-to-scale checklist | #92/12 | A list of business hygiene items the coach should clear. |
| Revenue snapshot | #92/19 | This week / month, vs last; tap-through to Money tab when shipped. |
| Storefront-views snapshot | #96/01 | Once the storefront ships, the coach sees views / clicks / conversions on Dashboard. |

The Dashboard is **not** a single scrolling stack of widgets. It is two columns at tablet widths, single column on phones, and the order is fixed: KPIs → Attention → Activity feed → Money. A coach should be able to glance at the top quarter of the screen and know "what is this week" without scrolling.

## Offline / loading / error states

- **AsyncBoundary** wraps every dashboard query. KPIs render skeleton tiles in the loading state, not spinners.
- **OfflineBanner** sits at the top via `RootNavigator`.
- **Authoring screens** (Programs, Offers, Templates, InviteCodes) explicitly disable submit while offline rather than queueing — the coach should know their write didn't land.
- **Realtime drops** fall back to a 60 s poll for messages and a 30 s poll for unread counts (already shipped).
- **Errors** surface backend errors verbatim. No "Something went wrong."

## Test plan (per implementation PR)

- Unit: `__tests__/coachNavigation.test.ts` (already shipped) guards `SettingsStack` shape; extend per future tab additions.
- Unit: API client request shapes for any new coach endpoint (`__tests__/billingAndAccountApi.test.ts` is the prior art).
- Integration: smoke walk through Sign in as coach → Dashboard renders → Clients list → ClientDetail → send nudge → Settings → Billing portal opens.
- Manual smoke: `docs/RELEASE_SMOKE.md` real-device-proof checklist (Android 13+ APK install).
- Tenancy: a coach signed in as `coach_a` cannot see `coach_b`'s clients (asserted at the API level; covered by backend tests, but verified by the mobile QA matrix).
- Doctrine: same grep budget as the client side.

## Analytics

- PostHog events scoped `role: 'coach'`. Required (target — implemented per #93/08):
  - `coach_dashboard_viewed`, `coach_alert_acked`, `coach_invite_code_created`, `coach_invite_code_revoked`, `coach_template_published`, `coach_message_sent`, `coach_billing_portal_opened`, `coach_account_deletion_scheduled`, `coach_account_deletion_cancelled`.
- **Sentry** tags include `role: 'coach'` and (when team-mode lands) `team_role: 'head' | 'junior'`.

## Feature flags

- `useFlag('coach_v2_dashboard')` — gates a future re-shape of `CoachHomeScreen`.
- `useFlag('coach_programs_tab')` — gates the swap of Templates → Programs.
- `useFlag('coach_money_tab')` — gates the new Money tab.
- `useFlag('coach_community_tab')` — gates the Community tab (depends on #96/07 + backend #122).
- `useFlag('coach_team_mode')` — gates junior-coach role rows (depends on backend #118).
- `useFlag('coach_storefront_authoring')` — gates the #96/01 storefront editor.

Flags are role-scoped — a `coach_*` flag does not affect client surfaces.

## Acceptance criteria

A coach-app implementation PR is *done* when:

- The coach lands on `Dashboard`, not `Home`. There is no `Home` route on the coach side.
- The tab bar nouns are coach nouns. No `Log`, no `Train`, no `Profile` (settings is reachable, but not as a tab named "Profile").
- The new surface lives in `src/screens/coach/` (or as a shared screen mounted by `CoachNavigator` only). It does not import from `src/screens/client/`.
- `src/screens/coach/README.md` and `src/navigation/README.md` are updated.
- AsyncBoundary, OfflineBanner, named primitives, and `useFlag()` are reused — no inline alternatives.
- The build types-check and tests pass; doctrine grep passes.
- Tenancy is verified in QA: a coach signed in as `coach_a` sees no data for `coach_b`.
- A client who logs into the same build does **not** see the new coach surface.
- The empty state is explicit and actionable — "Add your first client" rather than "Loading…".

## Operator handoff

- **Owning surfaces**: `src/navigation/CoachNavigator.tsx`, `src/screens/coach/**`, `src/screens/coach/README.md`, the shared `TrustCenterScreen.tsx`.
- **Out-of-band**:
  - PostHog flags must exist before a release that consumes them.
  - Stripe billing portal URLs must be configured in `EXPO_PUBLIC_*`-derived backend env (not the mobile build's env).
  - Sentry `release` must upload sourcemaps (per `services/sentry.ts`).
  - When the second EAS project lands, `expo.extra.eas.projectId`, `bundleIdentifier`, `package`, `scheme`, and `associatedDomains` are all *added* per a coach-only branch — never modified for the client build.
- **Done means**: a coach opens the app on Monday morning, immediately sees what is this week (KPIs + alerts + revenue snapshot), acts in two taps, and the experience does not feel like it inherited a single piece of chrome from the client app.
