# Mobile UX & Product Audit — Coaching-Platform Psychology Lens

Date: 2026-05-01
Scope: TGP mobile app (React Native / Expo). Reviewed shipped surface on
`main` plus the open Wave 11 draft (#100) and the docs packs (#92–#100).
Lens: high-ticket coaching-platform psychology, private-practice luxury UX,
client retention, coach efficiency, and admin trust.

This is an audit memo, not a roadmap. Sequencing in §6 is a recommendation
the operator can override. Nothing in this document is a commitment to ship.

---

## 1. What TGP mobile is doing right

The mobile surface has a coherent, defensible posture that most coaching apps
do not have. The audit's strongest finding is that **the doctrine is real,
not aspirational** — it shows up in code, not just in docs.

1. **Codified visual register.** `docs/QUIET_LUXURY_DOCTRINE.md` is enforced
   on the shipped surface: bone background, forest single-accent, capped
   shadow tier, banned heavy weights, capped corner radii. Reviewing
   `src/screens/client/HomeScreen.tsx` confirms the doctrine in practice —
   editorial serif date headline, single ink CTA, no rings, no streak banner,
   no celebration chrome. This is rare in the category and is a real moat
   against gym-app aesthetic drift.
2. **No-placeholder rule is enforced, not aspirational.** The doctrine bans
   `Coming Soon`, fake seeded data, and TODO comments on shipped paths.
   Empty states render honestly (`CoachHomeScreen` "all clear" treatment at
   `src/screens/coach/CoachHomeScreen.tsx:269`; Wave 11 `EmptyState` usage
   inside `ClientPathCopilotScreen.tsx`).
3. **Anti-celebration stance is consistent.** TrophyShare, FirstWinCelebration,
   and the global FAB are gone. `MilestoneList` is a date · note row, not a
   trophy case. The app does not congratulate the user, which preserves the
   private-practice register.
4. **AI honesty primitives in Wave 11 (#100) are best-in-class.**
   `src/lib/aiHonestyCopy.ts` exposes a forbidden-claims allow-list, AI badge
   prefixes, and disclaimers parameterised by topic (health vs finance vs
   general). `src/__tests__/wave11Doctrine.test.ts` makes the rule
   *machine-checkable*. This is the thing every other AI-powered coaching
   app misses — and the test guard ensures it does not regress.
5. **Signoff lifecycle as first-class UI concept.** `SignoffStatusChip`
   distinguishes pending / coach-approved / admin-reviewed / disputed /
   flagged / source-missing / source-stale. UI cannot render "approved"
   without a human signoff actor. This is the trust spine of any high-ticket
   coaching platform — codifying it in components prevents drift.
6. **Member counts are deliberately rounded** in `PrivateCommunityHubScreen`
   (`approxCount` → "about 12 members"). This single design choice removes a
   whole class of vanity-comparison anxiety that competing communities
   manufacture.
7. **TrustCenter exists as a real screen** (`src/screens/TrustCenterScreen.tsx`),
   not a footer link — encryption level, data residency, audit policy, data
   export, and account deletion all surface from `GET /api/system/trust-meta`.
   For a high-ticket platform the existence of this screen *as a tab-reachable
   surface* is itself a retention asset.
8. **Single accent + restrained motion.** `motion.duration.base = 400ms` with
   `decel` easing only is the kind of constraint that keeps the app feeling
   like a private studio, not a casino.
9. **Profile-completion gate via Home nudge.** `HomeScreen.tsx:252` renders a
   single calm `FINISH YOUR PROFILE` block with `summarizeMissing`-driven
   copy and a `% complete` line — measurable, non-coercive, falls away when
   complete. Right pattern for the doctrine.

## 2. Key UX / product gaps

These are observations, not directives. Each maps to at least one shipped
file or a Wave 11 surface.

### 2.1 Client app — the "first 90 seconds" lacks a visible coaching presence

`HomeScreen.tsx` is beautifully restrained but does not surface the *coach
relationship* — the single thing the user is paying for. There is no name,
no avatar, no "your coach last reviewed your progress on …" line. The
profile-completion nudge is the only persistent signal. The lean-onboarding
flow (`LeanQ1`–`LeanQ4`) sets a goal but never explicitly introduces the
coach by name. New high-ticket clients expect to see *who* is behind the
service within their first session.

### 2.2 The "More" tab is the dumping ground

`src/screens/client/MoreScreen.tsx` lists 13 items: Guidance, Membership,
Recipes, Fasting, Community, Profile, Settings, Report, Learn, Widgets,
Grocery List, Shopping List, Prep Guide. The list is alphabetic-ish and
flat. Three concerns:

- **Coaching-critical surfaces are buried.** Membership, Guidance (the AI),
  Report, and TrustCenter (not even on the list — `MoreScreen` doesn't
  surface it; only `Settings → TrustCenter`) are all at the same visual
  weight as Grocery List.
- **Two near-duplicate surfaces** (`GroceryList`, `ShoppingList`) without
  any differentiation in the list. This is the kind of drift the doctrine
  was supposed to catch.
- **No grouping.** A high-ticket member benefits from "Your coaching",
  "Your kitchen", "Your account" sectioning, even at this restrained
  visual register.

### 2.3 No client-visible accountability artefact

A coaching platform's retention spine is the thing the client *carries*
between sessions: a brief, a check-in summary, a Loom-equivalent. Wave 11's
`ClientPathCopilotScreen` is the right shell for this, but until the
backend lands the client has no persistent artefact between coach
interactions. `ReportScreen` is weekly and is in More. Messages
(`src/screens/client/MessagesScreen.tsx`) is a thread, not a brief.

### 2.4 Coach home is dashboard-tier, not command-centre-tier

`CoachHomeScreen.tsx` shows four KPIs (active clients, logs today, total
kcal, logging rate), red-flag clients, and overdue check-ins. Strong
foundation. Gaps:

- **Total kcal across all clients is not a coach decision-support metric.**
  It is an accidental analytics number. A coach acts on *who* trended what,
  not the aggregate.
- **No "what needs your attention right now" queue.** Red-flag and overdue
  cards are present but undifferentiated; there is no SLA timer, no "you
  have 3 messages older than 24h", no signoff queue count. Wave 11's
  `CoachBriefScreen` introduces this concept (morning summary + per-client
  cards + AI flags) but is gated and not yet on the home tab.
- **No revenue/retention context.** A coach running a private practice
  cares about MRR, churn risk, and renewal proximity. Today's mobile
  surface gives them none of that. `CoachBillingScreen` exists as a
  separate surface but does not feed the home tab.

### 2.5 Coach efficiency: too many taps from "alert" to "act"

From `CoachHomeScreen` red-flag → `ClientDetail` → tab into Logs / Mealplan
/ Progress / Workouts / Timeline / Weekly. `ClientDetailScreen.tsx` is 2329
lines and exposes seven tabs. A coach who is reacting to an alert needs
a single decision surface ("send template message", "adjust macros",
"schedule check-in", "approve milestone"), not a seven-tab editor.
The 2329-line file is itself a smell — coach efficiency is being eroded by
breadth.

### 2.6 Onboarding tells the system about the user, not the user about the system

`LeanQ1`–`LeanQ4` ask: goal, experience, intent, metrics. There is no
counter-step that *introduces the coach* and the platform's promises:
"Here is your coach. Here is what they will do for you in the first 14 days.
Here is what you can expect from the brief." A high-ticket client converts
on the *narrative of expertise*, not on data capture.

### 2.7 No expectation-setting on response time

There is no SLA copy anywhere on `MessagesScreen` or `MembershipScreen`.
Private-practice trust is built on knowing when the coach replies. A single
sentence ("Your coach typically replies within 24h on weekdays") would
remove an entire class of anxiety pings without changing the visual
register.

### 2.8 Admin trust surface is invisible until Wave 11 ships

`AdminControlRoomScreen` is the right shape but is gated and unavailable
until backend + RLS land. There is no admin-side surface today that gives
ops visibility into signoff backlog, coach load, or dispute resolution.
For a sale-readiness conversation this is the visible gap.

### 2.9 `Community` (current) ≠ `PrivateCommunityHub` (Wave 11) — confusing dual surface

`MoreScreen` already surfaces `Community` which today is a wins feed
(`src/screens/client/CommunityScreen.tsx`). Wave 11 introduces
`PrivateCommunityHub` under a separate flag. If both ship the user has
two community entries with overlapping concepts. Plan the migration
explicitly so `Community` does not end up as legacy chrome.

## 3. High-impact improvements

Each improvement is sized small and aligned with the doctrine.

### 3.1 Add a single "your coach" line to Home

Above the eyebrow `THE GROWTH PROJECT` on `HomeScreen.tsx`, render a
hairline-bordered row: coach name (or "Your coach"), last-reviewed date,
optional "next check-in" line. One line, no avatar required, ink/charcoal
typography. This is the cheapest retention change in the audit. It
restates the value of the relationship every time the user opens the app.

### 3.2 Section the More tab

Group the 13 items into three semantic sections without changing the row
component: **Coaching** (Guidance, Membership, Report, Plan, TrustCenter),
**Kitchen** (Recipes, Fasting, Grocery List, Shopping List, Prep Guide),
**Account** (Profile, Settings, Widgets, Learn, Community). Add
`TrustCenter` to the More list — it should not be Settings-only for a
high-ticket platform.

### 3.3 Coach Home: replace "Total kcal" tile with "Pending signoffs"

`Total kcal` is not a decision-support metric. Wave 11 already defines
`pendingSignoffs` as a KPI. Swap the tile on `CoachHomeScreen.tsx` (it can
read the same `coachApi.getDashboard()` if extended, or add a new endpoint).
This is a one-tile change with disproportionate signal value.

### 3.4 Coach Home: add a "respond by" SLA badge to red-flag cards

Each `redFlagCard` in `CoachHomeScreen.tsx` has a client + trend. Add a
muted badge — "respond by today", "respond by tomorrow" — driven by the
alert age + a single SLA constant. No animation, no colour drama; the
badge is the same hairline border as the existing chrome. This converts
the red-flag list from a notification feed into a queue.

### 3.5 Client app: render a "Your coach replies within …" line on Messages and Membership

Pulled from a per-coach SLA setting in `CoachSettings`. Default copy:
"Your coach typically replies within 24h on weekdays." If the coach has
not configured one, show nothing rather than a fabricated promise (this
matches the no-placeholder doctrine).

### 3.6 Onboarding: insert a single "Meet your coach" screen between LeanQ4 and OnboardingResults

One screen. Coach name, headshot if available, two short sentences pulled
from `coach.bio`. No CTA other than "Continue". This is the conversion
counterweight to the data-capture quiz — the user has just told the app
about themselves; now the app introduces the human.

### 3.7 Promote `CoachBrief` to the coach home tab once the backend lands

Wave 11 mounts `CoachBrief` as a `SettingsStack` route. The actual locus of
coach attention should be `Dashboard` (= `CoachHomeScreen`). When the
`coachBrief` flag flips on, the Brief should be the *primary panel* on the
coach home, not a separate route. The KPI tiles, red-flag cards, and
overdue-check-ins should sit *inside* the Brief, not parallel to it.

### 3.8 Make `VerifiedProgressRow` reachable from the existing `ProgressScreen` and `ReportScreen`

Wave 11 wires `VerifiedProgressRow` into Copilot and Brief. The legacy
`ProgressScreen.tsx` (981 lines) and `ReportScreen.tsx` should also surface
the signoff chip — that is what proves to a high-ticket client that
"approved" is not self-claimed.

### 3.9 Add a single "audit log" sub-screen inside TrustCenter

For sale conversations and admin trust, the existence of a per-account
audit log ("you exported your data on X", "your coach reviewed your
milestone on Y") is the proof point. A single list, no filters, server-side
truncated to 90 days. This is admin trust infrastructure, not user
infrastructure.

### 3.10 Resolve the dual-Community problem before `privateCommunityHub` ships

Either: (a) the existing `Community` (wins feed) becomes the *default
public-style room* inside `PrivateCommunityHub` and the standalone
`Community` route is removed, or (b) `Community` is renamed to "Wins" and
demoted to a sub-route of `PrivateCommunityHub`. Whichever path is chosen,
do it in the same PR that flips `privateCommunityHub` to ON, otherwise
users see two community entries with overlapping concepts.

## 4. Psychological retention improvements

These target the emotional contract a high-ticket member has with the
platform. Each is constrained by §3 of the doctrine — no celebration, no
trophies, no shimmer.

### 4.1 Make the relationship visible without performing it

The single biggest retention lever for a private-practice platform is the
felt presence of the coach. The current app feels like a tracking tool with
a coach attached; the Wave 11 Brief inverts that. Two restrained moves:

- A "last reviewed by your coach" line on every progress-bearing surface
  (Home, Progress, Plan, Membership). Pulled from the same signoff
  primitive Wave 11 introduces.
- A "next check-in" date line on Membership. No countdown timer, no badge
  — a date.

### 4.2 Replace streaks with a consistency line

The doctrine forbids streak banners. The right substitute is a single
sentence: "You logged 5 of the last 7 days." Past tense, factual, no goal
implied, no badge attached. This is the same psychological reward as a
streak (loss-aversion + completion bias) without the gamification chrome.
Render it once on Home, below the `progressLine`, only when ≥3/7.

### 4.3 Tier the disclaimer copy by stake

`aiHonestyCopy.ts` already parameterises disclaimers by topic. The next
step is to surface them *visually* in proportion to stake — a finance or
medical disclaimer should sit on a hairline-bordered band, while a general
disclaimer can be inline italic. This communicates that the platform
*takes the stake seriously* without resorting to alarming colour.

### 4.4 Introduce a "what your coach changed" digest

When the coach updates a plan, modifies a target, or approves a milestone,
the client should see a single line on Home: "Your coach updated your
protein target on Tuesday." Not a notification, not a banner. A row in the
hero block. This converts every coach action into a felt signal that the
service is alive.

### 4.5 Membership tier as identity, not badge

The doctrine forbids glow / shimmer / animated tier chrome. Founding-tier
gets a camel hairline + muted-gold label only. The retention move is to
ensure that hairline appears on the *Coach's view of the client* too —
inside `ClientDetailScreen`, the coach should see the founding hairline.
Identity is felt when the coach knows.

### 4.6 No notifications without a human or a fact

Push notifications for "you haven't logged today" are the fastest way to
churn a high-ticket member. Restrict the `NotificationsScreen` (and any
push channel) to: (a) human-originated messages (coach replied, coach
approved a milestone, coach posted to a room), and (b) factual reminders
the user themselves configured. No system-originated nudges.

### 4.7 Honest empty states are themselves a retention asset

The Wave 11 `EmptyState` copy ("No suggestions yet. Once you log a few days,
your Copilot will summarise the patterns it sees and your coach will weigh
in.") is exactly right — it tells the user *when* the surface will become
useful and *who* is responsible for it. Apply this register everywhere
empty: `CommunityScreen`, `MessagesScreen` (no-coach state),
`HabitsScreen` (1040 lines — has multiple empty states worth auditing).

## 5. Risks of making the app too noisy / too gamified

The doctrine already protects against most of these, but the audit notes
the directions in which incremental product pressure will push the app.

### 5.1 The Copilot turning into a chatbot

`ClientPathCopilotScreen` currently renders summary cards. Pressure will
build to add a free-form chat surface. Keep Copilot as a *summary-only*
surface; the chat surface is `AIGuide`. Two distinct register — one is
"the coach's review", the other is "ask the assistant". Collapsing them
loses the trust spine.

### 5.2 The Brief turning into a feed

`CoachBriefScreen` shows a morning summary + per-client cards. Once it
becomes the coach home tab, pressure will build to scroll-paginate it,
add reactions, add coach-to-coach mentions. This is the path to a
Slack-like surface that erodes coach efficiency. Cap it: one screen, one
day, no infinite scroll.

### 5.3 Community vanity creep

`approxCount` is the right call. Pressure will build to expose precise
counts, leaderboards, "top contributor" lists. Each is a small step
towards the gym-app register the doctrine excises. A guard test
analogous to `wave11Doctrine.test.ts` could assert that no number > 10
appears unrounded inside `PrivateCommunityHub*` files.

### 5.4 Voice notes as a status game

The Wave 11 voice-note flag is OFF and capped at 60s. The risk is voice
notes becoming a "who posts more" surface. Mitigation: require all voice
notes to be *replies* — never standalone posts. This keeps voice as a
follow-up tool for the coach, not a broadcast tool for the cohort.

### 5.5 AI suggestion fatigue

`CopilotSuggestion[]` is the right primitive but if the adapter starts
returning 8+ suggestions per refresh the screen turns into a feed of
unactioned advice. Cap suggestions at 3; require the others be archived
behind a "see earlier suggestions" line. AI honesty includes brevity.

### 5.6 SLA badges becoming red-zone theatre

The "respond by" SLA badge proposed in §3.4 is small. The risk is colour-
escalating it (yellow → red) over time. Keep it as a single hairline
treatment. Coaches do not need a stoplight on their home tab.

### 5.7 Notification expansion

Each new feature wants a notification channel. Apply doctrine §6 (no
floating widgets) to push as well: every push channel must justify
itself against §4.6 above. Default OFF for any system-generated channel.

### 5.8 The signoff chip becoming a status symbol

`SignoffStatusChip` is the trust primitive. The risk is users seeking
"admin-reviewed" treatments as a flex. Mitigation: do not surface the
chip on the *client's outward-facing* surfaces (community posts, member
profile) — only on the coach surface and the client's own progress view.

## 6. Recommended next implementation sequence

This sequence is doctrine-compliant, low-risk, and stages the
high-leverage psychology work in front of the larger Wave 11 rollouts.
Each step is small and independently shippable.

### Phase A — Restating the relationship (0.5–1 week)

A1. Add the "your coach" line to `HomeScreen` (§3.1).
A2. Add the per-coach reply-SLA copy to `MessagesScreen` and
    `MembershipScreen` (§3.5). Add a single field to `CoachSettings` to
    configure it.
A3. Insert "Meet your coach" screen between `LeanQ4` and
    `OnboardingResults` (§3.6).

These three changes shift the felt centre of the app from "tracking" to
"coaching" without introducing any new backend surface area beyond what
already exists in `aiApi.getStructuredContext()`.

### Phase B — Sharpening the More tab (0.5 week)

B1. Section `MoreScreen` into Coaching / Kitchen / Account (§3.2).
B2. Surface `TrustCenter` from `MoreScreen`, not just Settings.
B3. Decide and execute the `Community` ↔ `PrivateCommunityHub` migration
    (§3.10). Do this *before* `privateCommunityHub` flips on.

### Phase C — Coach Home as a queue, not a dashboard (1 week)

C1. Swap "Total kcal" tile for "Pending signoffs" (§3.3).
C2. Add the muted "respond by" SLA badge to `redFlagCard` (§3.4).
C3. Add `VerifiedProgressRow` to `ProgressScreen` and `ReportScreen` so
    the signoff chip is reachable on legacy progress paths (§3.8).

### Phase D — Wave 11 readiness (ongoing — gated by backend)

D1. Wire backend endpoints behind `wave11Adapters.ts` so the empty/stale
    states resolve.
D2. Promote `CoachBrief` to the coach Home tab once the live feed is on
    (§3.7). Move KPI tiles + red flags + overdue check-ins *inside* the
    Brief.
D3. Server-side admin role check for `AdminControlRoom` (Wave 11 open
    question #1).
D4. Resolve coach-brief delivery channel question (Wave 11 open question
    #2) *before* "Approve to send" becomes binding.

### Phase E — Retention psychology (1 week, after A–D)

E1. Consistency line on Home (§4.2).
E2. "What your coach changed" digest row (§4.4).
E3. Audit-log surface inside `TrustCenter` (§3.9).
E4. Founding hairline visible on coach-side `ClientDetailScreen` (§4.5).

### Phase F — Doctrine guards (0.5 week — runs parallel)

F1. Test analogous to `wave11Doctrine.test.ts` that scans Community
    surfaces for unrounded counts > 10 (§5.3).
F2. Test that asserts `Copilot` never renders > 3 suggestions (§5.5).
F3. Test that asserts no `Trophy*`, `streak*`, or celebration vocabulary
    is reintroduced anywhere under `src/screens/**` (defends doctrine §3
    long-term).

### Sequencing rationale

Phase A is first because it has the highest psych ROI per LOC and ships
without backend dependency. Phase B reduces user friction and
de-risks the Community migration before Wave 11 lands. Phase C converts
the coach home from analytics into action — the conversion that makes
the platform feel like a private practice rather than a tracking app.
Phases D and E require backend or are layered on top of D. Phase F runs
in parallel and prevents future regression.

---

## Appendix — Concrete file references

- `src/screens/client/HomeScreen.tsx:124–340` — luxury hero, profile nudge,
  number grid. Anchor for §3.1, §4.2, §4.4.
- `src/screens/client/MoreScreen.tsx:27–119` — flat 13-item list. Anchor
  for §3.2.
- `src/screens/client/MessagesScreen.tsx:1–80` — message thread, no-coach
  state. Anchor for §3.5.
- `src/screens/client/MembershipScreen.tsx:1–100` — coach identity,
  founding-tier surface. Anchor for §4.5.
- `src/screens/client/CommunityScreen.tsx:1–90` — wins feed (legacy).
  Anchor for §3.10.
- `src/screens/coach/CoachHomeScreen.tsx:144–280` — KPI grid, red-flag
  cards, overdue. Anchor for §3.3, §3.4.
- `src/screens/coach/ClientDetailScreen.tsx` (2329 LOC, seven tabs).
  Anchor for §2.5.
- `src/screens/onboarding/LeanQ1GoalScreen.tsx` and siblings — lean flow.
  Anchor for §3.6.
- `src/screens/TrustCenterScreen.tsx` — TrustCenter as a real screen.
  Anchor for §3.9.
- `src/lib/aiHonestyCopy.ts` (PR #100) — disclaimer + forbidden-claim
  primitives. Anchor for §1.4, §4.3.
- `src/components/trust/SignoffStatusChip.tsx` (PR #100) — signoff
  lifecycle UI. Anchor for §1.5, §3.8.
- `src/screens/client/ClientPathCopilotScreen.tsx` (PR #100) — Copilot
  shell. Anchor for §2.3, §5.1, §5.5.
- `src/screens/coach/CoachBriefScreen.tsx` (PR #100) — Brief shell.
  Anchor for §3.7, §5.2.
- `src/screens/client/PrivateCommunityHubScreen.tsx` (PR #100) — community
  rebuild. Anchor for §3.10, §5.3, §5.4.
- `src/screens/coach/AdminControlRoomScreen.tsx` (PR #100) — admin shell.
  Anchor for §2.8.
- `docs/QUIET_LUXURY_DOCTRINE.md` — the rule set this audit operates
  under.
- `src/__tests__/wave11Doctrine.test.ts` (PR #100) — model for §6 Phase F.

---

## Appendix — Out-of-scope notes

- This audit reviewed the **mobile** surface only. Backend trust contracts,
  Stripe billing, admin web dashboard, and `new-website` are out of scope.
- The Wave 11 PR (#100) is treated as in-flight context. The audit assumes
  it merges roughly as drafted; if the surface changes materially the §3.7,
  §5.1, §5.2 references should be re-checked.
- Sequencing in §6 is a recommendation. The operator owns the schedule.
