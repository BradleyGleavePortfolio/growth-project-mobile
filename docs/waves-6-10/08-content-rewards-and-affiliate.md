# Wave 8 — Content rewards and affiliate

**Status:** Pre-build, docs-only.
**Last reviewed:** 2026-05-01.
**Backend dependency:** TGP-balance ledger (cross-repo backend wave), payments engine (cross-repo backend wave), public-proof consent ledger.
**Mobile dependencies:** Wave 6 (`Install` → `Affiliate program` consent flow), `docs/whop-expansion/05-affiliate-referral-dashboards.md`, `docs/whop-expansion/09-rewards-bounties.md` (PR #96, source material).
**Position in 6–10 order:** Third. Affiliate / referral dashboards depend on the install consent surface from Wave 6 and on the marketplace slug from Wave 7.

> **Doctrine note.** This wave introduces the words "rewards" and "balance". They are deliberate choices — `rewards` is the *redeemable* term for content the coach approves, and `balance` is the wallet word. Neither is a streak, badge, or trophy. PR #70's vocabulary excision still holds: nothing animates, nothing celebrates, no flame icon, no XP bar.

---

## 1. Persona contract

| Persona | What they see and do in Wave 8 |
| ------- | ------------------------------ |
| **Owner** | Sees a global affiliate / rewards monitoring dashboard on web. Mobile companion read-only. Sets payout caps and review thresholds from web. |
| **Coach** | Sees `Settings → Install → Affiliate program` (Wave 6). On install, sees a coach-side `Affiliate dashboard` row in `Dashboard` and a `Rewards review` row under `ClientsStack`. Reviews and approves client-submitted content. Configures the rewards (credit per submission, redemption catalogue). Sees referral attribution per affiliate. |
| **Sub-coach** | Cannot install affiliate program. *Can* review rewards submissions if head coach grants `rewards_review` scope (default off). |
| **Client / Student** | Sees a `Submit a reward` action under `MoreStack → Track` *only if* their coach has installed the program. Sees a `Balance` line on `ProfileScreen` when their balance > 0. Submits content (photo of a meal, video of a workout, written note) for a reward. |
| **Ambassador / Affiliate** | Distinct entitlement on a client. Sees a new `Affiliate` row under `MoreStack → Account`. Generates referral links scoped to the coach's slug. Sees attribution of pending vs paid referrals. Sees their balance in TGP-balance. |
| **Buyer / Prospect** | Lands via `tgp://m/<slug>?ref=<code>`. Attribution is tied to the affiliate code. No buyer-visible affiliate UI; the code is silent. |

## 2. Navigation map

### Coach side

```
Coach Dashboard
└── AffiliateDashboardCard          — flagged behind features.affiliate

Coach ClientsStack
├── ClientsList
└── RewardsReviewQueue              — flagged behind features.rewards_review
    └── RewardSubmissionDetail
```

### Client / Ambassador side

```
Client MoreStack → Track
├── ...
└── SubmitReward                    — flagged behind features.rewards_submit
    └── RewardSubmissionDetail (own)

Client MoreStack → Account
├── ...
├── Balance                         — visible only when balance > 0
└── Affiliate                       — entitlement-gated
    ├── AffiliateHome
    ├── ReferralLinks
    ├── AttributionLedger
    └── PayoutHistory
```

Deep links:

| URL pattern | Route |
| ----------- | ----- |
| `tgp://rewards/submit` | `SubmitReward` |
| `tgp://rewards/review` | `RewardsReviewQueue` (coach) |
| `tgp://affiliate` | `AffiliateHome` |
| `tgp://affiliate/links` | `ReferralLinks` |
| `tgp://m/<slug>?ref=<code>` | `CoachCardPreview` (Wave 7) — `ref` parameter recorded server-side at first hit |

## 3. Screen contracts

### `SubmitReward` (client)

- **Purpose:** Client submits content (photo/video/note) for a reward, scoped to their coach's program.
- **Server data:** `useRewardableActions()` → `GET /v1/coach/me/rewardable-actions`. Returns the list of submission types the coach has enabled and the credit value of each.
- **Mutations:** `submitReward({ kind, mediaUploadId, note? })` → `POST /v1/rewards/submissions`. Optimistic — submission appears in client's history with `Pending` status.
- **States:**
  - Loading: skeleton form.
  - Empty: `Your coach has not enabled any reward submissions yet.` honest empty.
  - Error: AsyncBoundary retry.
  - Offline: media is queued (existing `services/foodLogQueue` pattern, generalised); submission posted on next connection. Client sees a tokenised `Queued — will submit on Wi-Fi.` indicator.

### `RewardsReviewQueue` (coach)

- **Purpose:** Coach review queue. List of pending submissions; tap to review each.
- **Server data:** `useRewardSubmissions({ status: 'pending' })` → `GET /v1/coach/rewards/submissions?status=pending`.
- **Mutations:** `approveSubmission(id, { creditOverride? })` → `POST /v1/coach/rewards/submissions/:id/approve`. `rejectSubmission(id, { reasonCode })` → `POST /v1/coach/rewards/submissions/:id/reject`. Optimistic; rolls back on 4xx.
- **States:**
  - Loading: skeleton list.
  - Empty: `No submissions to review.` honest empty.
  - Error: AsyncBoundary retry.
  - Offline: read-only from cache; mutations disabled with toast.

### `RewardSubmissionDetail`

- **Purpose:** Per-submission detail. Client sees their own submissions; coach sees any client's submission.
- **Server data:** `useRewardSubmission(id)`.
- **Mutations:** Coach: approve / reject (above). Client: `revokeSubmission(id)` while still pending.
- **Privacy contract:** if media is a photo, it is presented at low-res in the list and full-res only on detail open. The `expo-image-manipulator` strips EXIF before upload.

### `AffiliateHome` (ambassador / affiliate)

- **Purpose:** Wallet + summary card. Pending vs paid referrals, current TGP-balance, next payout date.
- **Server data:** `useAffiliateSummary()` → `GET /v1/me/affiliate/summary`.
- **Mutations:** None directly.

### `ReferralLinks`

- **Purpose:** Generate and copy referral links. One per coach the user is an affiliate of.
- **Server data:** `useReferralLinks()` → `GET /v1/me/affiliate/links`. Each link is `{ slug, code, url, qrPng? }`.
- **Mutations:** `regenerateLink(slug)` (rate-limited).
- **Share affordance:** native share sheet via `expo-sharing` with the link URL only — no pre-filled marketing copy. Copy field is plain.

### `AttributionLedger`

- **Purpose:** Per-attribution row showing the buyer's anonymised initial, the date, and the credit value.
- **Server data:** `useAttributions({ status })` → `GET /v1/me/affiliate/attributions?status=pending|paid`.
- **Privacy contract:** the buyer is shown only as `displayInitial` and `joined: <date>`. Never name, never email.

### `PayoutHistory`

- **Purpose:** Past payout events from TGP-balance.
- **Server data:** `usePayoutHistory()` → `GET /v1/me/payouts`. Shows `{ amount, currency, status, settledAt? }`.
- **Mutations:** None — payouts are server-driven.

### `Balance` (client)

- **Purpose:** Single read-only screen. Shows current TGP-balance in display currency, with a `What is this?` link to `Trust centre`.
- **Server data:** `useBalance()` → `GET /v1/me/balance`.
- **Mutations:** `redeem(item)` → `POST /v1/me/balance/redeem`. Items are coach-defined; v1 is a simple list (e.g. "Free week of program X", "1:1 call with coach"). Redemption is itself a TGP-balance debit.

## 4. API contract dependencies

```ts
type RewardableAction = {
  kind: 'meal_photo' | 'workout_video' | 'weekly_recap_note' | 'before_after' | 'check_in';
  title: string;
  description: string;
  creditValue: number;       // in TGP-balance units
  perWeekLimit: number | null;
  publicProofEligible: boolean;  // can the coach later mark this as opt-in public?
};

type RewardSubmission = {
  id: string;
  clientId: string;
  kind: RewardableAction['kind'];
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  mediaUrl: string | null;
  note: string | null;
  creditValue: number;
  createdAt: string;
  reviewedAt: string | null;
  reviewer: { id: string; displayName: string } | null;
  rejection: { reasonCode: 'low_quality' | 'off_topic' | 'duplicate' | 'unsafe' | null; coachNote: string | null };
};

type AffiliateSummary = {
  pending: { count: number; totalCredits: number };
  paid: { count: number; totalCredits: number };
  balance: { amount: number; currency: string };
  nextPayoutDate: string | null;
};

type ReferralLink = {
  slug: string;             // coach slug
  code: string;             // unique to this affiliate
  url: string;              // https://app.trygrowthproject.com/m/<slug>?ref=<code>
};

type Attribution = {
  id: string;
  buyer: { displayInitial: string };
  joinedAt: string;
  status: 'pending' | 'paid';
  creditValue: number;
};

type Balance = {
  amount: number;
  currency: string;
  redeemableItems: Array<{ id: string; title: string; cost: number; description: string }>;
};
```

Endpoints:

```
GET  /v1/coach/me/rewardable-actions                   → RewardableAction[]
POST /v1/rewards/submissions                           → RewardSubmission
GET  /v1/coach/rewards/submissions?status=             → RewardSubmission[]
GET  /v1/rewards/submissions/:id                       → RewardSubmission
POST /v1/coach/rewards/submissions/:id/approve         → RewardSubmission
POST /v1/coach/rewards/submissions/:id/reject          → RewardSubmission

GET  /v1/me/affiliate/summary                          → AffiliateSummary
GET  /v1/me/affiliate/links                            → ReferralLink[]
POST /v1/me/affiliate/links/:slug/regenerate           → ReferralLink
GET  /v1/me/affiliate/attributions?status=             → Attribution[]
GET  /v1/me/payouts                                    → Payout[]

GET  /v1/me/balance                                    → Balance
POST /v1/me/balance/redeem                             → { ok: true; transactionId: string }
```

## 5. State and cache strategy

- React Query keys: `['coach','rewards','submissions',{status}]`, `['rewards','submissions',id]`, `['me','affiliate','summary']`, `['me','affiliate','links']`, `['me','affiliate','attributions',{status}]`, `['me','balance']`.
- `staleTime`: 30 s for submissions queue, 1 min for affiliate summary, 5 min for referral links (rarely change), 30 s for balance.
- Optimistic updates on submit / approve / reject / redeem. Rollback on 4xx.
- Offline posture: submission media is queued in the existing `foodLogQueue` pattern; affiliate dashboard is read-only and displays cached values with a `Last synced X` badge; redemptions are *not* queued (immediate balance debit must hit a fresh JWT).
- Image upload: presigned-URL pattern. Mobile uploads to S3-equivalent, then posts the upload id to the submission endpoint. Same pattern as existing photo upload.

## 6. Push and deep-link behaviour

| Event | Push payload | Deep link | Foreground |
| ----- | ------------ | --------- | ---------- |
| Submission approved | `{ kind: 'reward_approved', submissionId, creditValue }` | `tgp://rewards/submission/<id>` | In-app banner, no sound. Updates `Balance` cache. |
| Submission rejected | `{ kind: 'reward_rejected', submissionId, reasonCode }` | `tgp://rewards/submission/<id>` | In-app banner with reason. |
| Pending review (coach) | `{ kind: 'reward_pending', submissionId }` | `tgp://rewards/review` | In-app banner, no sound. |
| Referral attributed | `{ kind: 'referral_attributed', creditValue }` | `tgp://affiliate` | In-app banner. |
| Payout settled | `{ kind: 'payout_settled', amount, currency }` | `tgp://affiliate` | In-app banner. |

The `?ref=<code>` query parameter on `tgp://m/<slug>` is **only attributed server-side** — mobile passes the ref to the public marketplace API, which records the attribution at first hit. Mobile never reads `ref` for any client-side decision.

## 7. Permissions and consent

- **Camera / Photos** (client submitting media): via `PermissionPromptModal` (Wave 6).
- **Microphone** (voice note submission, future): via `PermissionPromptModal`.
- **Public-proof opt-in:** when the coach later asks to use a submission as public proof, the *client* sees an explicit consent surface in `Notifications` with the artefact preview. Consent is opt-in, opt-out, revocable.
- **Affiliate program enrolment (client → ambassador):** explicit one-time consent surface with plain copy: "By joining, you agree to receive credit for clients who sign up using your link. Your name is never shown to those clients — only your initial." Revocable.

Doctrine cross-check:

- No "Earn rewards!" banners. Surfaces are quiet — `Submit a reward` is a row, not a hero card.
- Balance is shown as currency in the user's display locale, not as "points". Display uses the same `formatMoney` helper as Wave 9 checkout.
- Redemption catalogue items are coach-authored, not platform-templated. The platform does not push a default "Free TGP T-shirt" item.
- No leaderboards in Wave 8. (Affiliate leaderboard is OWNER_DECISION-8.B and recommended off.)

## 8. Accessibility notes

- `SubmitReward` form fields each carry an `accessibilityLabel`; media picker action is announced as `"Choose photo or video"`.
- `RewardSubmissionDetail` reject action requires a confirmation modal with `accessibilityViewIsModal`.
- Status pills (Pending / Approved / Rejected) use shape + label, not colour alone.
- Currency on `Balance` and `AffiliateHome` uses the same locale formatting as Wave 9 checkout.

## 9. Analytics, privacy, security

| Event | Properties | Notes |
| ----- | ---------- | ----- |
| `reward_submission_started` | `{ kind }` | No PII. |
| `reward_submission_completed` | `{ kind, hasMedia, hasNote }` | No PII. |
| `reward_submission_reviewed` | `{ kind, outcome, rejectionReasonCode }` | No PII. |
| `affiliate_link_generated` | `{ slug }` | No PII; slug is public. |
| `affiliate_attribution_received` | `{ creditValue }` | No PII. |
| `payout_settled` | `{ amount, currency }` | No PII; amount is the user's own. |
| `balance_redeemed` | `{ itemId, cost }` | No PII. |

Privacy:

- Buyer / referred-client names are never shown to affiliates. `displayInitial` only.
- EXIF stripped on every media upload. The `expo-image-manipulator` resize-then-strip pipeline is the canonical path; no direct upload.
- Submission media is *not* publicly accessible until the coach explicitly marks it as public proof *and* the client opts in.

Security:

- Approve / reject mutations require fresh JWT (`iat` < 10 min). Stale JWT triggers silent refresh; if refresh fails, action is disabled with a toast.
- Affiliate link regeneration is rate-limited to 3 per 24 h per affiliate.
- Redemption requires biometric / passcode (per Wave 6 OWNER_DECISION-6.D).

## 10. Test plan and acceptance criteria

### Unit

- `submitReward` queues media offline and posts on reconnect.
- `approveSubmission` rolls back UI on 4xx.
- `useReferralLinks` URL builder includes the affiliate code; never includes PII.

### Integration

- Coach approves a submission → client receives push within reasonable latency → `Balance` cache updates on next foreground.
- Affiliate generates a link → buyer follows it → server records attribution → affiliate's `AttributionLedger` reflects the entry.

### Manual QA

- Submit a meal photo offline; reconnect; verify upload completes and submission becomes `Pending`.
- Reject a submission with `low_quality` reason; verify the client's submission detail shows the coach note.
- Redeem an item with a stale JWT; verify silent refresh + completion or honest failure toast.

### Acceptance criteria

- [ ] No "streak", "badge", "trophy", "level", "XP", "flame", "celebrate" vocabulary added.
- [ ] No leaderboard added.
- [ ] Balance is rendered as currency in the user's display locale, not as points.
- [ ] Buyer / referred-client identity is never exposed to the affiliate beyond `displayInitial`.
- [ ] EXIF stripped on every media upload.
- [ ] Affiliate link regeneration is rate-limited; UI surfaces honest message on 429.
- [ ] Redemption requires biometric / passcode unlock.
- [ ] Public-proof opt-in is a separate, explicit consent surface — never inferred from submission.
- [ ] Offline submission queue functions; submissions land on reconnect.
- [ ] All affiliate / rewards events redact PII.

## 11. Phased implementation order, OWNER_DECISIONs, cross-repo deps

### Phased order

1. **Coach-side `RewardsReviewQueue` + `RewardSubmissionDetail` (read-only).** First runtime PR. Validates the API and the empty / loading / error states without taking any user action.
2. **Approve / reject mutations.** Second runtime PR. Adds the optimistic-update path.
3. **Client-side `SubmitReward`.** Third runtime PR. Behind `features.rewards_submit`. Coach must have rewards installed.
4. **Client `Balance` row + redemption surface.** Fourth runtime PR. Behind `features.balance`. Renders only if balance > 0.
5. **Affiliate enrolment surface + `AffiliateHome`.** Fifth runtime PR.
6. **`ReferralLinks` + `AttributionLedger`.** Sixth runtime PR.
7. **`PayoutHistory`.** Seventh runtime PR. Depends on backend payouts service shipping.
8. **Public-proof opt-in surface (cross-cuts to Wave 7).** Eighth runtime PR. Behind `features.public_proof`.

### OWNER_DECISIONs

- **OWNER_DECISION-8.A — Are rewards a coach-driven concept or platform-driven?** Choices: (a) Coach-driven only — each coach's rewards menu is theirs (this brief's recommendation), (b) Platform-driven defaults that coaches can edit, (c) Mixed. **Recommendation:** (a). Platform-driven defaults pull the doctrine toward gamification. Coach-authored items keep the surface honest.
- **OWNER_DECISION-8.B — Affiliate leaderboard.** Choices: (a) None (this brief's recommendation), (b) Per-coach private leaderboard among the coach's own affiliates only, (c) Public. **Recommendation:** (a). Wave 10 chose acknowledgements over reactions; the same principle applies here.
- **OWNER_DECISION-8.C — Display "balance" in fiat or in points?** Choices: (a) Fiat (this brief's recommendation), (b) Points. **Recommendation:** (a). Points are gamification language; fiat is honest. The TGP-balance ledger is a fiat ledger backed by Stripe Connect or equivalent.
- **OWNER_DECISION-8.D — Photo of money.** Choices: (a) Show payout amounts always (this brief's recommendation), (b) Hide unless explicitly toggled. **Recommendation:** (a). Hiding by default implies shame about the amount; the doctrine resists implicit shame. Affiliates opted in.
- **OWNER_DECISION-8.E — Auto-renewal of consent.** Choices: (a) Never (this brief's recommendation — consent is asked once), (b) Annual reconfirmation, (c) Per-submission. **Recommendation:** (a). Each *public-proof* use is its own opt-in; affiliate enrolment itself is once.

### Cross-repo dependencies

- **Backend TGP-balance ledger** — hard for `Balance`, redemption, payouts.
- **Backend payments engine** — hard for `PayoutHistory`.
- **Backend rewards review service** — hard for review queue + submissions.
- **Backend marketplace + slug index** (Wave 7) — hard for affiliate link attribution.
- **Web payouts admin** — owner-side; mobile is read-only consumer.

### Finance dependencies

- **Stripe Connect** (or equivalent) onboarded for each coach who installs Affiliate program. Mobile *does not* drive Connect onboarding — that is a web flow. Mobile shows the `Affiliate program is paused — your payout account is not set up yet. Continue on the web at app.trygrowthproject.com/coach/payouts.` honest message.
- **TGP-balance reserve** (the platform's float) — owner-side concern; mobile irrelevant beyond honest "Pending" status.
