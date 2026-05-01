# Role experience — ORG mode extension

Companion to [PR #97](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/97)
(`docs/role-experience/`). This doc extends the role contract defined in
that pack to cover **ORG mode** — a head coach who has hired sub-coaches and
manages them inside the app. Until ORG mode is enabled for a coach, the
existing two-role contract (client / coach) stands unchanged.

This is a docs-only spec. No `src/`, `app.json`, `eas.json`, or CI is
modified. Runtime work is sequenced after the backend Wave 2 spec
`growth-project-backend/docs/product/sub-coach-hierarchy.md` lands.

---

## 0. Hard cross-repo dependency

ORG mode on mobile cannot ship without the backend Wave 2 spec
**`docs/product/sub-coach-hierarchy.md`** in `growth-project-backend`. That
spec owns:

- The `users.org_id`, `users.org_role`, and `org_memberships` shape (or the
  equivalent — backend chooses the table layout).
- The `/api/v1/org/*` and `/api/admin/orgs/*` endpoint surface this doc
  consumes.
- The audit-on-write rules for sub-coach promotion, demotion, and
  reassignment.
- The Stripe-side hooks that the finance app's
  `docs/billing/sub-coach-billing-split-spec.md` mirrors.

If the backend spec has not landed when a runtime PR for this work opens,
the runtime PR is paused. Until then, the role detection in
[`src/navigation/RootNavigator.tsx`](../../src/navigation/RootNavigator.tsx)
keeps treating any non-client role as `coach` and the org tab is hidden.
The hard-dependency note is mirrored in the repo-root `PERP_HANDOFF.md`.

---

## 1. Role variants

PR #97's two-role contract is preserved:

- **client** — a paying member.
- **coach** — runs a coaching business inside the app.

ORG mode introduces two **variants of the existing `coach` role**, not a
new top-level role. The five-state auth machine in
[`src/navigation/RootNavigator.tsx`](../../src/navigation/RootNavigator.tsx)
is unchanged. What changes is which `CoachNavigator` shape the user lands
in once `bootstrapAuth()` resolves to `coach`.

| Variant | Stored as | Renders | Org-tab visible | Can invite sub-coaches | Can see roster | Can edit org settings |
|---|---|---|---|---|---|---|
| `client` | `user_data.role === 'client'` *(or legacy `'student'`)* | `ClientNavigator` | n/a | n/a | n/a | n/a |
| `sub-coach` | `user_data.role === 'coach'` AND `user_data.org_role === 'sub_coach'` | `CoachNavigator` (limited) | no | no | no (own clients only) | no |
| `head-coach` | `user_data.role === 'coach'` AND `user_data.org_role === 'head_coach'` | `CoachNavigator` (full) + Org tab | yes | yes | yes | yes |
| `coach` (solo, ORG mode off) | `user_data.role === 'coach'` AND `user_data.org_role` is null/absent | `CoachNavigator` (full) | no | no | n/a | n/a |

`org_role` is read from `user_data` (the same AsyncStorage key the role
detection already reads). It is written by the backend on login and on
every refresh of `/api/auth/me`. The mobile client never derives or mutates
`org_role` locally.

The legacy `student` value is normalised to `client` per PR #97. ORG mode
does not introduce additional legacy values.

---

## 2. Detection and routing

The five-state machine in `RootNavigator.bootstrapAuth()` resolves to
`coach` when `user_data.role === 'coach'`. Inside the `coach` branch, the
navigator picks the `CoachNavigator` variant by reading
`user_data.org_role`:

```
bootstrapAuth() →
  if user_data.role === 'coach':
    if user_data.org_role === 'sub_coach':
      mount <CoachNavigator variant="sub-coach"/>
    else:
      mount <CoachNavigator variant="head-coach-or-solo"/>
```

The single `<CoachNavigator/>` component reads its variant from a top-level
prop (or from the same `user_data.org_role` value via a `useIdentity()`
hook, whichever is cheaper at runtime). The variant is **not** a new
navigator type — it gates affordances inside the existing tree.

For the `head-coach-or-solo` rendering, the org tab is shown iff
`user_data.org_role === 'head_coach'`. A solo coach (no `org_role` set)
sees the existing tab set unchanged.

### 2.1 Variant change at runtime

`org_role` can change while the app is running (e.g. a sub-coach gets
promoted, or ORG mode is enabled on a previously solo coach). The trigger
is a backend-pushed re-auth event over the existing `authEvents` bus:

| Event | Side effect | UI behaviour |
|---|---|---|
| `org_role:promoted` | Mobile re-fetches `/api/auth/me`, writes new `user_data`, calls `authEvents.emit('roleChanged')` | `RootNavigator` remounts the matching `CoachNavigator` variant. React Query cache is **not** invalidated; React Query persisted cache survives the variant swap because the underlying user id is unchanged. |
| `org_role:demoted` | Same as above | Same as above. The org tab is unmounted. Any in-flight org-scoped queries are cancelled by react-query's mount-tracking. |
| `org_role:reassigned` | Same as above | Same as above. Visible client roster changes; existing client-scoped queries are invalidated by the standard `clients` query key family. |

The transitions are write-server / read-client. Mobile never optimistically
flips `org_role`.

---

## 3. Navigation contract

### 3.1 head-coach navigator (full + Org tab)

Tabs in left-to-right order on the bottom bar. Existing tab order is
preserved; the **Org** tab is inserted between **Clients** and
**Settings**.

```
[ Home ] [ Clients ] [ Org ] [ Messages ] [ Settings ]
   ⌂        clients   org      msg          gear
```

The icons are token-driven Ionicons names (`home-outline`,
`people-outline`, `business-outline`, `chatbubble-outline`,
`settings-outline`). The label policy follows the existing icon-only client
tab bar — accessibility labels only, no on-screen text.

The `Org` tab is a stack navigator, structured identically to the existing
coach stacks:

```
OrgStack (org tab root: OrgIndex)
├── OrgIndex                 — roster + roll-up cards (default)
├── SubCoachDetail           — single sub-coach drilldown
├── SubCoachInvite           — generate / share invite code
├── OrgSettings              — org-wide settings (name, payout split, branding)
└── OrgRevenueRollUp         — finance roll-up surface (consumes finance app data via federation)
```

Param-list contract:

```ts
export type OrgStackParamList = {
  OrgIndex:           undefined;
  SubCoachDetail:     { subCoachUserId: string };
  SubCoachInvite:     undefined;
  OrgSettings:        undefined;
  OrgRevenueRollUp:   { range?: '7d' | '30d' | '90d' | 'mtd' | 'qtd' };
};
```

The serialisable param shape (no functions, no Date objects) is enforced
the same way the existing `RecipeDetail: { recipeId: string }` route is.

### 3.2 sub-coach navigator (limited)

The sub-coach tab bar is the existing coach tab bar minus the **Org** tab
(which is hidden) and minus the **Clients** scope expansion (sub-coaches
see only their own client roster, never the org-wide roster).

```
[ Home ] [ Clients ] [ Messages ] [ Settings ]
   ⌂        clients   msg          gear
```

Affordances hidden inside the sub-coach variant:

| Surface | Sub-coach variant | Head-coach variant |
|---|---|---|
| ClientsList shows | own clients only | all org clients (with sub-coach owner pill on each row) |
| `BillingScreen` ("Revenue") | own revenue only | own + org rollup link |
| `InviteCodesScreen` | hidden (cannot create new client invite codes — head coach owns the invite surface for the org) | full |
| `Settings → Account → Coach profile` | scope: personal coach profile | scope: personal coach profile **and** org settings link |
| `Org tab` | hidden | shown |

The runtime change to render the sub-coach variant is a single conditional
at the navigator level — no screen needs to be deleted, only its tab entry
hidden via `tabBar` filtering. This preserves the param-list typings and
keeps the existing `CoachNavigator.tsx` diff small.

### 3.3 Why "limited coach UX" for sub-coaches and not a separate navigator

The natural alternative is `<SubCoachNavigator/>` as a peer of
`<CoachNavigator/>`. Rejected because:

- Two navigators duplicate the screen-import surface and re-create the
  drift problem the theme migration (PR #74) just fixed.
- Sub-coach screens are a subset of coach screens, not a different shape.
- Most state/store hooks (`useCoachData`, `useCoachStore`,
  `useClientData`) are scoped by `userId` already; a sub-coach naturally
  sees only their own data because the backend gates by `org_membership`.
- Adding a `variant` prop is a 5-line change to the existing navigator.
  Adding a new navigator is hundreds of lines of import duplication.

---

## 4. Org tab — screen specs

### 4.1 OrgIndex (roster + roll-up cards)

This is the screen the head coach lands on when they tap the Org tab.

```
+-----------------------------------------------+
|  ←  Org                                  [+]  |   <- header. [+] -> SubCoachInvite
+-----------------------------------------------+
|  This week                                    |
|                                               |
|  Active sub-coaches      4                    |
|  Active org clients      87                   |
|  Org revenue (this mo)   £18,420.00           |
|  Coaches needing review  1   (taps -> filter) |
+-----------------------------------------------+
|  Sub-coaches                                  |
+-----------------------------------------------+
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  [JD] Jamie Doe                               |
|       12 active clients · last active 4h ago  |
|       Compliance: on track                    |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  [SR] Sam Riley                               |
|       19 active clients · last active 2d ago  |
|       Compliance: 1 client overdue check-in   |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  [LC] Lana Cole                               |
|       6 active clients · last active 9h ago   |
|       Compliance: on track                    |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  [TM] Theo Marsh                              |
|       4 active clients · last active 12h ago  |
|       Compliance: 2 clients overdue check-in  |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
+-----------------------------------------------+
|  See revenue roll-up →                        |
+-----------------------------------------------+
```

Component breakdown (all token-driven primitives from `src/theme/tokens.ts`
and the named primitives spec'd in PR #93 brief 05):

- **header**: standard `<ScreenHeader title="Org" rightAccessory={<IconButton icon="add"/>}/>`. Right action navigates to `SubCoachInvite`.
- **roll-up card**: `<RollUpCard>` containing four `<MetricRow>` rows
  (label left, value right, no decoration). Money values render via the
  existing money-format helper (Decimal-safe, locale-aware).
- **roster section**: `<SectionHeader>` then a `FlatList` of
  `<SubCoachRow>` items separated by hairline dividers (the same divider
  the existing `ClientsList` uses).
- **footer link**: `<TextLink>` navigating to `OrgRevenueRollUp` with the
  default range.

Empty state — no sub-coaches yet:

```
+-----------------------------------------------+
|  ←  Org                                  [+]  |
+-----------------------------------------------+
|                                               |
|                                               |
|                  No sub-coaches yet           |
|                                               |
|        Invite a sub-coach to share your       |
|        client roster and split coaching.      |
|                                               |
|              [ Invite a sub-coach ]           |
|                                               |
|                                               |
+-----------------------------------------------+
```

The empty-state CTA navigates to `SubCoachInvite`. Copy is one line, no
exclamation, no celebratory chrome.

### 4.2 SubCoachDetail

Drilldown on a single sub-coach. Reachable from any roster row.

```
+-----------------------------------------------+
|  ←  Sam Riley                                 |
+-----------------------------------------------+
|  [SR]                                         |
|                                               |
|  Sam Riley                                    |
|  sam@thegrowthproject.app                     |
|  Sub-coach since Jan 2026                     |
|                                               |
|  Status: Active                               |
+-----------------------------------------------+
|  Clients (19)                                 |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  Aria Patel — last check-in 2d ago            |
|  Ben Lowe — last check-in 5d ago (overdue)    |
|  ...                                          |
+-----------------------------------------------+
|  This month                                   |
|  Revenue                          £4,210.00   |
|  New clients (signups)            3           |
|  Overdue check-ins                1           |
|  Programs assigned                7           |
+-----------------------------------------------+
|  [ Message Sam ]    [ Reassign clients ]      |
|  [ Pause sub-coach ]   [ Remove from org ]    |
+-----------------------------------------------+
```

`Reassign clients`, `Pause sub-coach`, and `Remove from org` are
destructive-class actions and follow the existing destructive-action
pattern in the app (modal confirmation, type-the-name-to-confirm for
removal, `Haptics.impactAsync(Heavy)`, then a single backend call). They
all hit endpoints owned by the backend Wave 2 spec; until those endpoints
exist the buttons render disabled with a tooltip "Available when sub-coach
hierarchy ships in growth-project-backend Wave 2."

### 4.3 SubCoachInvite

Two-step flow: (1) configure the invite, (2) share.

```
Step 1
+-----------------------------------------------+
|  ←  Invite a sub-coach                        |
+-----------------------------------------------+
|  Invite type                                  |
|    ( ) New sub-coach (creates org seat)       |
|    ( ) Promote an existing solo coach         |
+-----------------------------------------------+
|  Default revenue split                        |
|    Head coach        70 %                     |
|    Sub-coach         30 %                     |
|    (slider, 60/40 to 90/10)                   |
+-----------------------------------------------+
|  Default client cap                           |
|    [ 25 ]   clients per sub-coach             |
+-----------------------------------------------+
|  Notes (optional)                             |
|  [ ............................ ]             |
+-----------------------------------------------+
|              [ Generate invite ]              |
+-----------------------------------------------+
```

```
Step 2
+-----------------------------------------------+
|  ←  Invite a sub-coach                        |
+-----------------------------------------------+
|  Invite ready                                 |
|                                               |
|  Code            G7-WX9P                      |
|  Link            tgp://join-coach/G7-WX9P     |
|  Universal link  https://app.trygrowthproject |
|                  .com/join-coach/G7-WX9P      |
|                                               |
|  Expires         in 14 days                   |
|  Clients cap     25                           |
|  Split           70 / 30                      |
|                                               |
|              [ Copy code ]                    |
|              [ Copy link ]                    |
|              [ Share... ]                     |
+-----------------------------------------------+
|  Active invites                               |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  G7-WX9P · 0 / 1 used · expires 14 May        |
|  K2-LM4F · 0 / 1 used · expires 8 May         |
+-----------------------------------------------+
```

Deep link contract for the sub-coach invite path: see §6.

### 4.4 OrgSettings

Single-screen settings list in the existing `Settings`-screen pattern.
Sections: **Org profile**, **Default split**, **Compliance defaults**,
**Branding**, **Danger zone** (transfer org / dissolve org).

Acceptance: no new component primitives are required for this screen — it
reuses `<SettingsRow>`, `<SettingsSection>`, and `<DestructiveButton>` from
the existing `SettingsScreen.tsx`.

### 4.5 OrgRevenueRollUp

Read-mostly screen that consumes data from the **finance app's** roll-up
surface (see `tgp-finance-app/docs/billing/finance-org-roll-ups.md`).

Mobile renders five `<MetricCard>` cells, a 30-day MRR sparkline, and a
`<SubCoachContributionTable>` showing each sub-coach's share of org MRR.
Money values are Decimal-safe — values arrive from the finance app
already-formatted as strings preserving two decimal places, never as
JavaScript numbers.

```
+-----------------------------------------------+
|  ←  Org revenue                               |
|     [ 7d ] [ 30d* ] [ 90d ] [ MTD ] [ QTD ]   |
+-----------------------------------------------+
|  Org MRR                            £18,420.00|
|  Org ARR                          £221,040.00 |
|  New MRR (30d)                       £1,860.00|
|  Churn MRR (30d)                       £420.00|
|  Net new MRR (30d)                   £1,440.00|
+-----------------------------------------------+
|  Trend (30d MRR)                              |
|  [ sparkline, 30 points, no labels, hairline ]|
+-----------------------------------------------+
|  Contribution by sub-coach                    |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  Sam Riley     £4,210.00     22.9 %           |
|  Lana Cole     £3,640.00     19.7 %           |
|  Jamie Doe     £3,180.00     17.3 %           |
|  Theo Marsh    £1,490.00      8.1 %           |
|  Head coach    £5,900.00     32.0 %           |
+-----------------------------------------------+
```

The range chips drive a single query parameter passed to the finance-app
read endpoint. Caching follows the existing persisted-React-Query pattern
in `App.tsx`. Cache buster is bumped if the wire shape changes.

---

## 5. State machine — sub-coach lifecycle

States and transitions, as observed by the mobile client. The backend is
the source of truth — these are the states the mobile UI must render
correctly.

```
            invited                       removed
[ none ] ────────► [ pending ] ──accept──► [ active ] ──remove──► [ none ]
                       │   │                   │   │
                  expire│   │revoke      pause │   │unpause
                       ▼   ▼                   ▼   │
                   [ expired / revoked ]   [ paused ]
                                                   │
                                                resume│
                                                   └───┘
```

| State | Mobile-visible | Sub-coach can sign in | Roster row badge | Affordances head coach sees |
|---|---|---|---|---|
| none | no row | n/a | — | — |
| pending | yes (greyed) | no | "Invite sent" | Resend, Revoke |
| active | yes | yes | (none, default) | Message, Reassign, Pause, Remove |
| paused | yes (greyed) | yes (read-only mode on coach side) | "Paused" | Resume, Reassign, Remove |
| expired / revoked | no row | no | — | — |

Paused sub-coaches retain access to the app and to their own client roster
in **read-only** mode (they can see clients and history, cannot send
messages, cannot assign programs, cannot accept new clients). The
read-only mode is enforced server-side; the mobile UI mirrors it by
rendering action buttons disabled with the helper "Paused by head coach."

Persisted storage:

- `user_data.org_role` — AsyncStorage. Re-read on every `authEvents`
  emit.
- `user_data.org_status` — AsyncStorage. Holds `active | paused`. Used by
  the sub-coach variant to render the `Paused` banner.
- `user_data.org_id` — AsyncStorage. Used as a query key for org-scoped
  React Query cache; the cache is namespaced by `org_id` so rejoining a
  different org does not surface stale roster data.

A sign-out clears `org_role`, `org_status`, `org_id` along with the
existing `SIGN_OUT_KEYS` array in `src/services/authActions.ts`.

---

## 6. Deep link contract — sub-coach invite

The existing client invite path is `tgp://join/<code>` (and the
Universal Link `https://app.trygrowthproject.com/join/<code>`). PR #71 is
working to make Android App Link autoverification actually work.

The sub-coach invite path is **additive** and follows the same shape:

| Custom scheme | Universal link |
|---|---|
| `tgp://join-coach/<code>` | `https://app.trygrowthproject.com/join-coach/<code>` |

Why a different prefix:

- It lets the backend route invite-code lookups to the right model (a
  client invite and a sub-coach invite are different rows with different
  RBAC consequences).
- It lets the marketing site produce different landing pages for the two
  shapes — a client landing page is a sales pitch; a sub-coach landing
  page is a contractor agreement.
- It lets the parser in `src/utils/deepLink.ts` reject malformed input
  cleanly and return a typed `{ kind: 'client_invite' | 'coach_invite';
  code: string }` discriminated union.

Parser contract (additive to `src/utils/deepLink.ts`):

```ts
type ParsedInvite =
  | { kind: 'client_invite';  code: string; ref?: string }
  | { kind: 'coach_invite';   code: string; ref?: string };

function parseInviteUrl(url: string): ParsedInvite | null;
function buildClientInviteLink(code: string, ref?: string): string;
function buildCoachInviteLink(code: string, ref?: string): string;

const INVITE_CUSTOM_SCHEME = 'tgp';
const INVITE_UNIVERSAL_HOST = 'app.trygrowthproject.com';
const CLIENT_INVITE_PATH = '/join';
const COACH_INVITE_PATH = '/join-coach';
```

The existing constants stay unchanged; new constants are additions.

Linking config in `RootNavigator.tsx`:

```
prefixes: ['tgp://', 'https://app.trygrowthproject.com']
config: {
  screens: {
    CreateAccount:        'join/:invite_code?',
    CreateCoachAccount:   'join-coach/:invite_code?',
  },
},
```

`CreateCoachAccount` is a **new** screen in `AuthNavigator`, not an
extension of `CreateAccount`. The two screens have different first-line
copy, different invite-validation endpoints, different terms-acceptance
language (sub-coach has a contractor agreement; client has the standard
ToS), and different post-signup destinations (sub-coach lands in the
coach onboarding flow; client lands in the existing 10-step or Lean
onboarding). Conflating them into one screen produced repeated drift in
prior reviewers' feedback.

`app.json` Android intent filters and iOS associated-domain entries: the
**existing** entries cover both paths because they prefix-match `/join`
and `/join-coach` on the same host. No `app.json` change is required for
this spec to be implementable. The `validate:config` script (PR #71) will
need to add a check that **both** paths are reachable; the addition is a
two-line array extension and is part of the runtime PR, not this docs PR.

The Apple App Site Association (`apple-app-site-association`) and
Android App Links (`assetlinks.json`) hosted-files in `docs/well-known/`
already cover the host. They do not need to enumerate paths — they
delegate to the runtime parser. No change required.

Universal Links and App Links autoverification still require PR #71 to
land first. Until then, `https://app.trygrowthproject.com/join-coach/<code>`
opens an Android chooser the same way the client path does today.

---

## 7. Performance roll-up cards — data contract

The four metrics on `OrgIndex` ("This week" panel) and the per-sub-coach
metrics on `SubCoachDetail` come from a single backend endpoint. The mobile
contract is:

```
GET /api/v1/org/summary
  -> {
       org_id: string,
       org_name: string,
       active_sub_coaches: number,
       active_org_clients: number,
       month_to_date_revenue: { amount: string, currency: string },
       coaches_needing_review_count: number,
       generated_at: string,             // ISO 8601
     }

GET /api/v1/org/sub-coaches
  -> [
       {
         user_id: string,
         display_name: string,
         initials: string,
         email: string,
         status: 'pending' | 'active' | 'paused' | 'revoked' | 'expired',
         active_clients: number,
         last_active_at: string | null,  // ISO 8601, null when never signed in
         compliance: {
           overdue_checkins: number,
           last_program_assigned_at: string | null,
         },
       },
       ...
     ]

GET /api/v1/org/sub-coaches/:user_id
  -> {
       user_id: string,
       display_name: string,
       email: string,
       status: ...,
       since: string,                     // ISO 8601
       clients: [...],                    // existing client-row shape
       this_month: {
         revenue: { amount: string, currency: string },
         new_signups: number,
         overdue_checkins: number,
         programs_assigned: number,
       },
     }
```

Money fields come back as `{ amount: string, currency: string }` —
strings, not numbers, to preserve `Decimal(14,2)` precision through JSON
parsing. The mobile client formats them through the existing money-format
helper. This pattern matches the finance-app federation surface in
`backend/src/admin/federation/`.

Times come back as ISO 8601. The mobile client renders them through the
existing `formatTimeAgo()` helper in `CommunityScreen.tsx` (which is
already extracted to a shared util).

The endpoints are owned by the backend Wave 2 sub-coach spec. Until they
exist:

- The mobile screens are gated behind a feature flag check via the planned
  `useFlag('org_mode_v1')` hook ([PR #93](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/93)
  brief 02). With the flag off, the Org tab is hidden and `OrgStack` is
  not registered.
- The flag is OWNER-controlled in PostHog, not user-toggleable.
- The `useEntitlement('org_mode')` ([PR #94](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/94)
  brief 09) is the second gate: even if the flag is on, the user has to
  be on a tier that includes Org mode. The L2/L3 mapping is owned by the
  finance app's `sub-coach-billing-split-spec.md`.

---

## 8. Empty / loading / error states

Per PR #93 brief 07, every query-backed screen is wrapped in
`<AsyncBoundary/>` with the standard four states: idle, loading, error,
empty. The org screens follow the same pattern.

| Surface | Loading | Error | Empty |
|---|---|---|---|
| `OrgIndex` roll-up panel | skeleton metric rows (4 lines) | "We could not load the org summary. Pull to retry." with retry button | n/a — head coach in ORG mode always has a summary; an empty result returns zeros, not a 404 |
| `OrgIndex` roster | skeleton rows (3) | "We could not load the sub-coach roster." retry | empty state per §4.1 |
| `SubCoachDetail` | header + skeleton sections | "We could not load this sub-coach." retry, plus a "Back to roster" button | n/a — drilldown only reached from a row that exists |
| `OrgRevenueRollUp` | skeleton metric cards + sparkline placeholder (hairline rectangle, no animated shimmer) | "Revenue data is temporarily unavailable. Pull to retry." | "No revenue this period." (no zeros rendered) |

The `<AsyncBoundary/>` contract is owned by PR #93. This spec only states
the mappings.

---

## 9. Analytics events

Names follow the registry spec in PR #93 brief 08 — verb-noun, snake_case,
no PII in the payload. New events introduced by this spec:

| Event | When | Payload fields |
|---|---|---|
| `org_tab_opened` | head coach taps the Org tab | `org_id` |
| `sub_coach_invite_started` | head coach taps Invite a sub-coach | `org_id` |
| `sub_coach_invite_generated` | head coach completes step 1 of invite flow | `org_id`, `default_split_pct`, `default_client_cap` |
| `sub_coach_invite_shared` | head coach taps Copy code / Copy link / Share... | `org_id`, `share_method: 'code' \| 'link' \| 'native'` |
| `sub_coach_invite_redeemed` | mobile detects deep link landing on `CreateCoachAccount` | `org_id` (parsed from preview), `via: 'custom_scheme' \| 'universal_link'` |
| `sub_coach_paused` | head coach pauses a sub-coach | `org_id` |
| `sub_coach_resumed` | head coach unpauses a sub-coach | `org_id` |
| `sub_coach_removed` | head coach removes a sub-coach | `org_id` |
| `sub_coach_reassign_started` | head coach taps Reassign clients | `org_id`, `client_count` |
| `sub_coach_reassign_completed` | head coach confirms reassignment | `org_id`, `client_count` |
| `org_revenue_rollup_viewed` | mobile renders `OrgRevenueRollUp` | `org_id`, `range` |

Existing events (`coach_signed_in`, `coach_invite_sent`, etc.) are unchanged.
Events fire through the existing `track()` wrapper in `src/lib/analytics.ts`.

---

## 10. Acceptance criteria

A runtime PR closing this spec is accepted when **all** of the following
are true. These are written so a runtime PR can copy them verbatim into
its description.

1. `RootNavigator.bootstrapAuth()` resolves to `coach` and the
   `CoachNavigator` variant is selected by `user_data.org_role`. No new
   top-level auth state is added. The five-state machine is unchanged.
2. `<CoachNavigator/>` accepts a `variant: 'sub-coach' | 'head-coach' |
   'solo'` derived from `user_data.org_role`. The `Org` tab renders only
   when `variant === 'head-coach'`.
3. `OrgStackParamList` is exported from `src/navigation/CoachNavigator.tsx`
   matching the contract in §3.1.
4. `<AsyncBoundary/>` wraps every query-backed surface listed in §8 and
   the loading/error/empty mappings match.
5. `useFlag('org_mode_v1')` gates the Org tab and `OrgStack`. With the
   flag off, the build is identical to the pre-spec build.
6. `useEntitlement('org_mode')` is the second gate. With the entitlement
   absent, the Org tab renders with a single-row "Org mode is part of the
   Pro tier" upgrade prompt and no other content. The upgrade row routes
   to `MembershipScreen`.
7. `parseInviteUrl()` returns the discriminated union from §6 for both
   `tgp://join/<code>` and `tgp://join-coach/<code>` and their universal
   counterparts. `buildClientInviteLink` and `buildCoachInviteLink` build
   the canonical universal forms.
8. `AuthNavigator` registers `CreateCoachAccount` as a separate screen
   from `CreateAccount`. Both deep links route to their respective
   screens.
9. `validate:config` (PR #71) checks both `/join` and `/join-coach`
   resolutions. The script change is included in the runtime PR.
10. Analytics events from §9 fire from the named callsites and pass the
    typed payload schema check from PR #93 brief 08.
11. The jest doctrine test in
    `src/__tests__/quietLuxuryDoctrine.test.ts` continues to pass: no
    emoji, no "Coming Soon", no streak/badge/trophy vocab in the new
    surfaces.
12. `src/__tests__/` adds at minimum:
    - a unit test for `parseInviteUrl()` covering both kinds and the
      ref-source variant, plus malformed input,
    - a unit test for the variant-selection logic in `CoachNavigator`,
    - a render test for `OrgIndex` covering loading / error / empty /
      populated.
13. Sentry tag conventions from PR #93 brief 08 set `org_id` on every
    org-scoped scope so org-scoped crashes are filterable.
14. The runtime PR ships behind the feature flag in **off** state. The
    Wave 2 backend endpoints from §7 must be live in production before
    the flag is enabled for any user.

---

## 11. Out of scope for this spec

- **Sub-coach onboarding flow content.** Owned by
  [`onboarding-mobile-flows.md`](./onboarding-mobile-flows.md). This
  spec only defines where the onboarding is reached from (the
  `CreateCoachAccount` deep-link path), not what it shows.
- **Org-scoped messaging.** Sub-coach-to-head-coach broadcast and
  pinned-thread shapes are owned by the messaging-v2 spec
  ([PR #94](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/94)
  brief 07).
- **Coach storefront under an org umbrella.** Owned by the Whop expansion
  pack ([PR #96](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/96)
  brief 01).
- **Per-sub-coach Stripe Connect onboarding.** Owned by the finance app
  spec `tgp-finance-app/docs/billing/sub-coach-billing-split-spec.md`.
  Mobile only renders state that the finance app produces.
- **Admin-console view of orgs across the platform.** Owned by
  `growth-project-backend/docs/admin/control-room-spec.md` §11. Mobile
  is a tenant-level surface; the OWNER admin is a separate web app.
- **Junior coach vs senior coach distinction within an org.** A future
  refinement (`org_role: 'sub_coach_junior' | 'sub_coach_senior'`) is
  reserved by name only. This spec covers the binary head/sub split.
