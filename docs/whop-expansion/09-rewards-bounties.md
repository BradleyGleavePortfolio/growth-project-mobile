# 09 — Rewards and bounties

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Client app (earn + redeem) + coach app (author bounties)
**Owner:** Mobile client team (member side) + mobile coach team
(authoring side)

## WHY

Engagement loops in coaching apps tend to be either fluffy
(gamification, badges, trophies) or absent. The doctrine in this
repo (PR #70) explicitly forbids streak/badge/trophy vocabulary.
Rewards and bounties are the doctrine-compatible way to make
engagement *materially* worth doing — completing a bounty or
hitting a milestone yields TGP-balance, which is real, fungible
value (cashable per the wallet rules below).

A bounty is a coach-authored task with a TGP-balance prize. A
reward is an automatic balance grant for hitting a defined
milestone (e.g. 90-day program completion) — the coach configures
the milestone in their offer, the system pays out.

This brief is what makes [05-affiliate-referral-dashboards](./05-affiliate-referral-dashboards.md)
and the application-deposit refund path coherent: all of them
write to the same TGP-balance ledger.

## WHEN to build

After:
- Backend #120 (TGP-balance ledger) exposes `getBalance`,
  `listEntries`, and the redemption write path.
- `docs/expansion-wave-2/01` challenges (the bounty surface is a
  small extension of challenge authoring).
- [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md)
  exposes `applyBalance` so the wallet can be spent at checkout.

## WHERE in the repo

- New screens (member side):
  - `src/screens/client/wallet/WalletScreen.tsx` — balance,
    recent entries, redeem CTA.
  - `src/screens/client/wallet/WalletHistoryScreen.tsx` — full
    ledger history with filters.
  - `src/screens/client/bounties/BountiesListScreen.tsx` — open
    bounties this user is eligible for.
  - `src/screens/client/bounties/BountyDetailScreen.tsx` — single
    bounty, claim flow.
- New screens (coach side):
  - `src/screens/coach/bounties/BountyEditorScreen.tsx` — author
    a bounty.
  - `src/screens/coach/bounties/BountySubmissionsScreen.tsx` —
    review claims, approve / reject.
- Entry: client side — More-stack row "Wallet"; Home tile if
  balance > 0; bounties list visible inside the relevant
  program / space surface, not as its own tab. Coach side —
  Bounty authoring lives next to challenge authoring (sibling
  stack).
- API: `walletApi.getBalance`, `listEntries`,
  `bountiesApi.listEligible`, `getBounty`, `claimBounty`,
  `coachApi.createBounty`, `updateBounty`, `cancelBounty`,
  `listSubmissions`, `decideSubmission`.
- Type: `src/types/wallet.ts`, `src/types/bounty.ts`.

## WHO owns and uses it

- **Builder:** Mobile client + coach teams.
- **Author:** Coach (bounties), system (automatic milestone
  rewards driven by program/event configuration).
- **Audience:** Members earn and spend; coaches author bounties
  and approve submissions.

## WHAT MVP includes

### Member side

- **WalletScreen** — balance amount, "Spend at checkout" hint,
  recent entries (latest 5), CTA to full history.
- **WalletHistoryScreen** — paginated ledger entries, filterable
  by type (`bounty_payout`, `referral_payout`,
  `milestone_reward`, `application_refund`, `purchase_apply`,
  `reversal`). Each row: type, source, amount, status, date.
- **BountiesListScreen** — open bounties relevant to the user
  (entitled programs/spaces only).
- **BountyDetailScreen** — title, description, payout amount,
  deadline, "How to claim" instructions, claim CTA — opens a
  submission form (text + optional photo) per bounty schema.
- **Notifications** — payout received and bounty deadline
  reminder; opt-out per category.

### Coach side

- **BountyEditorScreen** — title, description, instructions,
  payout amount (capped per coach by tier), deadline, eligible
  audience (program X / space Y / "all my clients"),
  submission shape (text-only / text + photo), max claims
  (capacity).
- **BountySubmissionsScreen** — sectioned (Pending / Approved /
  Rejected), per-row preview, decision actions.

### Out of scope for v1

- Auctions / bid-based bounties.
- Group bounties / split rewards.
- TGP-balance withdrawal to bank for non-coach users (cash-out
  path is coach-side only via the revenue dashboard
  `docs/expansion/19`; non-coach members spend balance only).
- Cross-coach redemption (balance is platform-wide, but only
  spendable at checkout in v1).
- Streak / badge / trophy vocabulary (forbidden — see PR #70).

## HOW to implement safely

1. **Doctrine vocabulary lock.** No "badge", "trophy", "streak",
   "level". The visible terminology is "wallet", "balance",
   "bounty", "reward", "earned", "redeemed". Any drift breaks
   PR #70 and must be reverted.
2. **Money is server-side.** Mobile reads ledger entries; it
   does not compute balance from entries client-side. The
   `getBalance` endpoint is the source.
3. **Earning is event-driven.** A bounty payout creates an
   entry on approval; a milestone reward creates an entry on
   server-detected milestone. Mobile renders entries; it does
   not trigger payouts.
4. **Spending is via checkout.** "Apply balance" on the checkout
   screen is the only spend surface in v1. Do not invent a
   redemption catalogue.
5. **Negative balances are honest.** If a refund-driven reversal
   makes balance go negative (rare but possible), render it
   honestly with the reason; do not clip to zero.
6. **Eligibility is server-decided.** Mobile asks for eligible
   bounties for the current user; it does not filter locally.

## Screens / navigation sketch

```
Member
──────
Home tile (balance > 0)  ──► WalletScreen
More-stack → "Wallet"   ──► WalletScreen
                              ├─ Balance
                              ├─ Recent entries
                              └─ "View all" ──► WalletHistoryScreen

Inside a Program / Space
  └─ "Open bounties" tile  ──► BountiesListScreen
                                  └─ tap → BountyDetailScreen
                                              └─ "Claim" → submission form
                                                              └─ submitted

Coach
─────
Coach app → Bounties (sibling to Templates)  ──► BountiesListScreen (coach view)
                                                    ├─ "+" → BountyEditorScreen
                                                    └─ tap → BountySubmissionsScreen
                                                                ├─ Approve → payout entry created
                                                                └─ Reject → reason
```

## API contract dependency

- `GET /me/wallet/balance` → `{ balanceMinor: number,
  currency: string, pending: { incoming: number;
  outgoing: number } }`
- `GET /me/wallet/entries?cursor=&type=` → `{ items: Entry[],
  next: string | null }`
- `GET /me/bounties/eligible` → `Bounty[]`
- `GET /bounties/:id` → `Bounty`
- `POST /bounties/:id/claim` body
  `{ submission: { text: string; imageRef?: string };
  idempotencyKey }` → `Submission`
- `GET /coach/bounties` → `Bounty[]`
- `POST /coach/bounties` body `DraftBounty` → `Bounty`
- `PUT /coach/bounties/:id` body `DraftBounty` → `Bounty`
- `POST /coach/bounties/:id/cancel` → `Bounty`
- `GET /coach/bounties/:id/submissions` → `{ items:
  Submission[], next: string | null }`
- `POST /coach/bounties/:id/submissions/:sid/decide` body
  `{ decision: 'approve' | 'reject', reason?: string }`
  → `Submission`

```ts
type EntryType =
  | 'bounty_payout' | 'referral_payout' | 'milestone_reward'
  | 'application_refund' | 'purchase_apply' | 'reversal';

type Entry = {
  id: string;
  type: EntryType;
  amountMinor: number;     // signed
  currency: string;
  status: 'pending' | 'settled' | 'reversed';
  source: { kind: 'offer' | 'bounty' | 'referral' | 'event' |
              'system'; id: string; label: string };
  at: string;
};

type Bounty = {
  id: string;
  coachSlug: string;
  title: string;
  description: string;
  instructions: string;
  payoutMinor: number;
  currency: string;
  deadlineAt: string | null;
  audience: { kind: 'program' | 'space' | 'all'; id?: string };
  submissionKind: 'text' | 'text_image';
  maxClaims: number | null;
  claimsCount: number;
  status: 'open' | 'closed' | 'cancelled';
};

type Submission = {
  id: string;
  bountyId: string;
  memberId: string;
  memberName: string;
  memberPhotoUrl: string | null;
  body: string;
  imageUrl: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt: string | null;
  rejectReason: string | null;
};
```

## Stripe / TGP-balance abstraction

TGP-balance is a *closed-loop* internal credit. From the user's
perspective:

- It is denominated in fiat (USD/GBP/EUR) but is not cash —
  spendable only inside the app at checkout in v1.
- For coaches, it is sweepable to bank via the revenue
  dashboard's payout flow (`docs/expansion/19`).
- It accrues from earning events (bounty / referral / milestone
  / refund) and depletes via checkout `applyBalance`.

Mobile does not see Stripe in the wallet flow. Coach payouts to
bank go through Stripe Connect server-side; mobile only reads
the resulting balance and ledger entries.

## Loading / error / empty states

- **WalletScreen empty (zero balance, zero history):** "You'll
  see your earnings here once you complete a bounty or earn a
  referral payout."
- **BountiesListScreen empty:** "No open bounties for you right
  now."
- **Submission failure:** typed (validation, max-claims
  reached → "This bounty is full", deadline passed → "This
  bounty has ended"). Keep the form mounted; do not lose the
  user's text.
- **Decision failure (coach):** toast + retry; submission stays
  pending.
- **Reversal:** shows in history with type `reversal` and a
  source label (`refund on offer X`).

## Accessibility

- Money values read with currency name and sign ("plus 12 USD
  earned" vs "minus 12 USD redeemed").
- Submission form labels are explicit; image-required vs
  optional is clear.
- Coach decision buttons trap focus into a confirm before
  payout creation.

## Analytics

- `wallet_viewed` — `{ balanceMinor, entryCount }`
- `wallet_history_viewed` — `{ filter }`
- `bounty_viewed` — `{ bountyId }`
- `bounty_claim_submitted` — `{ bountyId, hasImage: bool,
  bodyLength }`
- `bounty_claim_decided` — `{ bountyId, submissionId, decision }`
- `coach_bounty_created` — `{ bountyId, payoutMinor, currency,
  audienceKind }`
- `coach_bounty_cancelled` — `{ bountyId }`

No body content; lengths only.

## Feature flags / entitlements

- Flag: `features.wallet` — wallet surface.
- Flag: `features.bounties` — bounty authoring + claim.
- Entitlement: `entitlements.bounties.create` (coach side, Pro/
  Studio with a payout cap per coach by tier).
- Team Mode: `roles.bounty_admin` controls authoring + decision.

## Privacy / moderation

- Submissions are private to the coach (and team-mode reviewers).
  Other members do not see them.
- Coach decisions are audit-logged server-side; mobile does not
  store reasons beyond the rendered toast.
- Image submissions go through the same moderation path as
  profile photos.
- A user with a moderation flag cannot claim bounties.

## Rollout

1. Internal — one bounty, one team account claims, manual
   approval; verify the payout appears in WalletScreen and is
   spendable at checkout.
2. Add referral-payout entries surfacing in history once
   [05](./05-affiliate-referral-dashboards.md) lands.
3. Flip on for the storefront ring.
4. GA after the reversal flow is verified on a real refund.

## Tests

- Unit: ledger-entry rendering for every `EntryType`.
- Unit: `applyBalance` math against currency/amount in
  checkout module.
- Component: BountyDetailScreen across `open` / `closed` /
  `cancelled` states; max-claims hit; deadline passed.
- Component: WalletScreen renders pending vs settled honestly.
- Integration: claim → coach approves → entry settles →
  applied at checkout.
- Manual: reversal on a refunded purchase that touched
  applied balance — verify a `reversal` entry appears.

## Risks

- **Vocabulary creep.** "Streak", "badge", "trophy" are easy
  to slip into copy. PR-time copy review must catch it.
- **Bounty abuse.** A coach setting a cap-less, low-difficulty
  bounty drains payouts. Per-coach payout caps are server-side;
  the cap UI in the editor displays remaining headroom.
- **Negative balance UX.** Rare but real on reversal; verify
  the surface does not surprise a user who already spent.
- **Tax surface deferred but accruing.** Track total earnings
  per user server-side; a tax surface is post-v1 but inevitable.
- **App Store optics.** A wallet that looks like a digital
  currency invites scrutiny. Frame as "store credit": closed-loop,
  fiat-denominated, non-transferable, spendable only at
  checkout. Copy must reflect this.

## Dependencies

- Backend #120 TGP-balance ledger.
- `docs/expansion-wave-2/01` challenges (bounty editor reuses).
- `docs/expansion/19` coach revenue dashboard (coach payout
  surface for cash-out — outside this brief but coordinated).
- [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md)
  (`applyBalance`).
- [05-affiliate-referral-dashboards](./05-affiliate-referral-dashboards.md)
  (shares the ledger).

## Acceptance criteria

- [ ] Flag off → no wallet, no bounties surfaces; ledger
      entries don't render.
- [ ] Flag on → user sees balance, history, eligible bounties;
      claim flow works; coach approval lands a `bounty_payout`
      entry.
- [ ] `applyBalance` at checkout subtracts the right amount
      and creates a `purchase_apply` entry.
- [ ] Reversals on refund render honestly with source label.
- [ ] No banned vocabulary anywhere in the surface.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- The first time a coach asks "can I pay out cash for the
  bounty?" — the answer is "no, balance only, in v1". Cashing
  out is a coach-side feature in revenue dashboard, not a
  member-side feature.
- Watch the ratio of bounty payouts to checkout `applyBalance`
  events. A low ratio means the wallet is filling but not
  redeeming — a sign that coaches need to publish more
  spendable offers, not that the wallet UI is broken.
- The negative-balance edge case will produce support tickets.
  Prepare a one-line copy fix and a help-centre article before
  the first refund-driven reversal hits a real user.
