# 11 — Deep links readiness

> Pre-build brief. Defines how new deep-link routes are added without breaking the current `tgp://join/<code>` + Universal Links contract, and what verification is required.

## WHY

The app already routes `tgp://join/<code>` and `https://app.trygrowthproject.com/join/<code>` to `CreateAccountScreen` (per `app.json`, `src/navigation/RootNavigator.tsx`, `src/utils/deepLink.ts`, `docs/HANDOFF.md` §3.1, and `docs/INVITE_DEEPLINK_QA.md`). What is **not** written down:

- The pattern a new deep-link route follows (e.g. `tgp://coach/<id>`, `tgp://recipe/<id>`, `tgp://checkin/<id>` — at least one of these will exist for #92 item 16, public coach profile).
- The verification checklist a new route ticks before merging.
- The interaction with auth state — what happens if the user follows `tgp://recipe/<id>` while signed out, while in onboarding, or while on the wrong role.

The expansion features need new routes (#92 item 16: public coach profile is explicit; #92 item 5 weekly check-ins implies "open today's check-in via notification", which is a deep link). Without a written pattern, every route reinvents the auth-gate handling, which is where deep-link bugs traditionally hide.

## WHEN

Land this brief before the first new deep-link route ships in the expansion pack. That is currently #92 item 16 (public coach profile).

## WHERE

When implemented:

- `src/navigation/RootNavigator.tsx` — `linking.config.screens` extended with the new route shapes.
- `app.json` — `expo.ios.associatedDomains` and `expo.android.intentFilters` extended only when the route uses HTTPS Universal/App Links (custom-scheme routes don't require app.json changes beyond the existing entry).
- `docs/well-known/` — `apple-app-site-association` and `assetlinks.json` templates updated for any new HTTPS path prefix.
- `src/utils/deepLink.ts` — extended parser if a route has non-trivial param shapes (UUIDs, URL-safe slugs).
- `docs/DEEP_LINKS.md` (new) — the canonical map of routes + auth gates.
- `docs/INVITE_DEEPLINK_QA.md` — already exists for the invite path; cross-link.

## WHO

- **Engineer**: when adding a route, registers it in `RootNavigator` linking config and `docs/DEEP_LINKS.md`.
- **Mobile lead**: blocks merge if any of (a) auth-gate behaviour, (b) `app.json` intent filter, (c) `assetlinks` / `apple-app-site-association` template are out of sync.
- **Operator/PM**: gives the canonical URL shape ("we want `https://app.trygrowthproject.com/coach/<slug>`"), confirms the marketing host can serve the file.

## WHAT

### Route shape rules

1. **Custom scheme (`tgp://`)**: any new path is allowed, no app.json change. Cheap and immediate; works without DNS.
2. **Universal/App Links (`https://app.trygrowthproject.com/...`)**: a new path prefix requires (a) an entry in `expo.ios.associatedDomains` (already wildcards via `applinks:` host — no change typically), (b) an entry in `expo.android.intentFilters[].data[].pathPrefix`, (c) updated `apple-app-site-association` and `assetlinks.json` files served at `https://app.trygrowthproject.com/.well-known/`.
3. **Both shapes always coexist** — every public deep link is reachable via both `tgp://<route>` and `https://app.trygrowthproject.com/<route>`. The HTTPS form is the canonical one in messaging; the custom-scheme form is the fallback for environments that strip Universal Links.

### Auth-gate matrix

Every route declares which auth states it tolerates:

| Auth state | Custom-scheme route | HTTPS route |
| --- | --- | --- |
| `unauthenticated` | Route to AuthNavigator with the deep-link target stashed; resume after sign-in. | Same. |
| `onboarding` | Route to OnboardingNavigator; resume after onboarding. | Same. |
| `coach` / `student` | Route directly. | Same. |
| `loading` | Stash; route once boot completes. | Same. |

The "stash and resume" plumbing lives in `src/utils/deepLink.ts`; this brief codifies that every new route uses it instead of rolling their own.

### Per-route metadata

Each entry in `docs/DEEP_LINKS.md` answers:

- **Path**: `tgp://coach/<slug>` and `https://app.trygrowthproject.com/coach/<slug>`.
- **Lands on**: route name in the navigator (e.g. `PublicCoachProfile`).
- **Required role**: `student` / `coach` / `any`.
- **Param shape**: e.g. `slug` is `[a-z0-9-]{1,32}`.
- **Source of truth**: where the URL is generated (e.g. invite emails, coach share sheet).
- **Smoke test**: one-liner the QA matrix ([brief 10](./10-mobile-qa-matrix.md)) executes per release.

## HOW

1. Write `docs/DEEP_LINKS.md` with the rules + an empty per-route table.
2. Migrate the existing `join/<code>` route into the table as the canonical example.
3. Extend `src/utils/deepLink.ts` (if needed) for the next route's param shape.
4. Update `app.json` intent filters / `associatedDomains` only when an HTTPS prefix is added.
5. Update `docs/well-known/` templates and the `apple-app-site-association` / `assetlinks.json` files.
6. Verify with `xcrun simctl openurl` (iOS simulator) and `adb shell am start` (Android emulator).

## Expo / EAS considerations

- `expo.ios.associatedDomains` change requires a fresh native build (config plugin re-runs in `eas build`). OTA is not enough.
- `expo.android.intentFilters` likewise — a `versionCode` bump and a new build are required.
- `autoVerify: true` on Android requires the `assetlinks.json` to be served correctly **before** the build is published, otherwise Android rejects auto-verification and falls back to the chooser.
- iOS Universal Links require `apple-app-site-association` at `https://app.trygrowthproject.com/.well-known/apple-app-site-association` with `Content-Type: application/json` (no extension) and HTTPS-served. Verify with `curl -I` after every DNS or marketing-site change.
- `EXPO_PUBLIC_HELP_BASE_URL` is a separate URL; not a deep link, it's a regular open-URL. No interaction.

## Acceptance criteria

- `docs/DEEP_LINKS.md` exists with the rules + a per-route table that includes `join/<code>`.
- One new route (proposed: `coach/<slug>` for #92 item 16) is added end-to-end as the canonical example: navigator entry, parser entry, `app.json` filters, `.well-known` templates, smoke test.
- The smoke test runs in CI on at least the simulator/emulator level.
- `npm run validate:config` keeps passing — the validator already checks intent-filter and `associatedDomain` shape per `docs/HANDOFF.md` §3.

## Rollout strategy

- **Phase 1**: ship `docs/DEEP_LINKS.md` with the existing `join/<code>` migrated in.
- **Phase 2**: add the new `coach/<slug>` route (or whatever the first expansion route is).
- **Phase 3**: extend the QA matrix [brief 10](./10-mobile-qa-matrix.md) with the new smoke test.
- **Phase 4**: each subsequent feature follows the same pattern.
- Rollback: revert the navigator entry + the intent filter; the well-known files can be left in place harmlessly.

## Tests

- Unit (`deepLink.test.ts`): the parser correctly extracts params; rejects malformed paths.
- Unit (`linking.test.tsx`): `RootNavigator`'s linking config maps each declared path to the right screen.
- Manual:
  - iOS simulator: `xcrun simctl openurl booted "tgp://coach/example-slug"` lands on the right screen.
  - Android emulator: `adb shell am start -W -a android.intent.action.VIEW -d "https://app.trygrowthproject.com/coach/example-slug" com.growthproject.app` lands on the right screen.
  - HTTPS path verification: `curl -I https://app.trygrowthproject.com/.well-known/assetlinks.json` returns 200 and JSON.
  - From a fresh install (no cached auth), `tgp://join/<code>` still works (regression check).

## Risks

- **`assetlinks.json` not served correctly** breaks Android auto-verification silently. Mitigation: a release-blocking smoke check that `curl`s the file before promotion.
- **iOS Universal Links require Apple to crawl the AASA** — propagation can take hours. Tested on internal builds before any external promotion.
- **Custom-scheme links open but don't auth-gate properly**: covered by the auth-gate matrix above and the `deepLink.test.ts` cases.
- **Deep-link source-of-truth drift** between mobile, web, and the marketing host. Mitigation: `docs/DEEP_LINKS.md` is the canonical document; the marketing site links from there.
- **Backend-generated URLs** (e.g. invite URLs) ship the wrong path: backend lead reviews `docs/DEEP_LINKS.md` per route addition.

## Dependencies

- `docs/INVITE_DEEPLINK_QA.md` — existing, kept as the deep-dive on the invite path.
- `docs/HANDOFF.md` §3.1 — current state of intent filters.
- `scripts/validate-app-config.js` — already validates intent filters and `associatedDomains`.
- No backend dependency for the route shape; backend ownership is whoever generates the URL.

## Operator handoff

- **Owning surface(s)**: `docs/DEEP_LINKS.md`, `src/navigation/RootNavigator.tsx`, `src/utils/deepLink.ts`, `app.json`, `docs/well-known/`, `scripts/validate-app-config.js`.
- **Out-of-band steps**: ensure marketing site (`app.trygrowthproject.com`) hosts the updated `apple-app-site-association` and `assetlinks.json` at the `.well-known/` paths before promotion. Verify with `curl`. Apple takes time to crawl; allow a buffer day.
- **Done means**: an engineer adds a new deep-link route by editing one navigator block, one parser, one `app.json` array (if HTTPS), one well-known file (if HTTPS), and one row in `docs/DEEP_LINKS.md`. The route works on a fresh install in both signed-in and signed-out states.
