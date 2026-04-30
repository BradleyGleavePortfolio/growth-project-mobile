# 16 — Public coach profile + deep-link contract

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Web (primary) + Mobile handoff
**Owner:** Web team primary; mobile contributes the deep-link contract and
the coach-side authoring surface.

## WHY

Coaches need a shareable URL — a single link they can put in their bio,
in DMs, on a flyer — that introduces them and converts to a signup
bound to their account. Today the only conversion path is an invite
code, which is deliberate but invisible. A public profile page is the
*marketing* layer; the invite code is the *binding* layer. The two work
together: the public page issues a binding link, mobile honours that
binding via deep-link, and the rest of the existing onboarding flow
runs unchanged.

The mobile work for this feature is **not** building the public page
(that's web). It is:
1. Authoring the profile fields from inside the coach app.
2. Honouring the deep-link contract so taps from the public page open
   the correct screen with the binding intact.

## WHEN to build

Coordinate with web. Mobile work blocks on:
- Web team finalising the public-page route (e.g.
  `https://app.trygrowthproject.com/c/<slug>`).
- Backend exposing read endpoints for coach profile data and a slug
  index.

Mobile authoring can start as soon as the field schema is agreed; the
deep-link wiring lands once the web route is reachable in staging.

## WHERE in the repo

- New coach screen: `src/screens/coach/PublicProfileEditorScreen.tsx`
  (entry from `SettingsScreen` row "Public profile").
- Deep link parser update:
  - `app.json`'s `intentFilters` and `associatedDomains` already cover
    `app.trygrowthproject.com` for `/join`. Extend the existing parser
    in `src/services/` (or wherever `buildInviteUniversalLink` lives;
    see `InviteCodesScreen`) to also accept a `/c/<slug>` path that
    routes to a "Coach preview + sign up" screen, optionally
    pre-binding via a query param `?invite=<code>`.
  - Add `src/screens/auth/CoachLandingScreen.tsx` — the in-app landing
    page when the user follows a `/c/<slug>` link from outside.
- API: `coachApi.getMyPublicProfile`, `updateMyPublicProfile`,
  `clientApi.getCoachPublicProfileBySlug` (for the in-app landing).
- Type: `src/types/publicProfile.ts`.

## WHO owns and uses it

- **Builder (mobile):** Coach team for authoring; auth/onboarding team
  for the landing screen and deep-link wiring.
- **Builder (web):** Web team for the public page.
- **Author:** Coach.
- **Audience:** Prospective clients (web visitors). On a tap, they
  arrive on mobile via universal link / Android App Link.

## WHAT MVP includes

- **Authoring (mobile coach):** name, slug (read-only after first
  save; admin can change later), tagline, bio (300-char cap), photo
  (single image, square crop), one external link (validated URL),
  toggle "Show profile publicly" — when off, the public page returns
  404 and links no-op.
- **Deep-link contract (mobile):**
  - `tgp://c/<slug>` and `https://app.trygrowthproject.com/c/<slug>`
    both route to `CoachLandingScreen`.
  - Optional query param `?invite=<code>` carries an invite code
    binding through to onboarding.
  - The parser reuses the existing universal-link infrastructure;
    `app.json` already has the host configured for `/join`. Add `/c`
    to the path prefixes — see HOW.
- **In-app landing (`CoachLandingScreen`):** read-only render of the
  same profile data; a single "Continue with this coach" CTA that
  drops into the existing onboarding flow with the binding pre-set.

### Out of scope for v1

- Profile analytics (impressions, taps).
- Multiple links / social icons.
- Custom theme per coach.
- Verified-coach badge.
- Profile reviews / testimonials.

## HOW to implement safely

1. **Don't break existing deep-links.** The `/join/<code>` path is
   live and tested. Any change to the parser must be additive.
   Snapshot tests on the parser before touching it.
2. **`app.json` change must be reviewed end-to-end.** Adding a new
   `pathPrefix` to `intentFilters` requires a new EAS build; flag-on
   is not enough on Android. Coordinate the rollout with web so the
   public page goes live *after* a build with the new pathPrefix is
   in TestFlight / Internal Testing.
3. **Slug uniqueness is the backend's job.** Mobile validates only
   character set and length client-side, then trusts the 409 from
   `updateMyPublicProfile`.
4. **Image upload is deferred** if the signed-URL flow isn't ready.
   Ship without the photo field rather than ship a half-working
   uploader.
5. **Public-off must be honest.** If the toggle is off, `/c/<slug>`
   on mobile should render an honest "This profile isn't available"
   screen, not a 404 alert. Web team should match.

## Screens / navigation sketch

```
Coach side
─────────
SettingsScreen
  └─ "Public profile"  ──► PublicProfileEditorScreen
                            ├─ Slug (read-only after first save)
                            ├─ Name / tagline / bio / external link
                            ├─ Photo (optional v1)
                            ├─ Toggle: "Show profile publicly"
                            └─ Save

Public web page (out of scope here)
───────────────────────────────────
https://trygrowthproject.com/c/<slug>
  └─ "Get started" button  ──► https://app.trygrowthproject.com/c/<slug>?invite=<code>
                                (universal link to mobile)

Mobile deep-link arrival
────────────────────────
deep-link  ──► CoachLandingScreen (slug lookup)
                ├─ render profile (read-only)
                └─ "Continue with this coach"  ──► existing signup flow,
                                                   binding pre-set if invite present
```

## API contract dependency

- `GET /coach/public-profile/me` → `PublicProfile`
- `PUT /coach/public-profile/me` body `PublicProfile` → `PublicProfile`
- `GET /public/coach/:slug` → `PublicProfile | 404` (also feeds the
  web page).
- Existing invite redemption already accepts a code; no shape change
  there.

## Feature flag / rollout

- Flag: `features.coachPublicProfile`.
- Authoring lands first behind the flag, off by default.
- Deep-link parser change requires a build; the `app.json` update is
  coordinated with web and shipped in a release where the flag can be
  flipped on coach-by-coach.
- Kill switch hides the editor row and disables the in-app landing
  (renders the "not available" screen for the slug path).

## Testing plan

- Unit: deep-link parser — `tgp://join/X`, `tgp://c/X`,
  `tgp://c/X?invite=Y`, plus the universal-link equivalents.
- Component: editor save flow, slug-conflict 409, photo absent.
- Integration: tap a `/c/<slug>` universal link in iOS and Android
  builds → app opens to landing → continue → onboarding receives the
  invite.
- Manual: cold-start deep-link (app not running) on both platforms;
  warm-start (already in foreground); verify profile-off → "not
  available" screen on both.

## Risks

- **Native build required for the path-prefix change.** A flag-only
  rollout is insufficient. Plan around an EAS release.
- **Universal-link regression.** Existing `/join` flow is critical
  for the invite product. Don't ship a parser change without
  end-to-end coverage on both platforms.
- **Slug squatting.** Backend should reserve common words; mobile
  doesn't try to defend against this.
- **Spam / abuse on bios.** Out of scope for v1; doc that moderation
  is server-side later.

## Dependencies

- Backend: `public_profile` table, three endpoints, slug index, image
  upload for photo (if not deferred).
- Web team: public page route, design, OG tags.
- Mobile: `app.json` `intentFilters` and `associatedDomains` update,
  parser extension.

## Acceptance criteria

- [ ] Flag off → no editor row; deep-link path `/c/<slug>` opens an
      honest "not available" screen.
- [ ] Flag on → coach can author, save, and toggle visibility.
- [ ] Universal link `https://app.trygrowthproject.com/c/<slug>` opens
      the app to `CoachLandingScreen` on iOS and Android (cold +
      warm start).
- [ ] `?invite=<code>` query param flows through to onboarding.
- [ ] Existing `/join/<code>` flow has zero regressions.
- [ ] No hardcoded hex; theme tokens only.
- [ ] `app.json` `intentFilters` change is reviewed alongside web
      go-live and lands in an EAS build before flag flip.
