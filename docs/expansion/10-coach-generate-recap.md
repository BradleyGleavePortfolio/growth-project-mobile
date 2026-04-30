# 10 — "Generate weekly recap" coach button

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app
**Owner:** Mobile (coach-side)
**Cross-repo:** Backend draft PR **#117 (AI Program Builder)** establishes the
LLM gateway pattern this feature reuses.

## WHY

Coaches write the same shape of weekly recap by hand for every client —
they paste check-in answers, eyeball the weight trend, draft a paragraph,
send. An AI draft button collapses that into one tap, with the coach
editing before send. The output is a *draft*, not an autosend; the coach
remains the author. This is the highest-leverage AI surface on the coach
side because the labour today is tedious and the artefact is short.

## WHEN to build

After #05 (check-ins) and #06 (widget) are in production. Without check-in
data, the recap generator has nothing to summarise beyond logs and weights.
Also requires backend PR #117 (or its successor) to expose a generation
endpoint — without it the mobile button is a dead pixel.

## WHERE in the repo

- New entry point: button on `ClientDetailScreen.tsx`, near the existing
  guidelines / nudge controls.
- New screen: `src/screens/coach/RecapDraftScreen.tsx` — full-screen
  editor showing the AI draft, editable, with "Send to client" and
  "Discard". Send hits the existing client-message endpoint.
- API: `coachApi.generateWeeklyRecap(clientId, isoWeek)` in
  `src/services/api.ts`.
- Type: `src/types/recap.ts` — `RecapDraft`, `RecapInputs`.

## WHO owns and uses it

- **Builder:** Mobile coach team. Coordinates with backend on the LLM
  gateway shape established in PR #117.
- **Primary user:** Coach.
- **Recipient:** Client receives the final message via the existing
  messages thread — no new inbox.

## WHAT MVP includes

- "Generate weekly recap" button on the client's detail screen, only
  visible when at least one check-in exists for the client.
- Tap → `RecapDraftScreen` with a loading state, then the draft.
- Draft includes: greeting, two-sentence summary, one specific
  observation tied to the week's data, one suggested next step. Plain
  text, no markdown — clients see it in the messages thread which is
  text-only.
- Editable in place. "Send" pushes via the existing
  `coachApi.sendClientMessage` (no new endpoint for delivery).
- "Discard" exits without saving; "Save as draft" stores locally
  (AsyncStorage keyed by `client_id + iso_week`) so the coach can come
  back to it.

### Out of scope for v1

- Auto-send / scheduled send.
- Sending to multiple clients at once.
- Per-client tone overrides at recap time (defer to #11's voice/tone
  setting which is account-wide for v1).
- Image / chart attachment.

## HOW to implement safely

1. Wait for the backend endpoint to exist and to respect the LLM gateway
   contract from PR #117 (rate limits, content safety, error shape).
2. The mobile button must be flagged off until the backend is healthy
   under load. Bad first impressions kill AI features.
3. Generation is a `POST` that may take 5–15 s. Show a determinate-feel
   skeleton, not an indeterminate spinner. Add a 30 s timeout with an
   honest error: "Couldn't generate a recap — try again or write one by
   hand."
4. The output is *not* sent automatically. Make the edit affordance
   obvious — a coach who taps Send without reading is going to send a
   hallucinated paragraph. Force a 1-second "Send" button delay on first
   draft (subsequent edits remove the delay).
5. Persist drafts locally per `(client_id, iso_week)` so a backgrounded
   app doesn't lose a 200-word edit.

## Screens / navigation sketch

```
ClientDetailScreen
  └─ "Generate weekly recap"  (visible iff check-ins exist)
        │
        ▼
RecapDraftScreen
  ├─ Loading skeleton (5–15 s)
  ├─ Editable text area (prefilled with draft)
  ├─ "Send to client"  ──► sendClientMessage → ClientMessages thread
  ├─ "Save as draft"   ──► AsyncStorage; close
  └─ "Discard"         ──► close, no save
```

## API contract dependency

- `POST /coach/recaps/generate` body `{ client_id, iso_week }` →
  `{ draft_text: string, inputs_summary: { check_ins: number, logs: number, weights: number }, model: string }`.
- Inherits LLM gateway shape from backend PR #117 — same auth, same rate
  limit headers, same error envelope.
- Send uses existing `POST /coach/clients/:id/messages` — no change.

## Feature flag / rollout

- Flag: `features.coachRecapGenerator`.
- Phased: internal dogfood (1 coach) → 5-coach cohort → wide. Watch
  generation latency and edit-rate (% of drafts the coach materially
  edits before sending) before widening.
- Kill switch hides the button and the screen registration.

## Testing plan

- Unit: button visibility logic (only when check-ins exist).
- Unit: AsyncStorage draft round-trip per `(client_id, iso_week)`.
- Component: loading skeleton, error state, edit + send, discard.
- Integration: generate → send → message appears in `ClientMessages`
  thread.
- Manual: latency under real network conditions; what happens on
  airplane mode mid-generation (must error cleanly, never silently
  send the placeholder text).

## Risks

- **Hallucination.** AI may confidently summarise a week the client
  didn't actually have. The 1-second send delay and obvious edit
  affordance mitigate; the larger mitigation is content-safety on the
  backend (#117).
- **Latency.** 15 s feels broken on mobile. If P95 exceeds 12 s, ship a
  background-generate option (kick off, notify when ready) before going
  wide.
- **Tone drift.** Without #11 (voice/tone), the model speaks in a
  generic register. Some coaches will dislike it. Document that #11 is
  the customisation lever, not v1 of #10.

## Dependencies

- Backend PR #117 (or successor) — LLM gateway and generation endpoint.
- #05, #06 in production for non-empty inputs.
- #11 not strictly required, but pairs naturally.

## Acceptance criteria

- [ ] Flag off → no button, no screen, no network call.
- [ ] Flag on, no check-ins → button hidden.
- [ ] Generation completes → draft is editable; send pushes a normal
      message.
- [ ] Generation fails → honest error, no silent send.
- [ ] Drafts persist across app backgrounding.
- [ ] No hardcoded hex; theme tokens only.
