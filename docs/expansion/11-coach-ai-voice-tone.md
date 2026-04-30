# 11 — Editable coach AI voice/tone setting

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app
**Owner:** Mobile (coach-side)
**Cross-repo:** Backend draft PR **#117 (AI Program Builder)** — voice/tone is
applied as a system-prompt prefix at the LLM gateway layer.

## WHY

Every AI surface the coach exposes (recap #10, future program-builder
output #18, future drafted nudges) speaks in *some* register. Without a
configurable voice, all coaches sound like the same chatbot, and clients
notice. A short voice/tone setting — three or four levers, plus a free-text
"do not say" list — gives each coach an identity layer without exposing
the prompt itself.

This is also the cleanest way to ship "set it once, applies everywhere"
across the AI surfaces being added in this expansion pack.

## WHEN to build

Concurrent with or just after #10. The recap button (#10) renders a
generic voice on day one; #11 is what makes it sound like the coach. It
is fine to ship #10 first and #11 within the same release cycle.

Required before #18 (mobile clone of starter programs) if the cloned
program text is AI-rewritten — same gateway, same tone.

## WHERE in the repo

- New screen / row group on `src/screens/coach/SettingsScreen.tsx`:
  "AI voice & tone" → opens
  `src/screens/coach/AIVoiceToneScreen.tsx`.
- API: `coachApi.getAIVoice()` and `coachApi.updateAIVoice(payload)` in
  `src/services/api.ts`.
- Type: `src/types/aiVoice.ts` — `AIVoiceSettings`.
- The settings are read server-side at LLM time; the mobile app only
  needs to GET the current value, render an editor, and PUT updates.

## WHO owns and uses it

- **Builder:** Mobile coach team.
- **Primary user:** Coach.
- **Indirect consumer:** Every AI generation endpoint that respects
  `coach_ai_voice` — recap (#10), future program text (#18), future
  drafted-nudge.

## WHAT MVP includes

- A small settings screen with:
  - Tone preset picker — radio group of {Direct, Warm, Coach-y, Clinical}.
  - Formality slider — 1 (casual) to 5 (formal). Default 3.
  - "Avoid these phrases" — free-text, comma-separated; max 200 chars.
  - "Sample preview" — read-only paragraph that shows what a recap-style
    message would sound like with the current settings. The preview is
    server-rendered (one round-trip to a `/coach/ai-voice/preview`
    endpoint with the unsaved settings) so it matches what clients
    will see.
- "Save" persists to backend; "Reset" returns to defaults.

### Out of scope for v1

- Per-client tone override.
- Voice cloning (audio).
- Custom system prompts / raw prompt access. Coaches edit knobs, not
  prompts. Doctrine: hide the model.

## HOW to implement safely

1. Get the backend contract finalised first — this feature is essentially
   a typed editor over a server-side row. Mobile diverging from the
   stored shape produces dead settings.
2. Render "Save" disabled until the form is dirty; show a destructive
   confirm on "Reset".
3. Preview is the trust-builder. Without it, coaches pick a preset and
   never see what changed. Treat preview as a v1 requirement, not a
   v1.1 nice-to-have. If the preview endpoint isn't ready, ship the
   feature behind the flag *off* until it is.
4. Cache the active settings in a Zustand slice; AI surfaces (#10) read
   it from there for any local labels (e.g. badge "Tone: Warm" on the
   recap draft) but the *application* of the tone is server-side.
5. Validate "Avoid these phrases" length and stripping; treat the input
   as data, never interpolate it into a prompt on the client.

## Screens / navigation sketch

```
SettingsScreen (coach)
  └─ Row: "AI voice & tone"  ──► AIVoiceToneScreen
                                  ├─ Tone preset (radio)
                                  ├─ Formality slider (1–5)
                                  ├─ "Avoid these phrases" (text)
                                  ├─ Sample preview (read-only)
                                  ├─ Save / Reset
```

## API contract dependency

- `GET /coach/ai-voice` → `AIVoiceSettings`
  `{ tone: 'direct'|'warm'|'coachy'|'clinical', formality: 1-5, avoid_phrases: string[] }`
- `PUT /coach/ai-voice` body `AIVoiceSettings` → `AIVoiceSettings`
- `POST /coach/ai-voice/preview` body `AIVoiceSettings` →
  `{ sample_text: string }`
- All AI generation endpoints (#10, future) read the stored row when
  composing the prompt — no per-call mobile parameter.

## Feature flag / rollout

- Flag: `features.coachAIVoiceTone`.
- Independent of #10's flag, but shipping it without #10 means there's
  no surface that *uses* the setting. Document that in the row's helper
  text: "Used by AI tools as they ship."
- Kill switch hides the row and the screen.

## Testing plan

- Unit: serialiser round-trips between server shape and form state.
- Component: dirty-state save button; reset confirm; preview loading
  + error.
- Integration: edit → save → re-open screen reads the new value.
- Manual: change tone, generate a recap (#10), confirm the output
  reflects the change.

## Risks

- **Preview drift.** If the preview model differs from the recap
  generation model, coaches "save" something that doesn't match what
  goes out. Backend must guarantee preview uses the same gateway and
  prompt template.
- **Verbatim leakage.** "Avoid these phrases" is user input — treat as
  data, never as prompt text on the client. Backend handles
  interpolation safely.
- **Defaults.** Pick defaults that sound *fine* for a brand-new coach.
  An unfortunate default register makes a worse first impression than
  any AI feature itself.

## Dependencies

- Backend: row, three endpoints, gateway respect.
- #10 to make the setting *visible* in effect; otherwise it's a
  pre-emptively shipped knob.

## Acceptance criteria

- [ ] Flag off → no row in Settings.
- [ ] Flag on → screen mounts, preview round-trips, save persists.
- [ ] Reset returns to defaults; cancel mid-edit prompts on back.
- [ ] No hardcoded hex; theme tokens only.
- [ ] `src/screens/coach/README.md` updated.
