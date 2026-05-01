# Wave 6 — App architecture, admin install UX, permission prompts

**Status:** Pre-build, docs-only.
**Last reviewed:** 2026-05-01.
**Backend dependency:** Backend Wave 3 (admin lifecycle), Team Mode (cross-repo PR #118), platform-readiness contracts already drafted in PR #93.
**Mobile dependencies:** Wave 5 (#97) role contracts; Wave 3 (#93) platform-readiness; audit findings in `docs/waves-6-10/README.md` §"Audit findings on `main`".
**Why this wave is first of 6–10:** Waves 7–10 add new feature surfaces. Without the architecture refactor and the consent / install model in Wave 6, those features land on a coach app whose `ClientDetailScreen` is already 2,329 lines and whose `MoreStack` is already 18 rows. Wave 6 builds the floor; Waves 7–10 build on it.

---

## 1. Persona contract

| Persona | What they see and do in Wave 6 |
| ------- | ------------------------------ |
| **Owner** | Sees an *optional* admin companion app behind `features.admin_mobile`. Web is the primary surface. Mobile companion is incident-response only — alerts, account holds, dunning escalations, support tickets. No coach-side authoring. (Per Wave 5, #97 `03-admin-companion.md`.) |
| **Coach** | Sees the refactored coach app: split `ClientDetailStack`, regrouped `MoreStack`, denser `Dashboard`. Sees a new "Install" surface in `Settings` for installing optional modules (storefront, marketplace presence, community, copilot). Each install is a feature-flag opt-in *and* a permission consent flow. |
| **Sub-coach** | Sees the same coach shell, with the install surface filtered to the modules the head coach has granted. Cannot install modules independently. Can request access; head coach approves. |
| **Client / Student** | Sees the regrouped `MoreStack` (Plan / Track / Learn / Account). Sees plain-language permission prompts for camera, photos, microphone, calendar, notifications — each with a doctrine-compliant fallback if denied. Streak placeholder removed; `workoutDone` placeholder replaced with a real query. |
| **Ambassador / Affiliate** | Sees a single new row under `MoreStack → Account → Affiliate` *only if* they have opted in. No marketing copy in the row label. |
| **Buyer / Prospect** | Out of scope for Wave 6. (Buyer flows live in Waves 7 and 9.) |

## 2. Navigation map

### Coach app architecture refactor (single biggest change in Wave 6)

The current coach app has two architectural problems that block Waves 7–10:

1. **`ClientDetailScreen.tsx` is 2,329 lines.** It mixes overview, programs, check-ins, messages, notes, files, and billing in one file. Adding a new client-side surface (e.g. Wave 8 "rewards earned by this client", Wave 10 "rooms this client is in") today means appending another section to the bottom of an already-unmaintainable file.
2. **`Dashboard` is a thin KPI strip.** Wave 1 (`docs/expansion/06`, `08`, `19`) and Wave 2 (`docs/expansion-wave-2/08`) collectively flesh it out. None of those briefs land cleanly until the refactor is done.

The refactor splits `ClientDetail` into a typed stack:

```
ClientDetailStack
├── ClientOverview        — header, KPIs, attention flag, quick actions
├── ClientPrograms        — assigned programs, schedule, progress
├── ClientCheckins        — weekly check-in history (Wave 1 brief 05/06)
├── ClientMessages        — thread (existing screen, no behavioural change)
├── ClientNotes           — coach private notes
├── ClientFiles           — attachments, photos, intake artefacts
├── ClientBilling         — subscription, invoices, dunning state
└── ClientRewards         — rewards earned (Wave 8) — flagged
```

`ClientOverview` is the default route. The other routes are reachable via tab strip at the top of the screen (a `Material-style top tabs` pattern, tokenised, no chrome). Each sub-screen has its own React Query keys and its own AsyncBoundary (per `docs/platform-readiness/07`).

This is a refactor PR, not a feature PR. No new endpoints. Behaviour parity with the current single-file screen is the acceptance criterion.

### `MoreStack` regrouping (client app)

Today `MoreScreen` is a flat list of 18+ rows (`Recipes`, `RecipeDetail`, `GroceryList`, `ShoppingList`, `PrepGuide`, `Fast`, `Community`, `Progress`, `Settings`, `Widgets`, `Report`, `Learn`, `Plan`, `TrustCenter`, `Preferences`, `AIGuide`, `Membership`, `Notifications`). Wave 6 groups these into named sections:

| Section | Rows | Notes |
| ------- | ---- | ----- |
| **Plan** | Plan, Recipes, Grocery list, Prep guide, Fasting | Meal-side surfaces. |
| **Track** | Progress, Report, Widgets, Community | Outcome-side surfaces. |
| **Learn** | Education, AI Guide, Coach guidelines, Trust centre | Knowledge-side surfaces. |
| **Account** | Profile, Membership, Preferences, Notifications, Settings, Affiliate (entitlement-gated) | Identity-side surfaces. |

Section headers are tokenised type, no icon. Rows are unchanged from today. The grouping is presentational only — no route changes, no deep-link changes.

### Admin install surface (coach app)

A new route under the existing `SettingsStack`:

```
SettingsStack
├── SettingsHome
├── Billing
├── Install              — new, behind features.coach_install_surface
│   ├── InstallList      — list of modules with status
│   └── InstallDetail    — per-module consent + flag toggle
└── TrustCenter
```

Modules listed in `InstallList`:

| Module | Wave | Default | Consent surface |
| ------ | ---- | ------- | --------------- |
| Storefront | 9 | Off | Public surface — explicit consent required. |
| Marketplace presence | 7 | Off | Public proof — explicit consent required. |
| Community spaces | 10 | Off | Member-data implications — explicit consent required. |
| Affiliate program | 8 | Off | Payout ledger — explicit consent required. |
| AI business copilot | 10 | Off | LLM gateway access — explicit consent required. |

"Install" is a misnomer in the literal sense — nothing is downloaded. The term is the user-facing label because it matches the mental model from app marketplaces and removes the need to explain feature flags. The actual behaviour is: enabling a flag, recording a consent event, and showing the surface in the navigator.

### Sub-coach install consent flow

Sub-coaches cannot toggle `Install` themselves. The flow is:

1. Sub-coach opens `InstallList`. Each row shows `Status: Locked — request from head coach`.
2. Sub-coach taps a row. Sees `InstallDetail` in read-only mode with a `Request access` action.
3. Tapping `Request access` posts to `POST /v1/coach/install-requests` with `{ module, requested_by }`. Backend forwards to head coach as a notification.
4. Head coach receives notification (push + in-app), opens the module's `InstallDetail`, sees `Pending: <sub-coach>` and accepts or denies.
5. On accept, the sub-coach's JWT scope expands on next refresh. UI reflects the change without a manual reload (React Query invalidation on `entitlements`).

## 3. Screen contracts

### `ClientOverview` (replacement for current `ClientDetailScreen`)

- **Purpose:** Snapshot of one client. Header (name, photo, tags), KPIs (last log, last check-in, weight delta, on-track flag), attention flag if relevant (per Wave 1 `08-coach-attention-panel.md`), quick actions (message, log on behalf, generate recap).
- **Props:** `{ clientId: string }`. Pulled from `ClientDetailStack` route params.
- **Server data:** `useClientOverview(clientId)` — wraps `GET /v1/coach/clients/:id/overview`. Returns the typed shape below.
- **Mutations:** `markAttentionResolved(clientId)`. Optimistic, rolls back on 4xx.
- **States:**
  - **Loading:** Skeleton header + KPI placeholders. AsyncBoundary spinner if pull-to-refresh.
  - **Empty:** Cannot be empty for an authenticated coach viewing their own client. If the response is empty, treat as 404 → render `NotFoundView` with `Go back` action.
  - **Error:** `AsyncBoundary` retry card. Error logged to Sentry with `client_id` redacted.
  - **Offline:** Last cached snapshot is shown with a tokenised `Offline — last synced X` badge in the header. Mutations are deferred to the offline queue (per `services/foodLogQueue` shape, generalised).

### `InstallList` and `InstallDetail`

- **Purpose:** Coach-facing module install surface.
- **Server data:** `useInstallableModules()` → `GET /v1/coach/installable-modules`. Returns module metadata + current status (`available | installed | pending_request | locked`).
- **Mutations:** `installModule(moduleKey)` → `POST /v1/coach/install/:moduleKey`. Optimistic `pending` state; rolls back on 4xx.
- **States:**
  - **Loading:** Tokenised list skeleton.
  - **Empty:** Should not be empty post-launch. If empty, render `Nothing to install yet.` honest empty state.
  - **Error:** AsyncBoundary retry. Sentry-logged.
  - **Offline:** Read-only — module list from cache; install actions disabled with `Offline — try again on Wi-Fi.` toast.

### Permission prompt surfaces (client app)

Wave 6 introduces a single **`PermissionPromptModal`** primitive used by every native permission request. The primitive enforces the doctrine.

- **Props:** `{ kind: 'camera' | 'photos' | 'microphone' | 'calendar' | 'notifications', context: string, onGranted: () => void, onDenied: () => void }`.
- **Behaviour:** First-run only — re-checks `expo-permissions` status before mounting; mounts only if `undetermined`. If `denied`, opens a separate `PermissionRecoveryModal` that links to OS settings.
- **Copy contract:** Each `kind` has a fixed plain-language copy. No marketing language. No dark patterns.

The five copies (English, the only locale today):

| Kind | Title | Body | CTA | Fallback if denied |
| ---- | ----- | ---- | --- | ------------------ |
| Camera | "Use the camera?" | "We use the camera to take photos for progress and recipe scans. Photos stay on your device until you choose to share them." | "Allow camera" / "Not now" | Photos can be picked from the library; progress captures fall back to manual entry. |
| Photos | "Pick from your photos?" | "We open your photo library so you can attach a picture. We never read photos you don't pick." | "Choose photos" / "Not now" | Manual entry only. |
| Microphone | "Use the microphone?" | "Used for voice notes in messages with your coach. The recording is sent only to your coach." | "Allow microphone" / "Not now" | Text-only messaging. |
| Calendar | "Add to your calendar?" | "We add coach calls and replays to your device calendar. We don't read other events." | "Allow calendar" / "Not now" | Calls are visible in-app; native reminder is unavailable. |
| Notifications | "Send notifications?" | "We send reminders, coach messages, and check-in nudges. You can change these any time in settings." | "Allow notifications" / "Not now" | All in-app surfaces continue to function; reminders move to in-app only. |

The fallback copy is a *behavioural* contract, not a marketing one — every screen that consumes a permission also implements its denied-path so the surface stays useful. No "Enable to unlock" copy.

## 4. API contract dependencies

```ts
// New for Wave 6
type CoachClientOverview = {
  client: { id: string; displayName: string; photoUrl: string | null; tags: string[] };
  kpis: {
    lastLogAt: string | null;       // ISO
    lastCheckinAt: string | null;   // ISO
    weightDeltaKg: number | null;   // since last week, signed
    onTrack: boolean;
  };
  attention: { reason: 'no_logs_7d' | 'missed_checkin' | 'weight_off' | null };
  quickActions: Array<'message' | 'log_on_behalf' | 'generate_recap'>;
};

type InstallableModule = {
  key: 'storefront' | 'marketplace' | 'community' | 'affiliate' | 'copilot';
  title: string;
  status: 'available' | 'installed' | 'pending_request' | 'locked';
  consentRequired: Array<'public_profile' | 'public_proof' | 'member_data' | 'payout_ledger' | 'llm_gateway'>;
  entitlementTier: 'L1' | 'L2' | 'L3'; // per docs/expansion-wave-2/09-tier-gated-l2-l3.md
};

type InstallRequest = {
  id: string;
  moduleKey: InstallableModule['key'];
  requestedBy: { id: string; displayName: string };
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
};
```

Endpoints (mobile's target contract):

```
GET    /v1/coach/clients/:id/overview          → CoachClientOverview
GET    /v1/coach/installable-modules           → InstallableModule[]
POST   /v1/coach/install/:moduleKey            → { ok: true, status: 'installed' | 'pending_request' }
POST   /v1/coach/install-requests              → InstallRequest
GET    /v1/coach/install-requests?status=pending → InstallRequest[]
POST   /v1/coach/install-requests/:id/approve  → { ok: true }
POST   /v1/coach/install-requests/:id/deny     → { ok: true }
```

Backend wave: **Wave 3 admin lifecycle** + **Team Mode (PR #118)** for the sub-coach branches.

## 5. State and cache strategy

- React Query keys: `['coach','clients',id,'overview']`, `['coach','installable-modules']`, `['coach','install-requests', { status }]`.
- `staleTime` per key: 30 s for overview (KPIs change with logs), 5 min for installable modules (rarely change), 30 s for pending install requests (head coach UX needs freshness).
- Optimistic updates on `installModule`, `markAttentionResolved`, `approveInstallRequest`, `denyInstallRequest`. Rollback on 4xx.
- Offline posture: read-only for all Wave 6 surfaces. The install flow specifically requires connectivity; mutations are *not* queued offline (this prevents accidental consent recording without a fresh JWT).
- AsyncStorage usage: cache the coach's installed-modules list at sign-in time so the navigator can boot without an extra network call. Invalidate on each successful install / uninstall / sub-coach approval.
- SecureStore usage: unchanged. Wave 6 does not introduce new secrets.

## 6. Push and deep-link behaviour

| Event | Push payload | Deep link | Foreground behaviour |
| ----- | ------------ | --------- | -------------------- |
| Sub-coach install request created | `{ kind: 'install_request', requestId }` | `tgp://coach/install/requests/<id>` | In-app banner, no sound. |
| Install request approved | `{ kind: 'install_request_approved', moduleKey }` | `tgp://coach/install/<moduleKey>` | In-app banner; refetch entitlements on next foreground. |
| Install request denied | `{ kind: 'install_request_denied', moduleKey, reason }` | `tgp://coach/install` | In-app banner with reason. |

Deep-link parser changes are additive per `docs/platform-readiness/11-deep-links-readiness.md`. The existing `tgp://join/<code>` contract is not modified.

## 7. Permissions and consent

Wave 6 itself does not request a new native permission. The `PermissionPromptModal` primitive it introduces is the *contract* used by Waves 7–10 when they consume permissions. Audit checklist for any wave file consuming a permission:

- [ ] Uses `PermissionPromptModal`, not a custom modal.
- [ ] Provides denied-path behaviour that keeps the surface useful.
- [ ] Records the consent event with PostHog event `permission_prompt_resolved` and properties `{ kind, outcome: 'granted' | 'denied' | 'never_asked' }`.
- [ ] Never re-prompts within a 7-day window if the user denied. Re-entry is the OS settings link in `PermissionRecoveryModal`.

## 8. Accessibility notes

- Section headers in regrouped `MoreStack` use `accessibilityRole="header"`.
- `PermissionPromptModal` is `accessibilityViewIsModal` and traps focus.
- Install rows have `accessibilityState={{ disabled: status === 'locked' }}`.
- Status pills (e.g. `Pending`) use both colour and label, not colour alone.
- `ClientDetailStack` top tabs are reachable via screen reader as a `tablist`.
- Dynamic type up to `accessibilityLarge` is supported on every Wave 6 surface; layout reflows; no truncation of action labels.

## 9. Analytics, privacy, security

| Event | Properties | Notes |
| ----- | ---------- | ----- |
| `install_module_viewed` | `{ moduleKey }` | No PII. |
| `install_module_installed` | `{ moduleKey, source: 'self' | 'head_coach_approval' }` | No PII. |
| `install_request_created` | `{ moduleKey }` | No PII. |
| `install_request_resolved` | `{ moduleKey, outcome: 'approved' | 'denied' }` | No PII. |
| `permission_prompt_resolved` | `{ kind, outcome }` | No PII. |
| `client_detail_tab_viewed` | `{ tab }` | No `client_id`. |

Privacy:

- Coach-facing screens redact `client_id` and `client_email` from Sentry breadcrumbs.
- Install consent records carry a `consented_at` timestamp and the head coach's id (for sub-coach approvals). They are revocable via `Uninstall`, which performs a soft-delete on the consent record and emits `install_module_uninstalled`.
- Public-proof modules (Storefront, Marketplace) carry an additional `public_proof_consent_v: 1` field, reset on schema change.

Security:

- `Install` actions require a fresh JWT — if `iat` is older than 10 minutes, the surface forces a silent refresh before the action lands.
- Sub-coach approval requires the head coach's biometric / device-passcode unlock (per the existing `feat/apple-signin-biometric` shape, PR #73). Without unlock, the action button is disabled.

## 10. Test plan and acceptance criteria

### Unit

- `PermissionPromptModal` returns the correct copy for each kind.
- `useInstallableModules` parses the API response with Zod; rejects unknown `key`.
- `installModule` rolls back on 4xx.

### Integration

- Coach view of `ClientDetailStack` renders all six tabs without crashing for the full backend matrix (active, paused, archived, deleted client).
- `MoreScreen` regrouping renders all four sections; deep-linking to a moved row still works (e.g. `tgp://more/recipes`).
- Sub-coach `Request access` posts the right payload and disables the row optimistically.

### Detox (manual, deferred)

- Install module → consent appears → confirm → module visible in navigator next foreground.
- Permission prompt → deny → recovery modal → settings deep link.

### Acceptance criteria (copy verbatim into the runtime PR)

- [ ] `ClientDetailScreen.tsx` is replaced by `ClientDetailStack/` directory; no single sub-file exceeds 600 lines.
- [ ] `MoreScreen` renders four named sections (Plan / Track / Learn / Account); no flat list.
- [ ] `SettingsStack` exposes the `Install` route behind `features.coach_install_surface`.
- [ ] `PermissionPromptModal` is the only permission entry point; no `Permissions.askAsync` is called outside it.
- [ ] Sub-coach `Request access` flow sends the request, head coach receives push, head coach approves, sub-coach surface refreshes within one foreground.
- [ ] Profile streak placeholder removed from `ProfileScreen.tsx` line 131.
- [ ] `HomeScreen.tsx` `workoutDone` placeholder replaced with a real query.
- [ ] No new emoji, no celebration chrome, no streak/badge/trophy vocabulary added.
- [ ] All five permission copies match the table in §3 verbatim.
- [ ] `MoreStack` regrouping does not break any existing deep link (regression test for `tgp://more/<route>`).

## 11. Phased implementation order, OWNER_DECISIONs, cross-repo deps

### Phased order (within Wave 6)

1. **Refactor `ClientDetailScreen` → `ClientDetailStack`.** Standalone PR. No new endpoints. Behaviour parity. Audit-finding fix.
2. **Regroup `MoreScreen`.** Standalone PR. Presentational only. Audit-finding fix.
3. **Remove profile streak placeholder + replace `workoutDone` placeholder.** Standalone PR. Audit-finding fix. Mirrors Wave 4 progression endpoint shape.
4. **Introduce `PermissionPromptModal` and migrate existing permission requests.** Standalone PR. No behaviour change to permission outcomes; consolidates the surface.
5. **Add `Install` surface (`InstallList`, `InstallDetail`).** Coach-only. Behind `features.coach_install_surface`.
6. **Add sub-coach request / approve flow.** Depends on backend Team Mode (PR #118). Behind `features.team_mode` *and* `features.coach_install_surface`.
7. **Add admin companion shell (optional).** Behind `features.admin_mobile`. Per Wave 5 #97 `03-admin-companion.md`. Day-one not required.

Each step ships as its own runtime PR, behind its own flag. Step 1 unblocks Steps 2–7; the rest are largely independent.

### OWNER_DECISIONs

- **OWNER_DECISION-6.A — Coach bundle split.** Wave 5 (#97) describes a future *dedicated coach bundle* (own bundle id, own store listing). Wave 6 explicitly assumes the **single bundle** posture. **Recommendation:** stay single-bundle through Waves 6–10. Re-evaluate at the start of a Wave 11+ planning session, when coach surface area justifies the operational cost of a second EAS project.
- **OWNER_DECISION-6.B — Admin mobile companion day one?** **Recommendation:** No. Web is primary; mobile companion is an opt-in for owners on call. Build the shell in Wave 6 step 7 *only if* an oncall owner asks for it. Default `features.admin_mobile = off`.
- **OWNER_DECISION-6.C — Where does `Install` actually live?** Choices: (a) Settings stack (this brief's recommendation), (b) Dashboard top-bar action, (c) New top-level route. **Recommendation:** (a). Settings is where coaches already go for billing and trust centre; install is the same shape. Avoids adding a sixth tab.
- **OWNER_DECISION-6.D — Sub-coach approval requires biometric?** **Recommendation:** Yes, where biometric is available; passcode fallback otherwise; never approval without one. Reduces "wrong-tap" risk on a public-impacting consent.

### Cross-repo dependencies

- **Backend Wave 3 admin lifecycle** — install / uninstall / consent endpoints. Hard dependency for Steps 5–7.
- **Backend PR #118 Team Mode** — sub-coach role primitives. Hard dependency for Step 6.
- **Web admin dashboard** — owner approval mirror for sub-coach install requests. Soft dependency: mobile sub-coaches can request and head coaches can approve from mobile alone. Web parity is desirable but not blocking.
- **Backend OpenAPI** — must publish `CoachClientOverview`, `InstallableModule`, `InstallRequest` shapes. Mobile consumes via `src/services/api.ts` Zod parses.

### Finance dependencies

- None for Wave 6 itself. Wave 6 modules are *consent surfaces*; the financial primitives they unlock (Wave 8 affiliate payouts, Wave 9 storefront checkout) live in their own wave files.
