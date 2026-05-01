# 09 — Tier-gated L2 / L3 experiences

> Entitlement-driven gating for premium tiers. A declarative `useEntitlement()` hook contract; a single source of truth for who can do / see what. Replaces the ad-hoc "if user.tier === ..." checks scattered across the codebase.

## WHY

Wave 2 introduces multiple capabilities that should be gated by paid tier (challenge authorship, leaderboards public link, content board authorship, broadcast, etc.). PR #93 brief 02 (`feature-flag-consumption`) defines `useFlag()` for *experimentation* gates. Entitlements are different — they are **commercial** gates and must not be experimented with (a paying L3 cannot have their feature flipped off as part of a 50/50 test). Without a shared contract, every brief reaches for `user.tier` directly, and the day Stripe metadata changes shape, every screen becomes wrong simultaneously.

## WHEN

- Phase 0 — flag `wave2_entitlements` defined, off everywhere; existing direct `user.tier` references continue to work.
- Phase 1 — `useEntitlement()` hook lands; existing tier checks migrated.
- Phase 2 — Wave 2 features start consuming entitlements (briefs 01, 02, 04, 05, 07).
- Phase 3 — entitlement upgrade flow (the "ASK YOUR COACH" / "UPGRADE PLAN" CTA) reaches an end state.
- This brief is **prerequisite** for the entitlement-gated bits of briefs 01/02/04/05/07. It can be implemented in parallel with them but must land *first* in production.

## WHERE

- New module: `src/hooks/useEntitlement.ts` — the hook.
- New module: `src/services/entitlements.ts` — fetcher, cache, and types.
- Touches every brief that references entitlements; no standalone screen.
- Trust Center addition (small): a "Plan & access" row that shows the user's current entitlements (read-only), reachable from `MoreScreen` → Trust Center.

## WHO

| Role | Reads entitlements | Modifies entitlements |
| --- | --- | --- |
| Client | Reads own | No (server-side, via Stripe events) |
| Coach (head) | Reads own | No |
| Junior coach | Reads own | No |
| Anyone else | None | None |

There is **no in-app upgrade purchase flow** in v1. Tier changes happen through the existing coach-managed billing surface and the Stripe portal (`coachBillingApi.openPortalSession`). This brief documents the read path and the gate semantics; the write path is out of scope.

## WHAT

### Tier model (mobile expectation)

```ts
type Tier = 'L1' | 'L2' | 'L3' | 'founding';

type Capability =
  // coach-side
  | 'challenges.author'
  | 'leaderboards.public_link'
  | 'content.author'
  | 'content.newsletter'
  | 'programs.author'
  | 'programs.advanced_blocks'
  | 'messages.broadcast'
  | 'team.junior_coach'           // separate from junior-coach capability flags inside Team Mode
  // client-side (mostly null in v1; reserved)
  | 'reports.export_pdf';

interface Entitlements {
  tier: Tier;
  capabilities: Set<Capability>;
  expiresAt: string | null;        // soft-expiry; server still authoritative
  trialEndsAt: string | null;
  status: 'active' | 'past_due' | 'paused' | 'canceled' | 'trialing' | 'none';
}
```

`founding` is **not a tier** in the commercial sense — it's an attribute layered on top of L1/L2/L3. The doctrine §6 restricts founding to a camel hairline and a muted-gold label; nothing else changes visually. We model it as a Boolean attribute alongside Tier, not as a fourth tier:

```ts
interface AccountStatus {
  entitlements: Entitlements;
  isFoundingMember: boolean;
}
```

### `useEntitlement` contract

```tsx
import { useEntitlement } from 'hooks/useEntitlement';

function ChallengeNewButton() {
  const { allowed, reason, upgradeCta } = useEntitlement('challenges.author');
  if (!allowed) {
    return <UpgradePromptRow reason={reason} cta={upgradeCta} />;
  }
  return <PrimaryButton onPress={...}>NEW CHALLENGE</PrimaryButton>;
}
```

Returns:

```ts
type UseEntitlementResult =
  | { allowed: true; loading: false }
  | { allowed: false; loading: false; reason: 'tier_too_low' | 'past_due' | 'trial_expired' | 'paused'; upgradeCta: 'open_portal' | 'contact_coach' | 'wait_for_activation' | 'none' }
  | { allowed: false; loading: true; reason: null; upgradeCta: null };
```

Loading is **not** "default to allowed" or "default to denied" universally — each call site decides. The default for **destructive** actions (publish, send, charge) is to render a disabled state until loading resolves. The default for **read** actions is to render a skeleton.

### Doctrine note

The "ungated" experience — what an L1 client sees — must already feel complete and self-contained. Per `QUIET_LUXURY_DOCTRINE.md` rule 2, gates do **not** present "Coming Soon" or "Upgrade to unlock" splashes everywhere. Gates either:

- hide the affordance entirely (preferred, when the feature is truly invisible at this tier), or
- render an `UpgradePromptRow` — a single row (not a banner, not a modal) with a 2-line copy and one neutral CTA.

The CTA copy is plain: `"Open billing"` or `"Contact your coach"` — never "UPGRADE NOW", "🌟 GO PRO", or any hype. Doctrine § 4.

## HOW

### Where gates render (per brief)

| Brief | Gate location | Hidden / prompt |
| --- | --- | --- |
| 01 challenges | "+ NEW CHALLENGE" affordance on `ChallengesListScreen` | Hidden if `tier ∈ {'L1'}` (L2+ author); upgrade prompt row otherwise. |
| 02 leaderboards | Visibility selector "public link" option in `ChallengeEditorScreen` | Hidden + tooltip on long-press explaining L3 gate. |
| 04 content boards | "+" affordance on `ContentBoardScreen` | Same treatment as 01. |
| 04 content boards | Newsletter type | Flag *and* L2+ entitlement. |
| 05 programs | "+ NEW PROGRAM" affordance | L2+. |
| 05 programs | AMRAP / EMOM block kinds | Flag-gated, not entitlement-gated; available on all tiers when flag flipped. |
| 07 messaging | Broadcast composer entry on `MessagesScreen` header | L2+. |
| Junior coach | `team.junior_coach` capability is required to add a junior; client-tier has no equivalent. |
| Founding accent | Renders on every relevant surface using `<Avatar ring="founding" />` and a small `eyebrow`-typography label "Founding". No upgrade prompt anywhere. |

### Screens / navigation sketch

```
MoreScreen → Trust Center → Plan & access (NEW row)
  ├── Plan: L2 · Active until 2026-09-12
  ├── Capabilities: 7 enabled
  └── Manage billing → opens existing CoachBillingScreen / portal
```

### API contract

Mobile reads entitlements through `usersApi.getAccountStatus` (existing endpoint, extended to include `entitlements`). Server is the source of truth. There is **no** local mutation API.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/users/me/account/status` | Returns `AccountStatus` (existing; extended) |

Versioning: `X-Capability: entitlements`. Backend without this returns the legacy `AccountStatus` shape; mobile defensively defaults to `tier: 'L1', capabilities: ∅` for unknown shapes. **Default-deny** for entitlement-gated surfaces is the safe choice.

### Cache + freshness

- `usersApi.getAccountStatus` is cached in React Query for 5 minutes.
- A realtime broadcast `entitlements_changed` invalidates the cache instantly when the server pushes a Stripe webhook update. This avoids the "I just paid and the feature is still locked" loop.
- App foreground triggers a refetch.
- `useEntitlement()` does **not** poll — it reads from cache.

### Media upload UX

None.

### Accessibility

- `UpgradePromptRow` has `accessibilityRole="button"`, `accessibilityLabel="{capability} requires plan {tier}. {ctaCopy}."`.
- Disabled affordances use `accessibilityState={{ disabled: true }}` and have a long-press hint that surfaces the same copy as the prompt row.
- Plan row in Trust Center exposes status, expiry, and capability count to screen readers.
- No flashing or motion is used to draw attention to the upgrade prompt.

### Loading / error / empty states

- **Loading**: gate-bound surfaces render skeleton or disabled state. Never "Coming Soon" copy.
- **Error fetching status**: silently keep the last cached value; if no cache, default-deny entitlement-gated surfaces and show a Trust Center error row "We couldn't fetch your plan." with retry.
- **Past-due**: gates flip closed; copy reads "Your plan needs attention. Open billing." Keeps tone neutral.
- **Trial-expired**: same; CTA opens the portal.
- **Paused**: same.
- **None / canceled**: same; the user lands on the L1 surface.

### Privacy / moderation

- Entitlement values are user-private. Coach cannot see a client's entitlements via mobile (and shouldn't — coach access to *paying client* metadata is Stripe-mediated, not in-app).
- Junior coach can see only their own entitlements; never the head coach's.
- No analytics event includes raw `Tier` or `Capability` values that map back to billable plan SKUs — only `tier_bucket` (L1/L2/L3 anonymised by counts).

### Feature flags / entitlements (this is the meta-irony of this brief)

- `wave2_entitlements` (PostHog) — top-level flag for the *hook itself*. Default off.
- When `wave2_entitlements` is off, `useEntitlement()` returns `{ allowed: true, loading: false }` for every capability — i.e. the existing behaviour. This is critical: the hook lands in the codebase before the gates do.
- When on, the hook reads from cache and reports honestly.
- Gates start landing in follow-up PRs *after* the flag has been on in production for 1 week with no incident.

### Analytics events

| Event | Properties | Where |
| --- | --- | --- |
| `wave2_entitlement_check` | `capability`, `allowed`, `tier_bucket` | Each `useEntitlement()` call (sampled — 1% to keep volume sane) |
| `wave2_entitlement_prompt_view` | `capability`, `tier_bucket` | `UpgradePromptRow` render |
| `wave2_entitlement_prompt_cta` | `capability`, `cta` | CTA tap |
| `wave2_entitlement_changed` | `from_tier_bucket`, `to_tier_bucket` | Status payload diff |

No raw plan SKU, no Stripe customer id, no email.

### Rollout

1. Hook + cache + Trust Center "Plan & access" row land in a single PR; flag *off*.
2. Internal validation: every `useEntitlement()` call returns `{ allowed: true }` regardless of tier. No behavioural change for users.
3. Flag on for internal coaches; no follow-up PRs landing yet.
4. After 1 week no-incident, follow-up PRs (one per brief) start adding actual gates.
5. Each gate-enabling PR includes a screenshot per state in its description (allowed / loading / denied / past-due).
6. Rollback: top-level flag off → all gates open. Existing direct `user.tier` checks remain as fallback for cases where the hook hasn't been migrated yet (these are removed in the cleanup PR after Wave 2 stabilises).

### Tests

- **Unit**: hook returns the right shape under every status × tier × capability combination. Snapshot of the truth table.
- **Unit**: cache freshness — webhook broadcast invalidates within ≤2s.
- **Unit**: default-deny on unknown server payload shape.
- **Hook**: `useEntitlement('challenges.author')` resolves to allowed/denied per fixture.
- **Component (RNTL)**: `UpgradePromptRow` per CTA variant.
- **Component**: every gated affordance in briefs 01/02/04/05/07 renders the documented hidden / disabled / prompt state under the right conditions. (Each follow-up PR ships its own component test; this brief does not enumerate them.)
- **Backend contract**: server enforces capabilities even if a mobile build sends a request with `X-Capability` it doesn't actually have.

### Risks

| Risk | Mitigation |
| --- | --- |
| A capability check defaults to `allowed: true` during the brief loading window and a destructive action goes through. | Gate copy mandates `allowed: false; loading: true` for destructive actions. Disabled state until resolved. |
| Stripe webhook to server is delayed; user has paid but is still gated. | Realtime `entitlements_changed` broadcast + foreground refetch. Manual "Refresh plan" affordance on the Trust Center plan row. |
| Doctrine drift: someone adds an "✨ UNLOCK PRO" splash to `MoreScreen`. | Brief explicitly bans hype copy. Code-review skill catches; the only allowed prompt shape is `UpgradePromptRow`. |
| L1 user feels surveilled / nagged by upgrade prompts everywhere. | Hidden-affordance is the *default* for L1; prompts only appear where the feature would otherwise feel discoverable but locked. The tradeoff per brief is documented in each. |
| Junior coach inherits head coach's entitlements implicitly. | Server resolves junior coach entitlements from their own row, *plus* the head coach's `team.junior_coach` capability. Mobile reads only the resolved set. |
| Founding member styling collides with tier styling. | Separate concerns: tier governs capabilities, founding governs the camel hairline ring and small label. Both can apply. Doctrine §6. |

### Dependencies

- `usersApi.getAccountStatus` (existing) extended.
- `coachBillingApi.openPortalSession` (existing) for the upgrade CTA.
- Stripe entitlement metadata defined for `challenges.author`, `leaderboards.public_link`, `content.author`, `content.newsletter`, `programs.author`, `messages.broadcast`, `team.junior_coach`, `reports.export_pdf`.
- PR #93 `docs/platform-readiness/02-feature-flag-consumption.md` — coexistence of `useFlag()` and `useEntitlement()`. They are separate hooks; never combined into one.
- PR #93 `docs/platform-readiness/04-role-based-navigation-architecture.md` — junior coach role.

### Acceptance criteria

- `useEntitlement()` lands behind a flag, off by default, with no behavioural change.
- Trust Center exposes the user's current plan and capability count without leaking SKUs.
- Each gated affordance has a documented allowed / hidden / prompt / past-due state.
- Default-deny applies on payload-shape mismatch.
- A Stripe upgrade reaches the gate within ≤10 s in pilot conditions.
- Sentry shows zero `surface: 'wave2.entitlements'` errors over a 7-day pilot.

### Operator handoff

- **Owning surface**: mobile lead. Billing lead owns the Stripe metadata.
- **Out-of-band steps**: Stripe metadata for each capability, in both staging + production; webhook → server → realtime broadcast plumbing; Trust Center copy reviewed for tone (no hype, no shaming).
- **"Done" means**: hook is on in production for 1 week with zero `surface: 'wave2.entitlements'` errors, before any gate-enabling follow-up PR ships.
