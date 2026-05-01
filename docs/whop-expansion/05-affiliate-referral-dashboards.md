# 05 — Affiliate / referral dashboards

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Client app (refer-a-friend) + coach app (affiliate
program management)
**Owner:** Mobile client team (referral surface) + mobile coach team
(affiliate dashboard)

## WHY

Referrals are the single highest-converting acquisition channel for
coaching products, and Whop's affiliate flywheel is the best-known
example. Today TGP has neither a buyer-side "share + earn" surface
nor a coach-side affiliate management surface. Without them:

- Word-of-mouth conversions are invisible (no attribution).
- Power users who would gladly refer get no incentive surface.
- Coaches who want to run a paid-affiliate program (creators,
  influencers reselling their offers) cannot do so in-app.

Building both at once — buyer-side refer-a-friend and coach-side
affiliate dashboard — keeps the data model honest: a referral and
an affiliate payout are the same primitive at different levels of
formality.

## WHEN to build

After:
- Backend #120 (TGP-balance ledger) — payouts settle to balance.
- Backend #121 (slug index) — referral links use the same slug.
- [01-coach-storefront](./01-coach-storefront.md) — referrals
  attach to offer purchases, not just signups.
- `docs/expansion/19` coach revenue dashboard — the affiliate
  dashboard reuses the layout pattern.

## WHERE in the repo

- New screens (client / referral surface):
  - `src/screens/client/ReferralScreen.tsx` — share-link generator
    + earnings summary.
- New screens (coach / affiliate management):
  - `src/screens/coach/affiliate/AffiliateProgramScreen.tsx` —
    coach configures their affiliate program (rate, payout cap).
  - `src/screens/coach/affiliate/AffiliatesListScreen.tsx` — list
    of active affiliates referring this coach's offers.
  - `src/screens/coach/affiliate/AffiliatePayoutsScreen.tsx` — payout
    ledger view.
- API:
  - `clientApi.getReferralLink`, `getMyReferralEarnings`.
  - `coachApi.getAffiliateProgram`, `updateAffiliateProgram`,
    `listAffiliates`, `listAffiliatePayouts`,
    `closeAffiliateAccount`.
- Type: `src/types/affiliate.ts`.

## WHO owns and uses it

- **Buyer / referrer:** Anyone with an account. Their referral
  link is `tgp://c/<their_slug>` if they have a public profile,
  or `tgp://join?ref=<userId>` if they don't.
- **Coach (affiliate program owner):** Pro/Studio coaches can
  enable an affiliate program on their offers — anyone who
  refers a paid purchase earns the configured rate.
- **Affiliate:** A non-coach referrer who has converted at least
  one paid purchase and accepted the affiliate terms. Affiliate
  status unlocks more features in the referral screen
  (per-offer link, payout cadence opt-in).

## WHAT MVP includes

### Buyer side

- **ReferralScreen** — accessible from Profile → "Refer & earn".
  - Headline summary: "You've referred N friends, earned $X this
    month."
  - Share-link surface (copy + native share sheet).
  - Recent activity list (latest 10 referral events: signup,
    first purchase).
  - Earnings ledger entry list (read of the relevant slice of
    TGP-balance entries with type `referral_payout`).
  - "How it works" link to a docs page (out of repo).

### Coach side

- **AffiliateProgramScreen** — toggle affiliate program on/off
  per offer. Configure: rate (% of net), payout cap per
  affiliate, cooldown days before payout settles.
- **AffiliatesListScreen** — list of affiliates active under
  this coach: name (or "anonymous referrer" if profile private),
  conversions, gross volume, payout to date.
- **AffiliatePayoutsScreen** — chronological ledger; export
  deferred (coordinate with revenue dashboard work).
- **Affiliate row detail** — close affiliate (revokes future
  payouts; existing payouts remain), with a confirm modal.

### Out of scope for v1

- Sub-affiliates (affiliates of affiliates).
- Time-limited promo codes for affiliates.
- Custom affiliate landing pages (use storefront).
- Withdrawal-to-bank for the referrer (settle to TGP-balance only;
  bank withdrawal lives in the revenue dashboard for coaches).
- Tax forms / 1099 surface.
- Affiliate leaderboard (out of repo — marketing surface, web).

## HOW to implement safely

1. **One link primitive.** A share link is a deep-link to a
   storefront or a signup, with a `?ref=<userId>` query carried
   through. The deep-link parser already extends to carry
   `?invite` (`docs/expansion/16`); add `?ref` as a sibling.
2. **Payout settles server-side.** Mobile never computes
   amounts owed. The server emits `referral_payout` ledger
   entries; mobile reads them.
3. **Cooldown.** Payouts settle after a coach-configured
   cooldown (default 14 days, max 30) to allow for refunds.
   Mobile renders "Pending → Paid" via the ledger entry status,
   not via local arithmetic.
4. **Affiliate vs referral distinction is server-side.** From
   the user's perspective on mobile, they "refer". The server
   decides whether the referrer's referrals count under a
   coach's affiliate program (and at what rate). Mobile does
   not need to model the rate.
5. **Privacy.** A buyer's identity in the affiliate list
   defaults to their display name + photo. A buyer can opt out
   of being named (existing privacy toggle); the coach sees
   "Anonymous referrer" in that case but can still pay them.

## Screens / navigation sketch

```
Buyer
─────
Profile → "Refer & earn"  ──► ReferralScreen
                                 ├─ Share link (copy + native share)
                                 ├─ Recent activity
                                 └─ Earnings ledger

Coach
─────
Coach Dashboard → "Affiliate program"  ──► AffiliateProgramScreen
                                              ├─ Per-offer toggle
                                              ├─ Rate / cap / cooldown
                                              └─ "View affiliates" → AffiliatesListScreen
                                                                        └─ tap affiliate → detail
                                                                              ├─ Stats
                                                                              ├─ "View payouts"
                                                                              └─ "Close affiliate"
```

## API contract dependency

- `GET /me/referral` → `{ url: string, ref: string,
  totals: { referredCount: number, paidMinor: number,
  pendingMinor: number, currency: string },
  recentEvents: ReferralEvent[] }`
- `GET /me/wallet/entries?type=referral_payout` → ledger slice.
- `GET /coach/affiliate/program` →
  `{ enabledByOffer: Record<string, ProgramConfig | null> }`
- `PUT /coach/affiliate/program/:offerId` body `ProgramConfig` →
  same.
- `GET /coach/affiliate/affiliates` → `Affiliate[]`
- `GET /coach/affiliate/affiliates/:id` → `Affiliate`
- `GET /coach/affiliate/payouts` → `Payout[]` (paginated)
- `POST /coach/affiliate/affiliates/:id/close` → `Affiliate`

```ts
type ReferralEvent =
  | { kind: 'signup'; at: string }
  | { kind: 'purchase'; at: string; offerId: string;
      grossMinor: number; currency: string;
      payout: { amountMinor: number; status: 'pending' | 'paid' } };

type ProgramConfig = {
  rateBps: number;            // 1500 = 15%
  capPerAffiliateMinor: number | null;
  cooldownDays: number;       // 0..30
  enabledAt: string;
};

type Affiliate = {
  id: string;
  displayName: string | 'Anonymous referrer';
  photoUrl: string | null;
  conversions: number;
  grossMinor: number;
  paidMinor: number;
  currency: string;
  status: 'active' | 'closed';
};

type Payout = {
  id: string;
  affiliateId: string;
  offerId: string;
  amountMinor: number;
  currency: string;
  status: 'pending' | 'paid' | 'reversed';
  createdAt: string;
  settlesAt: string;
};
```

## Stripe / TGP-balance abstraction

Mobile never sees Stripe Connect transfers. From the user's
perspective:
- Referrer earnings appear in TGP-balance under "Referrals" with
  a status (Pending → Paid). Cashable per the wallet rules
  defined in [09-rewards-bounties](./09-rewards-bounties.md).
- Coaches see affiliate payouts come out of *their* gross
  revenue automatically; the revenue dashboard shows net after
  affiliate. Implementation is server-side splits; mobile reads
  the resulting numbers.

## Loading / error / empty states

- **ReferralScreen empty:** "Share your link — when a friend
  signs up and buys, you'll see them here." Honest, not
  decorative.
- **AffiliatesListScreen empty:** "No active affiliates yet."
- **Payout ledger empty:** "Your first payout will land after
  the cooldown window." plus the configured days.
- **Network error:** retry surface; cached prior data via React
  Query.
- **Closed affiliate:** still appears in the list with status
  pill; cannot be re-opened from mobile in v1.

## Accessibility

- Share-link copy button announces the action ("Copy referral
  link") and confirms with a non-blocking polite announcement.
- Money values read with currency name.
- Pending vs Paid status uses both colour and a textual state.

## Analytics

- `referral_link_copied` — `{ surface: 'profile' | 'storefront' }`
- `referral_link_shared` — `{ shareTarget: 'system' }`
- `referral_signup` — `{ refUserId, offerId | null }` (server-side)
- `referral_purchase` — server-side, mirrors checkout success
- `affiliate_program_toggled` — `{ offerId, enabled: bool }`
- `affiliate_closed` — `{ affiliateId }`

No PII (use opaque ids).

## Feature flags / entitlements

- Flag: `features.referrals` — buyer-side referral surface.
- Flag: `features.affiliateProgram` — coach-side program config.
- Entitlement: `entitlements.affiliate_program` (Pro/Studio).
- Team Mode: `roles.affiliate_admin` controls who in the team can
  edit program config; reading is open to all team members.

## Privacy / moderation

- Anonymous referrer mode (existing privacy toggle) hides the
  referrer's name and photo from the coach's list. Payouts still
  flow.
- Self-referral prevention is server-side (refusing a `?ref`
  param that resolves to the buyer's own user id).
- Refund-driven reversals create a `reversed` payout entry and
  a balance debit; the user sees the reversal honestly in their
  ledger ("Reversed: refund on offer X").

## Rollout

1. Internal: enable referrals for the team's accounts. Verify
   ledger entries land correctly across signup and purchase.
2. Coach side: flip on the program for one internal coach with
   a 10% rate; verify the split lands in the revenue dashboard.
3. Buyer side: flip on referrals for the storefront ring (5–10
   coaches).
4. GA after the cooldown / reversal flow is verified on a real
   refund.

## Tests

- Unit: deep-link `?ref=<userId>` parse; combined with `?invite`.
- Component: ReferralScreen empty / populated / loading.
- Component: AffiliateProgramScreen toggle persistence; rate
  validation (0–50% bps).
- Integration: signup-with-ref → buyer's recent events surfaces
  the signup; first purchase → payout pending → after cooldown
  → paid.
- Manual: refund a referred purchase; confirm the reversal is
  honest in both buyer and coach ledger views.

## Risks

- **Self-referral / circular fraud.** Server-side prevention is
  primary; mobile can additionally hide the share button when
  viewing one's own slug, but the trust boundary is the server.
- **Payout-cap edge cases.** When an affiliate is at cap, the
  next payout is partial; mobile must render this honestly
  ("Capped: $X of $Y this period"), not silently zero.
- **Tax surface.** Out of scope v1 but inevitable. Track
  TGP-balance earnings as the cumulative value the user has
  realised, server-side; mobile only renders.
- **Marketplace conflict.** If marketplace ([06](./06-coach-marketplace-discovery.md))
  ranks coaches by paid spend, an affiliate program can game
  it. The marketplace ranking spec must explicitly exclude
  paid-affiliate-attributable revenue from any "popular" signal.

## Dependencies

- Backend #120 TGP-balance ledger.
- Backend #121 slug index.
- `docs/expansion/16` public coach profile.
- `docs/expansion/19` coach revenue dashboard (layout reuse).
- `docs/expansion/20` team mode.
- [01-coach-storefront](./01-coach-storefront.md) (referrals
  attach to offer purchases).

## Acceptance criteria

- [ ] Flag off → no referral surface; deep-links carrying `?ref`
      ignore the param.
- [ ] Flag on → buyer can copy a link; signup + first purchase
      attribute correctly server-side; ledger reflects pending
      then paid after cooldown.
- [ ] Coach can enable/disable the program per offer; rate cap
      honoured.
- [ ] Anonymous referrers display "Anonymous referrer" with no
      photo.
- [ ] Reversal on refund renders honestly in both ledger views.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- The "Refer & earn" copy is the most user-visible piece of this
  feature; review with marketing before flipping the flag.
- Coaches will ask "what's a good rate?". Default the create
  flow to 10% with a help link; don't put a hard cap above 50%
  in v1 to avoid edge-case haggling, but rate-limit changes
  (server-side, once per 24h).
- A reversal hitting a buyer's balance after they've spent it
  produces a negative balance. The wallet rules in
  [09](./09-rewards-bounties.md) handle that — coordinate the
  copy.
