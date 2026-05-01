# Admin Mobile Companion (optional)

The admin role is **website-first**. The dashboard that a Growth Project administrator uses every day lives in a separate web app. This brief defines a **mobile companion** for the admin role — opt-in, narrow-scope, incident-response-only — and explicitly recommends *not building it on day one*.

The reason this brief exists is that the role split needs an answer for "what does an admin see on mobile?" The honest answer is: not much, and only when something is on fire. The brief makes that answer explicit so a future contributor does not bolt admin chrome onto the coach app or the client app.

## WHY (and why optional)

Admins do work that does not belong on a phone:

- Multi-tenant audit logs, export pipelines, manual ledger adjustments, schema-level config changes, support-ticket triage with attachments, financial reporting, KYC reviews.

That work belongs on a desktop browser with a wide screen, real text input, and a multi-tab workflow. Trying to build the same surface on a 6-inch screen produces a worse version of the web dashboard and a worse version of the coach app.

What a phone *is* good for, in admin context, is **incident response**:

- Page-style alerts when a critical event hits.
- One-tap acknowledgement that a human is on it.
- Read-only status views (queue depth, error rate, dunning backlog).
- A small set of reversible actions (extend a billing trial, freeze a coach's account during fraud review, reply to a high-priority support ticket).

If we ship a mobile admin companion, this is its purpose. Anything wider belongs on the web.

## WHEN

- Optional, off by default.
- Gated behind `useFlag('admin_mobile_companion')` with an `admin` role assignment server-side.
- Built only after both the client and coach apps have stabilised on `RootNavigator` role gating; the admin role would be the third gate, not the first.

## WHERE

If built:

- **Same binary** as the client + coach apps initially. `RootNavigator` gains an `admin` `AuthState` mounted on `AdminNavigator`.
- **Separate bundle** is *not* warranted for admin. The admin user count is small enough that a separate store listing is overhead, not signal.
- Source location: `src/navigation/AdminNavigator.tsx` + `src/screens/admin/` (do not exist today; spec only).

## WHO

- Growth Project staff with `role: 'admin'` on the user record.
- Sub-roles (`support`, `finance`, `engineering-on-call`) are *future* and gated per platform-readiness/04 once Team Mode primitives apply to admin as well as coach.
- A coach is **not** an admin and never sees the admin companion. A coach who is also a Growth Project employee gets two roles via the role-switcher described in `02-coach-app.md`.

## WHAT (Information Architecture, if built)

The companion is intentionally tiny. Three tabs:

| Tab | Route | Purpose |
| --- | --- | --- |
| Alerts | `AlertsStack` | The page queue. Critical alerts at top; tap → `AlertDetail` with actions. |
| Queues | `QueuesStack` | Read-only depth views: dunning, KYC, support tickets, application funnel inbox (#96/04). |
| Account holds | `HoldsStack` | The narrow set of reversible actions. Trial extensions, account freezes, deletion-cancel windows. |

A fourth tab — Settings — is reachable from the right-aligned header icon, not as a tab. Auth, push prefs, sign out, links to web dashboard.

### What the admin companion is *not*

- Not a place to author content, programs, or storefronts.
- Not a place to read full audit logs.
- Not a place to run reports.
- Not a place to make irreversible decisions (ledger adjustments, schema migrations, account deletion). Those require the web dashboard with the big-keyboard guardrails.

### What the admin companion **never** shows

- Any other coach's authoring surfaces (the admin sees *summaries*, not the coach's templates).
- Any client's PII beyond what the support-ticket flow legitimately exposes.
- Raw payment card data or unredacted API tokens (per `docs/platform-readiness/08-crash-and-analytics-readiness.md` redaction rules).

## HOW (navigation, role entry, role switching)

- `RootNavigator.bootstrapAuth()` extended: when `user.role === 'admin'`, mount `AdminNavigator`.
- A user with both `admin` and `coach` roles uses the **Settings → Switch role** menu (same primitive as coach ↔ client).
- Push notification routing: payload `role: 'admin'` maps to admin alerts only. The mobile app never routes a non-admin payload to the admin queue.

## Onboarding (admin side)

- Admins are **provisioned out of band**. There is no "become an admin" CTA. The role assignment happens in the web dashboard or directly in the database.
- First-open of the admin companion shows the Alerts queue with empty state — explicit, not a placeholder. Doctrine still applies.

## Permissions

| Permission | Used | Why |
| --- | --- | --- |
| Notifications | yes | Page-style alerts. Critical channel cannot be muted in-app; admin must do it from server settings. |
| Camera / Photos | future, for support-ticket attachments only | Optional. |
| Location | no | Never. |
| Microphone | no | No voice notes on admin path. |

The admin companion **never** enables background fetch, background location, contacts, or any sensor. It runs only when the admin opens it (or a high-priority push wakes it).

## Design differences

The admin companion borrows the coach app's density and adds:

- **Red / amber / green status pills**, but as **shape + label**, never colour-only (accessibility).
- **Tabular row densities**, smaller than coach, single-line where possible.
- **No editorial chrome.** No Cormorant headlines. Inter throughout. (Cormorant on the client app communicates calm; calm is not the right register for an admin scrolling a page queue at 02:00.)
- **Identical theme tokens.** The admin companion is not a "dark theme"; the doctrine bars `#000` backgrounds and we are not introducing a second palette for admin.

## Shared components vs separate surfaces

### Shared

- Theme tokens. Auth state machine. API client. Sentry / PostHog wiring. AsyncBoundary. OfflineBanner. Push registration.
- Named primitives from platform-readiness/05.

### Separate

- `src/navigation/AdminNavigator.tsx` and `src/screens/admin/` (spec only). No imports from client / coach folders.
- The admin Messages surface, if it exists, is a *support inbox*, not a one-on-one thread. Different shape from both client and coach Messages.

## Notification strategy

Three channels:

- **Critical** — fraud, payment outages, deletion-window expirations. Page-style. Cannot be muted in-app.
- **Operational** — dunning queue depth above threshold, support-ticket backlog above threshold. Mutable in `Settings → Notification preferences`.
- **Informational** — daily summaries, optional. Off by default.

A push payload arriving in the admin channel does not route to the coach or client app. Server-enforced per `role:` on the payload.

## Dashboard widgets (Alerts tab is the dashboard)

The Alerts tab is the admin "dashboard". It has no widgets — it is a list. Each row:

- One-line headline (event type + tenant + age).
- Severity tag (critical / operational / informational).
- Tap → `AlertDetail` with full payload, related links, and a *small* set of actions:
  - Acknowledge (no other side effects).
  - Snooze 30 / 60 / 240 minutes.
  - Open in web dashboard (deep link to the web admin URL).
  - Reversible-action button if applicable (e.g. "Extend trial 14 days"). Confirm-twice.

No charts, no KPIs, no graphs on the admin Alerts tab. The web dashboard owns analytics. Mobile owns *attention*.

## Offline / loading / error states

- **Offline**: alerts list is read-only from local cache; no actions available. OfflineBanner is shown at the top.
- **Loading**: AsyncBoundary skeletons. Never a bare spinner.
- **Errors**: backend errors surface verbatim with retry. Doctrine applies.
- **Stale state**: every alert row carries an `as-of` timestamp; if the cache is older than 5 minutes, the screen surfaces a "Pull to refresh" state explicitly.

## Test plan (per implementation PR)

- Unit: navigator shape (`__tests__/adminNavigation.test.ts`), role gate (admin user mounts `AdminNavigator`, coach user does not).
- Integration: smoke walk through alerts list → detail → ack → snooze → resolved.
- Tenancy: an admin signed in as `staff_a` and one signed in as `staff_b` see the same global queue (admin is *not* tenant-scoped); a non-admin signed in does not see the queue at all.
- Manual smoke: real-device walk on Android 13+; verify push payload in critical channel actually pages.
- Doctrine: same grep budget as the other roles.

## Analytics

- PostHog events scoped `role: 'admin'`. Required (target):
  - `admin_alert_viewed`, `admin_alert_acked`, `admin_alert_snoozed`, `admin_account_hold_set`, `admin_account_hold_cleared`, `admin_open_in_web`.
- Property hygiene: never log tenant PII; the `tenant_id` is enough.
- Sentry tags: `role: 'admin'`. Errors from the admin companion are tagged so they do not pollute the coach / client error budgets.

## Feature flags

- `useFlag('admin_mobile_companion')` — top-level kill switch. Off by default.
- `useFlag('admin_holds_actions')` — gates the reversible-action buttons. Off until the audit logging on the backend is verified.
- `useFlag('admin_support_inbox')` — gates the (optional) support-ticket reply path.

## Acceptance criteria

If we ever build this, an admin-companion implementation PR is *done* when:

- A user with `role: 'admin'` lands on `AdminNavigator → AlertsStack`. A non-admin who somehow reaches that route is redirected to their normal navigator (defense in depth even though server gates the role).
- The admin companion does not import from `src/screens/client/` or `src/screens/coach/`.
- Reversible actions are confirm-twice. Irreversible actions are not present.
- A coach who logs into the same build does **not** see the admin surface.
- A client who logs into the same build does **not** see the admin surface.
- Push routing is verified end to end: a critical-channel payload addressed to `role: 'admin'` lands only on the admin surface.
- `src/screens/admin/README.md` and `src/navigation/README.md` are updated.
- Doctrine, AsyncBoundary, OfflineBanner, named primitives, and `useFlag()` are reused.

## Recommendation

**Do not build this on day one.**

The admin's day-to-day work fits the desktop. Until the operator has lived with the web dashboard for a quarter and identified the specific page-able events that wake them up at night, the mobile companion is a solution looking for a problem. Build it when there is a real list of alerts the on-call admin wants on their phone, not before.

When it does get built, this brief is the floor. Implementations should resist the temptation to widen the scope to "manage the business from your phone." That is the coach app. The admin companion is incident response.

## Operator handoff

- **Owning surfaces**: future `src/navigation/AdminNavigator.tsx`, future `src/screens/admin/**`. None of these exist on `main` today.
- **Out-of-band**: admin role is provisioned in the database / web admin; backend push channel routing must be in place; PostHog flag must exist before a release that consumes it.
- **Done means**: an on-call admin gets paged for a real incident, opens the phone, acknowledges in two taps, and either resolves a small reversible action or knows immediately that they need a laptop. Anything beyond that is a sign the companion is doing too much.
