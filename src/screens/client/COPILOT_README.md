# Path Copilot (style A, owner #162-1)

Roman explains why a client's plan is set the way it is, and can suggest one plan change. Roman never applies a change:
the client sends it to their coach, and the coach approves, edits or declines it. Design: context branch
`op162/copilot-mockups`, `planning/MOCKUP3/COPILOT/index.md` (frames 04 to 06). Server contract: backend #1120,
"Contract for the phone".

## PR-1 surfaces (COPILOT-M1)

| Surface | File | What it does |
|---|---|---|
| Your path | `ClientPathCopilotScreen.tsx` | `GET /client/copilot`: the client's last three sent suggestions with their status lines. 404 (server switch off) shows the calm empty state, nothing new. |
| Suggestion card | `copilot/SuggestionCard.tsx` | Now -> Suggested, "Nothing changes until {coach} says yes.", "Send to {coach}" (`POST /client/copilot/suggestions/:id/send`), the sent line. 409 lapsed, AI help off (the shared consent notice) and a dropped connection each say so. |
| Status lines | `copilot/SuggestionStatusList.tsx`, `copilot/pathChangeWords.ts` | Waiting, approved (an edited change reads as approved with the day or kcal the coach applied), kept (with the coach's one-line note), expired. Every title and value is composed on the phone from the structured change. |
| Coach row | `../coach/copilot/PathChangeDraftCard.tsx`, `../coach/copilot/PathChangeDrafts.tsx` | In the coach's drafts list (`PendingAiDraftsScreen.tsx`), oldest sent first (`GET /ai/gateway/drafts?order=oldest`): Approve, Edit (one field; the server applies it on the live plan, so it still works after "the plan changed"), Decline with an optional one-line note. |

Calls: `src/api/copilotApi.ts` (strict parsers; an older server's bare drafts array reads as no rows).

## Seams for COPILOT-M2 (wave 2)

- Mount `SuggestionCard` under Roman's answer from the done frame's `copilot.suggestion` (status `suggested`).
- The week block (CP-A-13) goes in the masthead under the title; the source tags (CP-A-16/17) go in the card and the coach row.
- Past questions, the You row (CP-A-01/02) and the queue shell ("Roman's drafts", "{n} waiting", "Show all {n}") are not built here.

## Flags

`featureFlags.clientPathCopilot` (`EXPO_PUBLIC_FF_CLIENT_PATH_COPILOT`, off in production) gates the screen and the coach
rows. Server: `FEATURE_CLIENT_PATH_COPILOT` (unset = 404).

## Tests

`src/api/__tests__/copilotApi.test.ts`, `copilot/__tests__/copilot.test.tsx`,
`../coach/copilot/__tests__/PathChangeDraftCard.test.tsx`, plus the source guards in `src/__tests__/wave11Screens.test.tsx`.
