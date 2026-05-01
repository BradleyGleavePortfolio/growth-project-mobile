# Whop AI Coach Copilot — mobile

Mobile UX for the AI copilot that runs on the **coach** side of the app.
This is the mobile mirror of
`growth-project-backend/docs/product/positioning-whop-ai-for-coaches.md`
(Wave 2 backend spec). The positioning, in one line:

> "Whop AI for trainers, gyms, influencers, info-sellers/coaches —
> with sub-coach hierarchy."

The copilot's job is to take work off the coach's plate: read every
client's week for them, surface the at-risk ones, draft the weekly
recaps, propose programs, summarise check-ins. Every surface in this
spec runs through the **existing** AI gateway in
`growth-project-backend/src/ai/` — no new model providers, no new
secrets, no client-side AI inference. The model is `sonar-pro` (same
gateway used by the client `AIGuide`).

This is a docs-only spec. No `src/`, `app.json`, `eas.json`, or CI
changes.

---

## 0. Cross-repo dependencies

Hard:

- **Backend Wave 2 positioning spec**
  `growth-project-backend/docs/product/positioning-whop-ai-for-coaches.md`.
  Owns the prompt corpus, the persona doctrine, the disclaimer corpus,
  and the cost-control envelope.
- **Backend AI gateway** in `growth-project-backend/src/ai/` — already
  on `main`. The mobile contract calls existing endpoints.
- **Backend rate limit** — the `AIRequestLog` table and 20 req/user/hr
  sliding window already in production. Coach copilot calls are subject
  to the same envelope.

Soft:

- **`role-experience-extension-org-mode.md`** in this directory — head
  coaches see additional org-scoped copilot surfaces (org-wide at-risk
  panel, org-wide recap). Sub-coaches see only their own roster.
- **`onboarding-mobile-flows.md`** in this directory — the coach
  onboarding's "first invite" step is a dependency for the at-risk
  alert push (an empty roster has no clients to be at-risk about).

If any hard dependency is missing, the runtime PR pauses on the
affected surface. The hard-dependency note is mirrored in the
repo-root `PERP_HANDOFF.md`.

---

## 1. The four mobile surfaces

| Surface | Where | Trigger | Cost envelope |
|---|---|---|---|
| AI weekly recap | per-client surface on `ClientDetail`; org-wide on `CoachHome` | manual ("Generate recap") + scheduled Sunday 18:00 local | one call per client per week (cap) |
| At-risk client alert (push) | push notification + `CoachHome` panel | server-evaluated daily, push at 09:00 local | one batch eval per coach per day |
| AI program-builder entry | new screen `AIProgramBuilder`, reachable from `ProgramTemplates` | manual | one call per program-build step (≤ 8 steps per program) |
| AI check-in summary card | per-check-in card on `ClientDetail` | rendered when a check-in arrives, cached | one call per check-in (cached forever once generated) |

All four are gated behind `useFlag('coach_copilot_v1')` AND
`useEntitlement('coach_copilot')` (the entitlement contract from
[PR #94](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/94)
brief 09 — copilot is part of the L2/L3 coach tier, not the free tier).

---

## 2. AI weekly recap

### 2.1 Per-client recap

Lives on `ClientDetail`. New section between the client header and the
existing weekly summary.

```
+-----------------------------------------------+
|  ←  Aria Patel                                |
+-----------------------------------------------+
|  [AP]  Aria Patel                             |
|        12 weeks · last check-in 2d ago        |
+-----------------------------------------------+
|  AI weekly recap                              |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|                                               |
|  Aria's adherence stayed above 80 % for the   |
|  fifth consecutive week. Sleep duration       |
|  dropped Wednesday and Thursday — possibly    |
|  related to the deadline she mentioned in     |
|  Monday's check-in. Weight is flat week over  |
|  week, which is on plan. Suggested talking    |
|  point: review the Wednesday session — she    |
|  reported lower RPE than expected.            |
|                                               |
|  Generated 4 May, 18:00.                      |
|  This is a draft for your review, not advice. |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|                                               |
|  [ Send to Aria ]   [ Regenerate ]            |
|  [ Copy to clipboard ]                        |
+-----------------------------------------------+
|  ... (existing ClientDetail body)             |
+-----------------------------------------------+
```

Component breakdown:

- A new `<AIRecapCard/>` component. Reads from
  `useQuery(['coach', 'client', clientId, 'recap', isoWeek], fetchRecap)`
  — keyed by ISO week so the cache survives across tabs and weeks.
- The card has three primary actions and a hairline footer with
  generation metadata.
- "Send to Aria" pushes the recap into `ClientMessages` as a draft —
  the coach reviews and edits before sending. Mobile **does not**
  auto-send AI-generated copy.
- "Regenerate" calls a new `regenerate=true` query param. Subject to
  the rate limit. If the rate limit is exceeded, the button shows
  "Try again at <hh:mm local>" and is disabled.
- "Copy to clipboard" is plain `Clipboard.setStringAsync`. Analytics
  records the action; the clipboard string itself is not captured.

The disclaimer line ("This is a draft for your review, not advice.")
is **server-rendered** and verbatim — the runtime PR does not write this
copy. The verbatim corpus lives in the backend Wave 2 spec.

Empty state — first time on a client with no recap yet generated this
week:

```
+-----------------------------------------------+
|  AI weekly recap                              |
|                                               |
|  We can summarise Aria's week so you can      |
|  jump straight to your reply. Generation      |
|  takes about 10 seconds.                      |
|                                               |
|              [ Generate recap ]               |
+-----------------------------------------------+
```

Loading state (after Generate):

```
+-----------------------------------------------+
|  AI weekly recap                              |
|  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  ~10 s              |
+-----------------------------------------------+
```

Error state:

```
+-----------------------------------------------+
|  AI weekly recap                              |
|                                               |
|  We could not generate a recap right now.     |
|  This usually clears up on its own.           |
|                                               |
|              [ Try again ]                    |
+-----------------------------------------------+
```

Cache: a generated recap is cached server-side per (coach, client,
isoWeek) and re-rendered on subsequent loads without a new model call.
The mobile React Query cache is persisted via the existing
`PersistQueryClientProvider` so cold starts show the last recap
immediately.

### 2.2 Org-wide recap (head coach only)

`CoachHome` gains a new "Org weekly recap" card visible **only** to head
coaches in ORG mode. The card is a higher-level summary across all
clients on the org's roster, drafted by the same gateway with a
different prompt.

```
+-----------------------------------------------+
|  Sunday recap                                 |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  87 active clients across the org. Adherence  |
|  dropped slightly this week (from 79 % to     |
|  74 %), driven mostly by Sam's roster. Three  |
|  clients reported sleep issues — Aria, Ben,   |
|  and Cole. The new "deload" template was      |
|  assigned 12 times, the most in any week.     |
|                                               |
|  Suggested follow-ups:                        |
|    Sam — discuss this week's adherence drop   |
|    Ben — sleep coaching                       |
|    The org — sticky note on the Sunday recap  |
|                                               |
|  Generated 4 May, 18:00. Draft for review.    |
+-----------------------------------------------+
```

Component: `<OrgRecapCard/>`. Renders on `CoachHome` only when the
variant is `head-coach` and the entitlement is `coach_copilot`. Tap
target on each "Suggested follow-up" line: opens `SubCoachDetail` or
`ClientDetail` with the recap context preloaded.

---

## 3. At-risk client alert

### 3.1 Server evaluation

The backend evaluates each coach's roster nightly at 03:00 UTC and
flags clients on closed criteria:

- no check-in in 8+ days,
- adherence below 50 % for three consecutive weeks,
- weight trending against the goal direction by ≥ 1 % per week for
  three weeks,
- last message from the coach was 7+ days ago and the client has been
  active in the app since.

(The full closed list is owned by the backend Wave 2 spec — these are
illustrative.)

### 3.2 Push contract

| Topic | Sent | Body | Tap |
|---|---|---|---|
| `coach.copilot.at_risk_daily` | 09:00 local on days where the at-risk count > 0 | "X clients need attention today." | Open `CoachHome` with the at-risk panel scrolled into view |
| `coach.copilot.at_risk_critical` | Immediate when a client crosses two or more criteria simultaneously | "Aria has not checked in for 12 days." | Open `ClientDetail` for the named client |

The body strings come from the backend Wave 2 spec verbatim.

### 3.3 At-risk panel on `CoachHome`

A new section visible to all coaches with the entitlement (head-coach
sees the org-wide aggregate when in ORG mode; sub-coach and solo see
their own).

```
+-----------------------------------------------+
|  Coach home                                   |
+-----------------------------------------------+
|  Today                                        |
|    Active clients      87                     |
|    Messages waiting    4                      |
|    Check-ins this wk   23                     |
+-----------------------------------------------+
|  Needs attention                              |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  Aria Patel                                   |
|    no check-in for 12 days                    |
|  Ben Lowe                                     |
|    adherence under 50 % for 3 weeks           |
|  Cole Rao                                     |
|    weight trending against goal               |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
+-----------------------------------------------+
|  AI weekly recap                              |
|  ...                                          |
+-----------------------------------------------+
```

Each row taps through to `ClientDetail`. Long-press is a no-op (no
hidden affordance, per the doctrine — every action is on a visible
button).

The panel is empty (hidden, not zero-stated) when no clients are at
risk. The mental model is "needs attention" not "scoreboard" — there
is no daily reminder when the roster is healthy.

### 3.4 Daily limit

The at-risk push topic fires at most once per day per coach. If the
backend evaluation runs and finds the same clients flagged as
yesterday, no new push is sent — the panel just persists. A new push is
only triggered when the at-risk set **changes** (someone added or
removed) or a `at_risk_critical` row appears.

---

## 4. AI program builder

### 4.1 Where it lives

A new screen `AIProgramBuilder` in `CoachStack`, reachable from the
existing `ProgramTemplatesScreen`:

```
ProgramTemplatesScreen (existing)
  └── new row at the top: "Build with AI ..."
        └── tap → AIProgramBuilder
```

The existing template gallery is unchanged. The new entry is a
single-row CTA at the top of the list.

### 4.2 Flow

A multi-step conversational flow inside one screen. Each step is a
question; the coach answers; the next question is generated by the
gateway using the prior answers as context. Up to 8 steps. The final
step generates a draft Program object that is saved into the existing
program-template store.

```
+-----------------------------------------------+
|  ←  Build with AI                             |
|  Step 2 of 8                                  |
+-----------------------------------------------+
|  AI:                                          |
|  Based on your roster, I can build a program  |
|  for one of these client types. Pick one or   |
|  describe a different one in a sentence.      |
|                                               |
|    ( ) New client, fat-loss focus             |
|    ( ) New client, hypertrophy focus          |
|    ( ) Existing client, deload week           |
|    ( ) Other ...                              |
|                                               |
|  Coach: [_________________________________]   |
|                                               |
|              [ Next ]                         |
+-----------------------------------------------+
```

The "Other ..." option opens a single-line text input (max 280 chars).

Final step:

```
+-----------------------------------------------+
|  ←  Build with AI                             |
|  Step 8 of 8                                  |
+-----------------------------------------------+
|  Draft program — 4-week fat-loss block        |
|                                               |
|  Phase 1 (week 1):                            |
|    Mon — full body, 3x10                      |
|    Wed — push, 4x8                            |
|    Fri — pull, 4x8                            |
|  Phase 2 (week 2):                            |
|    ...                                        |
|                                               |
|  This is a draft for your review, not advice. |
|                                               |
|  [ Save as template ]   [ Edit ]              |
|  [ Discard ]                                  |
+-----------------------------------------------+
```

"Save as template" routes the new draft into the existing
`ProgramTemplatesScreen` create flow with the fields pre-filled. The
coach edits and saves through the existing flow — the AI does not
write to the database.

### 4.3 Cost envelope

- Each step costs one model call.
- The flow is capped at 8 steps. After step 8, "Generate program" is
  the only option.
- If the rate limit is hit mid-flow, the screen renders a banner "You
  have used your AI allowance for this hour. Try again at <hh:mm
  local>." The coach can still see prior steps but cannot advance.
- The flow is **not** persisted across sessions in v1 — closing the
  screen mid-flow loses the conversation. This is intentional: a
  half-built AI program is more confusing than starting over. A
  future "save draft" affordance is reserved.

---

## 5. AI check-in summary card

When a client submits a weekly check-in, the backend pre-computes a
2-3 sentence summary of the check-in (highlights, concerns, suggested
talking points) and stores it on the check-in row. The summary is
generated **once** at submission time and cached forever — it is not
re-generated.

The mobile UI surfaces this summary on `ClientDetail` as a header on
each check-in card.

```
+-----------------------------------------------+
|  Check-in — week of 28 April                  |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  AI summary:                                  |
|  Aria reports tight quads after Wednesday's   |
|  squat session and is asking about deload.    |
|  Sleep was 6h average. Adherence was 88 %.    |
|                                               |
|  Full check-in:                               |
|  ...                                          |
+-----------------------------------------------+
```

Component: `<CheckInSummaryHeader/>` rendered at the top of the existing
`<CheckInCard/>` on `ClientDetail`. Read-only. No actions on the
summary itself; the actions live on the parent check-in card.

If the summary failed to generate at submission time (rate limit, model
error), the card renders without the summary header and a small
"Generate summary" link appears in its place. Tapping triggers a
one-shot generation using the rate-limit budget.

---

## 6. Disclaimer corpus

The exact disclaimer strings used by every AI surface are owned by the
backend Wave 2 positioning spec. The mobile client renders whatever
string the server returns and **does not** hardcode any of them. This
mirrors the same constraint that the finance app's
`docs/specs/storefront-marketplace/00-overview.md` §8 imposes on its six
verbatim disclaimer constants.

Three disclaimer slots that mobile must render:

| Slot | Where | Visibility |
|---|---|---|
| Recap footer | bottom of `<AIRecapCard/>` and `<OrgRecapCard/>` | always |
| Program builder footer | bottom of every step on `AIProgramBuilder` | always |
| Check-in summary footer | bottom of `<CheckInSummaryHeader/>` | always |

The strings themselves are constants on the server and ship in the
response payload. If the server omits them (older API version), mobile
**refuses to render** the AI surface and shows a single-line "AI
copilot is unavailable. Please update the app." (the standard upgrade
prompt). This is the safe default — running an AI surface without its
disclaimer is unacceptable.

---

## 7. Voice doctrine

The model voice is enforced server-side by
`growth-project-backend/test/ai-prompt-doctrine.spec.ts` (already
shipped). The mobile client trusts the server output and does **not**
attempt to re-validate voice client-side.

What mobile does enforce:

- No emoji in any rendered string. The doctrine test in
  `src/__tests__/quietLuxuryDoctrine.test.ts` already enforces this on
  source code; the runtime PR adds a render-time strip pass on AI
  output as a defensive backstop. Output is rejected (renders the
  error state) if the strip pass detects an emoji codepoint —
  emoji-in-AI-output is a server-side voice violation, and the client
  refuses to display it rather than silently strip.
- No streak / badge / trophy / VIP / elite vocab — the same backstop
  list. Same rejection behaviour.
- Markdown is supported via the existing renderer. Code blocks are
  **not** rendered — the AI is configured server-side to never emit
  code, but if it does, the mobile client renders code blocks as plain
  text with monospace font.

---

## 8. Sub-coach vs head-coach view

Per `role-experience-extension-org-mode.md` §3:

| Surface | Sub-coach (own clients) | Head coach (org-wide) |
|---|---|---|
| `<AIRecapCard/>` per client | yes | yes |
| `<OrgRecapCard/>` on `CoachHome` | no | yes |
| At-risk panel on `CoachHome` | own clients only | aggregate, with sub-coach owner pill on each row |
| `coach.copilot.at_risk_daily` push | own clients | aggregate |
| `AIProgramBuilder` | yes | yes |
| `<CheckInSummaryHeader/>` | yes (own clients) | yes (any org client) |

Reassigning a client between sub-coaches **invalidates** the cached
recap for the prior coach (server-side cache key change) and the new
coach generates a new one on next view.

---

## 9. Analytics events

| Event | When | Payload |
|---|---|---|
| `copilot_recap_generated` | recap query resolves with a fresh response | `client_id`, `iso_week`, `regenerate: bool` |
| `copilot_recap_sent` | "Send to Aria" tapped | `client_id`, `iso_week` |
| `copilot_recap_copied` | "Copy to clipboard" tapped | `client_id`, `iso_week` |
| `copilot_org_recap_seen` | `<OrgRecapCard/>` mounts on `CoachHome` | `org_id`, `iso_week` |
| `copilot_at_risk_panel_seen` | At-risk panel mounts | `count`, `org_wide: bool` |
| `copilot_at_risk_push_opened` | user taps an at-risk push | `topic` |
| `copilot_program_builder_started` | `AIProgramBuilder` mounts | (none) |
| `copilot_program_builder_step` | each Next press | `step` |
| `copilot_program_builder_completed` | step 8 complete and Save tapped | `total_steps_taken` |
| `copilot_program_builder_abandoned` | back-button without complete | `step_at_abandon` |
| `copilot_check_in_summary_generated_inline` | "Generate summary" tap on a missing-summary card | `check_in_id` |
| `copilot_rate_limit_hit` | UI shows the rate-limit banner | `surface: 'recap' \| 'program_builder' \| 'check_in'` |

---

## 10. Loading / error / empty states

| Surface | Loading | Error | Empty |
|---|---|---|---|
| `<AIRecapCard/>` | progress bar with ~10s estimate | "Could not generate. Try again." | empty-state CTA per §2.1 |
| `<OrgRecapCard/>` | same | same | hidden (head-coach-only; if no clients, hidden) |
| At-risk panel | skeleton rows (3) | "Could not load at-risk list." | hidden |
| `AIProgramBuilder` between steps | inline thinking dots ("AI is thinking ...") | "Could not generate the next step. Try again." | n/a |
| `<CheckInSummaryHeader/>` | small skeleton line | hidden + Generate summary link | hidden |

---

## 11. Acceptance criteria

A runtime PR closing this spec is accepted when:

1. `useFlag('coach_copilot_v1')` AND `useEntitlement('coach_copilot')`
   are required for every surface in this spec to render. Flag off ⇒
   functionally identical to pre-spec build.
2. `<AIRecapCard/>` renders on `ClientDetail` with the four states from
   §2.1, the rate-limit banner, and the Sunday-18:00-local
   auto-generation behaviour.
3. `<OrgRecapCard/>` renders on `CoachHome` only for head-coach
   variants in ORG mode.
4. The at-risk panel renders on `CoachHome` and is hidden when empty.
5. `coach.copilot.at_risk_daily` and `coach.copilot.at_risk_critical`
   push topics are recognised by `src/utils/notifications.ts` and
   route to the right deep link.
6. `AIProgramBuilder` is registered in `CoachStack`. The 8-step cap is
   enforced client-side and server-side.
7. `<CheckInSummaryHeader/>` renders on every `<CheckInCard/>` whose
   row carries a non-null `ai_summary`. The Generate-summary link
   shows iff the row has a null `ai_summary` AND the user has the
   entitlement.
8. The disclaimer-strict-mode rule from §6 is enforced — if the
   server response is missing the disclaimer string, the surface
   refuses to render.
9. The voice-backstop from §7 — emoji and forbidden vocab in AI output
   route to the error state.
10. All analytics events from §9 fire from the named callsites with
    typed payloads.
11. `src/__tests__/` adds:
    - a render test for `<AIRecapCard/>` covering the four states,
    - a render test for `AIProgramBuilder` step 1 → step 8 → save,
    - a unit test for the disclaimer-missing rule (server response
      with no disclaimer ⇒ error state),
    - a unit test for the emoji-backstop (mock response containing an
      emoji ⇒ error state).
12. Sentry tags include `copilot_surface` on the scope of every
    AI-surface query so AI-correlated crashes are filterable.
13. The runtime PR ships with the flag in **off** state. The Wave 2
    backend spec must be live before the flag is enabled for any user.

---

## 12. Cost-control notes

The mobile client does not enforce cost controls on its own. Every
endpoint called by this spec is rate-limited server-side via the
existing `AIRequestLog` sliding window (20 req/user/hr). When the limit
is hit, the server returns a typed error (`429 RATE_LIMITED` with a
`retry_after` field in the body); the mobile client renders the
rate-limit banner with the localised retry time.

Per-coach **monthly** caps (a different envelope) are enforced by the
backend's billing layer and surfaced in the entitlement (`coach_copilot`
goes false when the coach exceeds their monthly cap; the surfaces
disappear cleanly).

---

## 13. Out of scope

- **Client-side AI features.** The existing `AIGuide` for clients is
  unchanged. This spec is coach-only.
- **Voice tone editor.** Owned by [PR #92](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/92)
  brief 11. The runtime PR for this spec consumes whatever tone the
  voice tone editor has set; it does not add a tone editor itself.
- **Marketing for the copilot on the public site.** Owned by
  `new-website` (out of scope for this repo).
- **Admin-side observability of AI calls.** Owned by
  `growth-project-backend/docs/admin/control-room-spec.md` §11 (AI &
  Audit). Mobile is the producer; admin is the consumer.
- **Federation of copilot signals to the finance app.** Out of scope.
  Recap text never leaves the fitness backend; only revenue/MRR
  signals are federated.
