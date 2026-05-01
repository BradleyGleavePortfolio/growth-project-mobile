# Wave 9 — Storefront builder and funnel analytics

**Status:** Pre-build, docs-only.
**Last reviewed:** 2026-05-01.
**Backend dependency:** Storefront service, funnel / applications service, payments engine. Reuses public coach card from Wave 7.
**Mobile dependencies:** Wave 6 (`Install` consent), Wave 7 (public marketplace), `docs/whop-expansion/01-coach-storefront.md`, `02-offer-builder.md`, `03-checkout-deposits-subscriptions.md`, `04-application-funnel.md` (PR #96, source material).
**Position in 6–10 order:** Fourth. Storefronts and funnels depend on marketplace presence (Wave 7) and on consent install (Wave 6). The mobile contract here is intentionally narrow — see §1 OWNER_DECISION-9.A.

---

## 1. Persona contract

| Persona | What they see and do in Wave 9 |
| ------- | ------------------------------ |
| **Owner** | Sees a global storefront / funnel monitoring dashboard on web. Mobile companion read-only. Configures global takedown / refund overrides on web. |
| **Coach** | After installing `Storefront` (Wave 6), sees `Storefront` and `Funnel analytics` rows in `Dashboard`. **On mobile, the coach gets a *preview* and a *read-only editor* — actual storefront authoring is done on web.** Sees applicants in a queue, approves / rejects each, sees funnel-stage analytics. |
| **Sub-coach** | Cannot install storefront. Can review applicants if head coach grants `applicants_review` scope (default off). |
| **Client / Student** | Existing clients are not the buyer-prospect persona. They see *their own* invoices and subscription state under `MoreStack → Account → Membership`. |
| **Ambassador / Affiliate** | Attribution surfaces are in Wave 8. Wave 9 hands-off the buyer to the funnel; the affiliate code is preserved through to enrolment. |
| **Buyer / Prospect** | Primary persona for Wave 9 — comes in via Wave 7 marketplace, sees the storefront, fills the application, completes checkout, becomes a client. |

## 2. Navigation map

### Coach side (mobile)

```
Coach Dashboard
├── StorefrontPreviewCard           — flagged behind features.storefront
└── FunnelAnalyticsCard             — flagged behind features.funnel_analytics

Coach ClientsStack
├── ClientsList
└── ApplicantsQueue                 — flagged behind features.applicants
    └── ApplicantDetail

Coach SettingsStack → Install → Storefront
├── StorefrontSummary               — read-only mirror of the web editor
└── StorefrontEditOnWebPrompt       — explicit hand-off card
```

### Buyer side (extends Wave 7's `PublicMarketplaceStack`)

```
PublicMarketplaceStack
├── ... (Wave 7)
├── StorefrontDetail                — public storefront for a coach
├── OfferDetail                     — single offer
├── ApplicationForm                 — runs the application schema
├── CheckoutSession                 — payment session abstraction
└── PostCheckoutWelcome             — bridges to onboarding (Wave 4)
```

Deep links:

| URL pattern | Route |
| ----------- | ----- |
| `tgp://m/<slug>/storefront` | `StorefrontDetail` |
| `tgp://m/<slug>/offer/<offerId>` | `OfferDetail` |
| `tgp://m/<slug>/apply/<offerId>` | `ApplicationForm` |
| `tgp://m/<slug>/checkout/<sessionId>` | `CheckoutSession` |

## 3. Screen contracts

### `StorefrontPreviewCard` (coach Dashboard)

- **Purpose:** Sparkline of storefront performance — visits this week, applications, conversions to paid. Tap opens `StorefrontSummary`.
- **Server data:** `useStorefrontSummary()` → `GET /v1/coach/me/storefront/summary`.
- **Mutations:** None.

### `StorefrontSummary`

- **Purpose:** Mobile read-only mirror of the live storefront. Shows the published offers, the public URL, the published version timestamp, and a single CTA: `Edit on web`.
- **Server data:** `useStorefront()` → `GET /v1/coach/me/storefront`.
- **`Edit on web`** opens `https://app.trygrowthproject.com/coach/storefront` in the system browser. **Mobile does not author storefronts in v1.** See OWNER_DECISION-9.A.
- **States:**
  - Loading: skeleton.
  - Empty: `No storefront published yet — set one up on web.` honest empty + link.
  - Error: AsyncBoundary retry.
  - Offline: read-only from cache; `Edit on web` disabled with toast.

### `FunnelAnalyticsCard` (coach Dashboard)

- **Purpose:** Stage funnel — `Visited storefront → Started application → Submitted → Approved → Enrolled → Active`. Each stage shows count + drop-off percentage.
- **Server data:** `useFunnelAnalytics(period)` → `GET /v1/coach/me/funnel?period=7d|30d|90d`.

### `ApplicantsQueue` (coach)

- **Purpose:** List of applications awaiting review. Same shape as `RewardsReviewQueue` (Wave 8).
- **Server data:** `useApplicants({ status: 'submitted' })`.
- **Mutations:** `approveApplicant(id)`, `rejectApplicant(id, { reasonCode })`. Approve emits a checkout-session creation; if the offer requires payment, the buyer is notified via push to complete payment.

### `ApplicantDetail`

- **Purpose:** Full application data. Coach sees the answers the buyer gave, the affiliate attribution (if any), and the chosen offer.
- **Server data:** `useApplicant(id)`.

### `StorefrontDetail` (buyer)

- **Purpose:** Public-facing storefront for a single coach. Headline, offers, optional written FAQ.
- **Server data:** `usePublicStorefront(slug)`.
- **Mutations:** None directly; per-offer CTA opens `OfferDetail`.

### `OfferDetail` (buyer)

- **Purpose:** Single offer page. Shows price, recurrence, deposit, included programs / spaces / calls. CTA depends on the offer type:
  - `paid_no_application` → `CheckoutSession` directly.
  - `application_then_paid` → `ApplicationForm` first.
  - `application_then_review` → `ApplicationForm`, coach review, then asynchronous checkout via push.
- **Server data:** `usePublicOffer(slug, offerId)`.

### `ApplicationForm`

- **Purpose:** Runtime for the coach's intake template. Renders fields per `docs/expansion/14-intake-templates.md`.
- **Server data:** `useApplicationSchema(slug, offerId)` → `GET /v1/public/coach/:slug/offers/:offerId/application-schema`.
- **Mutations:** `submitApplication({ slug, offerId, answers, ref? })` → `POST /v1/public/coach/:slug/offers/:offerId/apply`.

### `CheckoutSession`

- **Purpose:** Mobile renders a *payment session abstraction*; never a raw Stripe object (per `docs/whop-expansion/03`). For unsupported payment methods, falls back to web checkout via `expo-web-browser`.
- **Server data:** `useCheckoutSession(sessionId)`.
- **Privacy:** card fields are entered in the web fallback or in a native PaymentSheet that mobile does not log. Mobile never logs card data, never logs full email — only redacted analytics.

### `PostCheckoutWelcome`

- **Purpose:** Bridge to onboarding (Wave 4). After successful payment, signs the buyer in (account auto-created if not existing), then routes to `LeanOnboardingNavigator` or directly to `ClientNavigator → Home` depending on whether onboarding is complete.

## 4. API contract dependencies

```ts
type Offer = {
  id: string;
  title: string;
  oneLiner: string;
  price: { amount: number; currency: string };
  recurrence: 'one_time' | 'monthly' | 'quarterly' | 'annual';
  deposit: { amount: number; currency: string } | null;
  applicationMode: 'paid_no_application' | 'application_then_paid' | 'application_then_review';
  included: { programs: string[]; spaces: string[]; calls: string[]; contentBoards: string[] };
};

type Storefront = {
  slug: string;
  publishedAt: string | null;
  headline: string | null;
  offers: Offer[];
  faq: Array<{ q: string; a: string }>;
};

type FunnelAnalytics = {
  period: '7d' | '30d' | '90d';
  stages: Array<{ key: 'visited'|'started'|'submitted'|'approved'|'enrolled'|'active'; count: number; dropoffPctFromPrev: number }>;
};

type ApplicationSchema = {
  fields: Array<{
    id: string;
    kind: 'short_text'|'long_text'|'single_select'|'multi_select'|'number'|'date';
    label: string;
    required: boolean;
    options?: Array<{ id: string; label: string }>;
  }>;
};

type Application = {
  id: string;
  buyer: { displayName: string; email: string };  // email visible to coach only
  status: 'submitted'|'approved'|'rejected'|'paid_pending'|'enrolled'|'cancelled';
  offer: Pick<Offer, 'id'|'title'>;
  answers: Record<string, unknown>;
  attribution: { affiliateCode: string | null };
  submittedAt: string;
};

type CheckoutSession = {
  id: string;
  status: 'pending'|'requires_payment'|'paid'|'failed'|'cancelled';
  paymentMethods: Array<'native_pay'|'card'|'web_fallback'>;
  amount: { amount: number; currency: string };
  expiresAt: string;
};
```

Endpoints:

```
GET  /v1/coach/me/storefront                              → Storefront
GET  /v1/coach/me/storefront/summary                      → { visits7d, applications7d, conversions7d }
GET  /v1/coach/me/funnel?period=                          → FunnelAnalytics
GET  /v1/coach/me/applicants?status=                      → Application[]
GET  /v1/coach/applicants/:id                             → Application
POST /v1/coach/applicants/:id/approve                     → { ok: true; checkoutSessionId?: string }
POST /v1/coach/applicants/:id/reject                      → { ok: true }

GET  /v1/public/coach/:slug/storefront                    → Storefront
GET  /v1/public/coach/:slug/offers/:offerId               → Offer
GET  /v1/public/coach/:slug/offers/:offerId/application-schema → ApplicationSchema
POST /v1/public/coach/:slug/offers/:offerId/apply         → Application
POST /v1/public/coach/:slug/offers/:offerId/checkout      → CheckoutSession
GET  /v1/checkout/:sessionId                              → CheckoutSession
```

## 5. State and cache strategy

- React Query keys: `['coach','me','storefront']`, `['coach','me','funnel',{period}]`, `['coach','applicants',{status}]`, `['coach','applicants',id]`, `['public','storefront',slug]`, `['public','offer',slug,offerId]`, `['public','application-schema',slug,offerId]`, `['checkout',sessionId]`.
- `staleTime`: 5 min for public storefront / offer (rarely change), 30 s for funnel analytics, 30 s for applicants queue, 5 s for checkout session (active polling during payment).
- **Optimistic updates only on coach-side mutations** (approve / reject). Buyer mutations (apply, checkout) are confirmation-required and must reflect the server response.
- Offline posture: buyer flows require connectivity. Coach surfaces are read-only from cache; mutations disabled.
- Application form state is held in a local `useReducer` and persisted to AsyncStorage so a backgrounded application survives app restart.

## 6. Push and deep-link behaviour

| Event | Push payload | Deep link | Foreground |
| ----- | ------------ | --------- | ---------- |
| Application submitted (coach) | `{ kind: 'application_submitted', applicationId }` | `tgp://coach/applicants/<id>` | In-app banner. |
| Application approved (buyer) | `{ kind: 'application_approved', checkoutSessionId? }` | `tgp://m/<slug>/checkout/<sessionId>` or `tgp://onboarding` | In-app banner; if checkout pending, banner CTA opens checkout. |
| Application rejected (buyer) | `{ kind: 'application_rejected' }` | `tgp://m/<slug>` | In-app banner with honest message. |
| Checkout completed (coach) | `{ kind: 'checkout_completed', applicationId }` | `tgp://coach/clients/<id>` | In-app banner. |
| Subscription past due (client) | `{ kind: 'subscription_past_due' }` | `tgp://account/membership` | In-app banner; surface persists in `Membership`. |

The buyer-side `?ref=<code>` is preserved through the entire funnel (Wave 8 attribution). Mobile passes it along; mobile does not interpret it.

## 7. Permissions and consent

- **Buyer side:** none beyond what Wave 7 already established.
- **Coach side:** `Storefront` install consent (Wave 6) is the precondition. Approving applicants does not need an additional consent prompt; rejecting follows the same shape as rewards rejection (Wave 8).
- **Application form schema** can include consent toggles (e.g. "I agree to share my health history with this coach"). These are explicit checkbox fields; mobile does not infer consent from form submission.

## 8. Accessibility notes

- `ApplicationForm` field rendering follows `docs/platform-readiness/06-accessibility-readiness.md`. Each field has a label, error association, and dynamic-type reflow.
- `CheckoutSession` uses native `PaymentSheet` where available; the system handles accessibility natively. Web fallback inherits browser accessibility.
- `FunnelAnalyticsCard` stages are announced as `"Stage 3 of 6: Submitted, 12 — down 30 percent from previous stage."`
- Storefront preview is read-only and announces `"Storefront preview. Tap edit on web to author."`

## 9. Analytics, privacy, security

| Event | Properties | Notes |
| ----- | ---------- | ----- |
| `storefront_summary_viewed` | `{}` | No PII. |
| `funnel_analytics_viewed` | `{ period }` | No PII. |
| `applicant_reviewed` | `{ outcome, hasAttribution }` | No applicant id, no email. |
| `application_started` (buyer) | `{ slug, offerId }` | Slug + offerId are public. |
| `application_completed` (buyer) | `{ slug, offerId, fieldCount }` | Answers never logged. |
| `checkout_session_started` | `{ slug, offerId, paymentMethods }` | No card data, no amount. |
| `checkout_session_completed` | `{ slug, offerId }` | No amount in mobile event; backend has the canonical event. |

Privacy:

- Application answers contain potentially sensitive data (health history, age, weight). Mobile **never** logs the answers; only field count.
- Coach-side `Application` shape carries the buyer email — this is intentional for coach review, but mobile never logs it.
- Checkout: mobile does not store payment-method state across sessions. Each checkout session is fetched fresh.
- Refunds: not exposed in mobile v1; refunds are a web-only operation. Coach sees refund status as read-only on `Application`.

Security:

- Approve / reject mutations require fresh JWT (`iat` < 10 min) and biometric / passcode unlock if the offer carries a deposit > $0.
- The `tgp://m/<slug>/checkout/<sessionId>` link is single-use server-side; mobile reflects 410 Gone honestly.
- Web fallback uses `expo-web-browser` `openAuthSessionAsync` so the auth cookie is sandboxed; a successful payment redirects back to `tgp://m/<slug>/post-checkout/<sessionId>`.

## 10. Test plan and acceptance criteria

### Unit

- `useApplicationSchema` Zod-parses the schema; rejects unknown field kinds (forward-compat fail-loud).
- `submitApplication` carries `ref` parameter through to the API call.
- `CheckoutSession` polling stops on terminal status.

### Integration

- Buyer flow end-to-end: marketplace → storefront → offer → application → approval push → checkout → onboarding.
- Coach approves an applicant for a paid offer → buyer push fires → buyer completes checkout → coach receives `checkout_completed` push.
- Application is backgrounded and resumed; form state restored from AsyncStorage.

### Manual QA

- Reject an applicant; verify buyer sees honest message, no follow-up funnel emails are triggered from mobile.
- Switch network mid-checkout; verify session polling resumes on reconnect; verify session expiry is surfaced honestly.
- Trigger a refund server-side; verify `Application` reflects status without exposing refund authoring on mobile.

### Acceptance criteria

- [ ] Mobile **does not** author storefronts in v1. `Edit on web` is the canonical CTA.
- [ ] Mobile **does not** author offers in v1.
- [ ] Mobile **does not** issue refunds.
- [ ] Application answers are never logged client-side.
- [ ] Card data is never logged client-side.
- [ ] Approve / reject for paid offers requires biometric / passcode unlock.
- [ ] Checkout session expiry is surfaced as honest message, not as celebration / panic.
- [ ] Funnel analytics show real values; no skeleton with fake numbers.
- [ ] No "🎉 You got a new client!" celebration. Push copy is plain: `"<Buyer initial> just enrolled in <offer title>."`
- [ ] `?ref=<code>` is preserved through the entire funnel.

## 11. Phased implementation order, OWNER_DECISIONs, cross-repo deps

### Phased order

1. **Buyer-side `StorefrontDetail` + `OfferDetail` (read-only).** First runtime PR. No application, no checkout. Validates the public storefront API and Wave 7 deep-link extensions.
2. **`ApplicationForm` + `submitApplication`.** Second runtime PR. Behind `features.applications`.
3. **Coach `ApplicantsQueue` + `ApplicantDetail` (read-only).** Third runtime PR.
4. **Approve / reject mutations.** Fourth runtime PR.
5. **`CheckoutSession` (PaymentSheet path).** Fifth runtime PR. Native pay only.
6. **`CheckoutSession` web fallback.** Sixth runtime PR.
7. **`FunnelAnalyticsCard`.** Seventh runtime PR.
8. **`StorefrontPreviewCard` + `StorefrontSummary` (read-only).** Eighth runtime PR.

### OWNER_DECISIONs

- **OWNER_DECISION-9.A — Mobile storefront authoring.** Choices: (a) Read-only on mobile, edit on web (this brief's recommendation), (b) Mobile edits a subset (title, oneLiner, photo only), (c) Full mobile editor. **Recommendation:** (a). Mobile editing of public surfaces is a high-stakes, low-frequency action. The web editor is the canonical authoring environment; mobile previews and points the operator there. Reduces the surface area to keep doctrinally consistent.
- **OWNER_DECISION-9.B — Mobile refunds.** **Recommendation:** Web only. Refunds are reversible-state changes with audit needs; mobile is the wrong shape.
- **OWNER_DECISION-9.C — Application schema versioning.** Choices: (a) Server returns the canonical schema for the current offer version, (b) Mobile caches schemas per offer + version. **Recommendation:** (a). Forms must always be the latest version; cache is a footgun for compliance.
- **OWNER_DECISION-9.D — Save application as draft.** Choices: (a) AsyncStorage local draft only (this brief's recommendation), (b) Server-side draft. **Recommendation:** (a). Server-side drafts make moderation harder and create a privacy expectation. Local-only drafts are good enough for "buyer was distracted, came back later".
- **OWNER_DECISION-9.E — Coach can override application's checkout amount.** **Recommendation:** No. Pricing is on the offer, not the application. If a coach needs to make an exception, they edit the offer or apply a coupon (web).

### Cross-repo dependencies

- **Backend storefront service** — hard.
- **Backend funnel / applications service** — hard.
- **Backend payments engine** — hard for `CheckoutSession`, `PostCheckoutWelcome`.
- **Web storefront editor** — hard for `Edit on web` hand-off. Without it, OWNER_DECISION-9.A flips to (b) or (c).
- **Web payouts admin** (Wave 8) — soft; coach onboarding to Stripe Connect happens on web.

### Finance dependencies

- Stripe Connect onboarding completed for the coach. Without it, `Storefront → Publish` is disabled server-side; mobile reflects honestly.
- Tax calculation: server-side. Mobile renders amount.tax as a separate line from amount.subtotal where present.
- Currency: each offer has a single currency. No mixed-currency baskets.
