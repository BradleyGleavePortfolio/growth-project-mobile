# 10 — AI Business Copilot (coach-side)

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Coach app
**Owner:** Mobile coach team

## WHY

A coach running everything inside TGP — clients, programs,
storefront, spaces, events, bounties — has more in-app data than
they can read. The same LLM gateway that already drafts weekly
recaps (`docs/expansion/10`) and honours the editable voice/tone
(`docs/expansion/11`) can be exposed as a generic *business*
assistant: "summarise this client", "draft a check-in nudge",
"suggest a price for this offer", "explain why my churn dropped
this month".

This is distinct from the existing client-facing AI guide. Same
infrastructure, different audience, different prompts, different
entitlement.

## WHEN to build

After:
- `docs/expansion/10` (generate weekly recap) and
  `docs/expansion/11` (editable voice/tone) are shipped — the
  copilot extends the same gateway with new prompt surfaces.
- Backend #117 (AI program builder gateway) is live.
- Enough other features in this pack are GA that the copilot
  has rich context to operate on (storefront offers, revenue
  dashboard data, application queue) — there is no point
  shipping the copilot when there's nothing for it to summarise.

## WHERE in the repo

- New screens:
  - `src/screens/coach/copilot/CopilotHomeScreen.tsx` — entry
    surface with shortcuts.
  - `src/screens/coach/copilot/CopilotChatScreen.tsx` — full
    conversation surface.
  - `src/screens/coach/copilot/ActionResultScreen.tsx` — when
    the copilot proposes a structured action (e.g. "send this
    nudge to client X"), this is the confirm surface.
- Entry: Coach Home top tile "Copilot"; also a small "Ask
  Copilot" affordance on contextual screens (client detail,
  offer detail, application list) that pre-seeds the prompt.
- API: `aiApi.copilotConversation`, `copilotMessage`,
  `copilotProposeAction`, `copilotConfirmAction`. The mobile
  client streams responses via SSE or chunked HTTP — same
  pattern as the existing AI guide.
- Type: `src/types/copilot.ts`.

## WHO owns and uses it

- **Builder:** Mobile coach team.
- **Audience:** Coach. In Team Mode, the owner role has full
  copilot access; other roles have read-only or none, configured
  per coach.
- **Not the audience:** Clients. The client-facing AI guide is a
  separate surface with separate prompts. Mixing them is a
  privacy and prompt-injection risk.

## WHAT MVP includes

- **CopilotHomeScreen** — a small set of curated shortcuts:
  - "Summarise my last week" — runs the same recap generator
    as `docs/expansion/10` but coach-wide.
  - "Which clients need attention?" — produces the list
    behind the attention panel (`docs/expansion/08`) with a
    per-client one-line reason.
  - "Suggest a price for a new offer" — context: coach's
    existing offers, market range from server.
  - "Draft a check-in nudge for <client>" — context: that
    client's recent check-ins.
  - "Explain my revenue this month" — narrative read of
    `docs/expansion/19`.
  - Shortcuts are configured server-side so the set can grow
    without a build.
- **CopilotChatScreen** — free-form conversation. Streaming
  responses; cancel button while streaming. Citations to the
  underlying data the copilot used (e.g. "based on your last
  4 weeks of check-ins").
- **ActionResultScreen** — when the copilot proposes an action
  with a structured payload (e.g. send a DM to a client), it
  surfaces a confirm card with the exact text the action will
  perform. The coach edits and confirms before it executes.
- **History** — recent conversations listed; tap to resume.
  Conversations are local + synced to server (existing AI guide
  pattern).

### Out of scope for v1

- Voice input / output.
- Image understanding inputs (defer until a use case is real).
- Auto-execution of actions (every action requires a confirm).
- Cross-coach insights ("how do other coaches in your tier
  price?") — leak risk; defer with explicit aggregate-only
  contract.
- Multi-step agentic workflows (no tool-using autonomy beyond
  one-shot proposed actions).
- Prompt customisation by the coach beyond the existing
  voice/tone setting.
- Copilot-authored offers / programs / events (the copilot can
  *propose*; authoring still flows through the relevant
  builder).

## HOW to implement safely

1. **One LLM gateway.** This pack does not introduce a second
   LLM client. It calls `backend.aiApi` with a new prompt
   identifier, same auth, same rate limits.
2. **Prompt-injection resistance.** Coach data (client check-ins,
   profile bios, application answers) is *untrusted* input. The
   server-side prompt template handles fencing; mobile renders
   what the gateway returns and never re-feeds user-provided
   text into a prompt directly.
3. **Voice / tone honoured.** The existing
   `docs/expansion/11` setting governs response style. The
   copilot reads it; do not duplicate.
4. **Citations are mandatory for data-grounded responses.**
   Every shortcut that operates on coach data returns
   citations (e.g. "from your check-ins between Apr 1 and
   Apr 15"). Mobile renders them honestly; if the gateway
   returns no citations on a data-grounded prompt, surface a
   "We're not sure where this came from" warning rather than
   silently hide.
5. **Streaming is a UX requirement.** The chat screen streams
   tokens; cancel-mid-stream is supported. The existing AI
   guide streaming pattern is the reference.
6. **Action confirmation is the only execution path.** Even if
   the gateway proposes an action with high confidence, mobile
   shows the confirm screen. No "auto-send" toggle in v1.
7. **Cross-feature linking.** When the copilot mentions a
   client, an offer, or a screen, render it as a tappable
   reference (deep-link in-app). The link contract is
   server-driven (the gateway returns reference ids; mobile
   maps them to routes).

## Screens / navigation sketch

```
Coach Home → "Copilot" tile  ──► CopilotHomeScreen
                                    ├─ Shortcut: "Summarise my last week"
                                    ├─ Shortcut: "Which clients need attention?"
                                    ├─ Shortcut: "Draft a nudge for <client>"
                                    ├─ Shortcut: "Suggest a price for a new offer"
                                    ├─ Shortcut: "Explain my revenue this month"
                                    └─ "Open chat"  ──► CopilotChatScreen

Contextual entry
  Client detail  → "Ask Copilot" → CopilotChatScreen (prompt pre-seeded)
  Offer detail   → "Ask Copilot" → ...
  Application list → "Ask Copilot" → ...

Proposed action
  CopilotChatScreen → action card → ActionResultScreen
                                       ├─ Edit the proposed text
                                       └─ Confirm → executes via existing API
```

## API contract dependency

- `POST /ai/copilot/conversations` body
  `{ context?: { kind: 'client' | 'offer' | 'application';
  id: string }; seedPrompt?: string }` → `Conversation`
- `POST /ai/copilot/conversations/:id/messages` body
  `{ body }` → streamed `Message`
- `POST /ai/copilot/conversations/:id/cancel` → 204
- `GET /ai/copilot/conversations` → `Conversation[]`
- `GET /ai/copilot/conversations/:id` → `Conversation`
- `POST /ai/copilot/actions/:proposalId/confirm` body
  `{ overrides?: any }` → `ActionResult`

```ts
type Citation = {
  kind: 'check_in' | 'offer' | 'application' | 'event' |
        'wallet' | 'space_post';
  id: string;
  label: string;            // server-rendered for display
  range?: { from: string; to: string };
};

type Message = {
  id: string;
  role: 'coach' | 'copilot';
  body: string;
  citations: Citation[];
  proposedAction: ProposedAction | null;
  createdAt: string;
};

type ProposedAction = {
  id: string;
  kind: 'send_dm' | 'create_bounty' | 'pause_offer' |
        'reschedule_event' | 'reply_to_application';
  payload: Record<string, unknown>;     // typed by kind on server
  preview: string;                       // human-readable preview
};

type ActionResult = {
  id: string;
  status: 'completed' | 'failed';
  resultRef?: { kind: string; id: string };
  failureReason?: string;
};
```

## Stripe / TGP-balance abstraction

The copilot does not handle payments directly. If it proposes
an action with financial impact (e.g. "create a bounty with
$50 payout"), the action confirm screen renders the financial
impact prominently and routes through the same authoring path
as the relevant feature ([09](./09-rewards-bounties.md), etc.).

## Loading / error / empty states

- **Loading (initial conversation):** skeleton shortcut tiles,
  not a spinner.
- **Streaming:** typing indicator + partial body.
- **Stream error:** show partial body + "Retry" CTA.
- **Empty (history):** "Ask Copilot anything about your
  business — start with a shortcut above."
- **Citation missing on a data-grounded answer:** soft warning
  banner, not a blocked surface.
- **Rate-limited:** clear copy on retry-after; do not silently
  fail.
- **Action failure:** ActionResultScreen renders the typed
  reason and offers retry.

## Accessibility

- Streaming text uses `aria-live="polite"` semantics so screen
  readers don't interrupt every token.
- Citation chips are individually tappable with explicit labels.
- "Ask Copilot" entry points have explicit destination labels
  ("Ask Copilot about <client name>").
- Action confirmation is keyboard-accessible end to end.

## Analytics

- `copilot_opened` — `{ source: 'tile' | 'shortcut' | 'context',
  contextKind?: string }`
- `copilot_shortcut_run` — `{ shortcutId }`
- `copilot_message_sent` — `{ conversationId, bodyLength }`
- `copilot_stream_cancelled` — `{ conversationId,
  tokensReceived }`
- `copilot_action_proposed` — `{ kind }`
- `copilot_action_confirmed` — `{ kind, edited: bool }`
- `copilot_action_completed` — `{ kind, status: 'completed'
  | 'failed', failureReason? }`

No body content; lengths only.

## Feature flags / entitlements

- Flag: `features.copilot`. Off by default.
- Entitlement: `entitlements.copilot` (Pro/Studio).
- Team Mode: `roles.copilot.full` vs `roles.copilot.read_only`
  vs `roles.copilot.none`. Read-only can chat but not confirm
  actions.
- Rate limits server-side per coach.

## Privacy / moderation

- Coach data sent to the gateway is scoped to that coach's
  tenant; cross-tenant leakage is impossible by ACL.
- Conversation history is private to the coach; team-mode
  members see only their own conversations.
- The copilot does not see client free-text from the
  client-facing AI guide unless the coach is reviewing a
  specific client and the access is in scope.
- Prompt-injection: client-supplied free-text (check-in
  notes, application answers, space posts) is included as
  *quoted, fenced* context in the server prompt template;
  mobile never assembles prompts.
- A delete-my-data request from a coach removes their
  conversation history; a delete-my-data request from a
  client redacts that client's data from any coach
  conversation that referenced it (server-side; mobile
  re-renders on next load).

## Rollout

1. Internal — feature flag on for the team's coach accounts;
   one shortcut at a time, verify each end-to-end.
2. Add the chat surface; verify streaming + cancel.
3. Add structured actions; verify each `kind` end-to-end with
   a confirm step.
4. Flip on for a 5–10 coach ring.
5. GA after a representative coach has used it for ≥2 weeks
   without a citation regression.

## Tests

- Unit: streaming-buffer assembly; cancel mid-stream cleans up
  request state.
- Unit: deep-link mapping for `Citation['kind']` and
  `ProposedAction['kind']`.
- Component: shortcut runner (`copilot_shortcut_run` analytics
  fired with the right id).
- Component: ActionResultScreen for each `kind` with edit +
  confirm.
- Integration: prompt-injection regression — a check-in note
  containing "ignore previous instructions" must not change
  copilot behaviour. Backed by a fixture test.
- Manual: real coach flow — open shortcut, follow up with a
  refining question, confirm an action, verify the action
  effect in the underlying surface (e.g. DM appears in the
  client's inbox).

## Risks

- **Hallucinated citations.** A copilot answer that cites a
  check-in that doesn't exist is a serious doctrine violation.
  Server-side validation should reject outputs whose citations
  don't resolve; mobile must render the resulting "we couldn't
  ground this" surface honestly.
- **Action mis-confirmation.** A coach who hits confirm
  without reading the proposed text sends the wrong DM. The
  preview is mandatory; the action card cannot be confirmed
  without the preview being on-screen for ≥500ms (UI-side
  guard).
- **Voice/tone drift.** If `docs/expansion/11` voice/tone is
  not honoured, the copilot will sound off-brand for the
  coach. Test the wiring explicitly.
- **App Store policy on AI assistants.** Disclosure ("Copilot
  is an AI tool") is required on the home screen and on every
  message bubble; do not minimise it.
- **Cost.** Streaming long answers is expensive. Server-side
  caps and per-coach rate limits must be tested under load
  before flag-flip.

## Dependencies

- Backend #117 AI gateway.
- `docs/expansion/10` weekly recap (shortcut reuse).
- `docs/expansion/11` editable voice/tone.
- `docs/expansion/08` clients-needing-attention (shortcut data
  source).
- `docs/expansion/19` coach revenue dashboard (shortcut data
  source).
- `docs/expansion/20` team mode (role gating).
- All other features in this pack are *consumers* of the
  copilot's references; no hard dependency on them shipping
  first, but the copilot's value is proportional to how many
  are live.

## Acceptance criteria

- [ ] Flag off → no copilot tile or contextual entry; deep-links
      to copilot routes return to Coach Home.
- [ ] Flag on → coach can run a shortcut end-to-end with
      citations rendering correctly.
- [ ] Streaming + cancel works on iOS and Android, cold and
      warm.
- [ ] Each `ProposedAction['kind']` is end-to-end testable with
      a confirm step that renders the preview before execution.
- [ ] Voice/tone setting from `docs/expansion/11` is honoured.
- [ ] Team Mode read-only role can chat but cannot confirm
      actions; the confirm button renders disabled with an
      explainer.
- [ ] Disclosure copy ("AI tool") is present on the home tile
      and on every copilot message bubble.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- The first hallucinated citation will produce a sharp
  reaction. Server-side citation validation is the primary
  defence; mobile's "we couldn't ground this" surface is the
  secondary. Verify both before flipping the flag for any
  external coach.
- The copilot's most-used shortcut will likely be "Summarise
  my last week". Treat its quality as a leading indicator —
  if the coach disengages from that shortcut, the copilot is
  failing.
- Resist the urge to ship a "auto-execute approved actions"
  toggle in v1, even if a coach asks. The confirm step is the
  one thing standing between an LLM and a wrong DM to a
  client.
