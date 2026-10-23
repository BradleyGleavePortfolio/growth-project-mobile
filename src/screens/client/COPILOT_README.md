# Path Copilot (style A, owner #162-1)

Roman explains why a client's plan is set the way it is, and can suggest one plan change. Roman never applies a change:
the client sends it to their coach, and the coach approves, edits or declines it. Design: context branch `op162/copilot-mockups`,
`planning/MOCKUP3/COPILOT/index.md` (frames 04 to 06). Server contract: backend #1120, "Contract for the phone".

## PR-1 surfaces (COPILOT-M1)

| Surface | File | What it does |
|---|---|---|
| Your path | `ClientPathCopilotScreen.tsx` | `GET /client/copilot`: the client's last three sent suggestions with their status lines. 404 (server switch off) shows the calm empty state, nothing new. |
| Suggestion card | `copilot/SuggestionCard.tsx` | Now -> Suggested, "Nothing changes until {coach} says yes.", "Send to {coach}" (`POST /client/copilot/suggestions/:id/send`), the sent line. 409 lapsed, AI help off (the shared consent notice) and a dropped connection each say so. |
| Status lines | `copilot/SuggestionStatusList.tsx`, `copilot/pathChangeWords.ts` | Waiting, approved (an edited change reads as approved with the day or kcal the coach applied), kept (with the coach's one-line note), expired. Every title and value is composed on the phone from the structured change. |
| Coach row | `../coach/copilot/PathChangeDraftCard.tsx`, `../coach/copilot/PathChangeDrafts.tsx` | In the coach's drafts list (`PendingAiDraftsScreen.tsx`), oldest sent first (`GET /ai/gateway/drafts?order=oldest`, every page up to 1,000 rows; "No pending drafts" only once this read answered empty): Approve, Edit (one field; the server applies it on the live plan, so it still works after "the plan changed"; an older move starts inside the 2-days-back to 7-days-ahead window), Decline with an optional one-line note. A client with no coach sees the Roman lock page. |

Calls: `src/api/copilotApi.ts` (strict parsers; an older server's bare drafts array reads as no rows).

## PR-2 surfaces (COPILOT-M2, backend #1129)

| Surface | File | What it does |
|---|---|---|
| Week block | `copilot/WeekBlock.tsx` | `GET /client/copilot` `week`: "Week {n} with {coach}", the daily target ("Changed {weekday}" when it changed this local week), workouts this week, the last check-in; "—" for no data. Folds to two chips once a question is asked. No `week` (older server): no block. |
| Ask and answer | `ClientPathCopilotScreen.tsx`, `copilot/useCopilotAsk.ts`, `copilot/AnswerCard.tsx` | Starter questions and the composer send through Roman's normal path (`POST /roman/sessions/:id/messages` in the client's open chat) with `x-roman-copilot: 1`, the only place that header is sent (`sendMessage(..., { copilot: true })`). The answer: the first sentence as the serif lead, the rest, then "From your data" with one row per cited fact (tag + the server's label and detail). No `copilot` on the reply (older server): the plain reply. Crisis replies keep their buttons. |
| Suggestion under the answer | `copilot/SuggestionCard.tsx` | Mounted from `copilot.suggestion` while it is `suggested`, with its source tags; once sent or decided it shows its status line. |
| Past questions | `copilot/PastQuestions.tsx` | `GET /client/copilot/questions`: the "Past questions · {n}" row, then the list by month with "{n} questions since {month year}", outcomes and "Show older questions". A row opens that answer with its facts (`GET /roman/sessions/:id/messages` with the header). 404: nothing drawn. A declined change reads "Your coach kept your plan as it is" (the server does not say who declined). Neither read is saved to the phone; when Settings erases a chat (Delete, Delete all) or the transcript finds it gone, `copilot/copilotErasure.ts` drops that chat's answers and reads the list again, and an open answer of that chat leaves the stack. |
| States | `ClientPathCopilotScreen.tsx` | Coachless: Roman's lock page. A failed turn keeps the question and says so in Roman's words: offline, error, rate limit, credits used up, AI help off (the shared notice), the daily cap pop-up. |

The three views (Your path, Past questions, one past answer) are the same `Copilot` route pushed with a `view` param,
so Back always returns one step. Not built: the You row (CP-A-01/02), the queue shell, the coach row's source tags.

## Flags

`featureFlags.clientPathCopilot` (`EXPO_PUBLIC_FF_CLIENT_PATH_COPILOT`, off in production) gates the screen and the coach
rows. Server: `FEATURE_CLIENT_PATH_COPILOT` (unset = 404).

## Tests

`src/api/__tests__/copilotApi.test.ts`, `copilot/__tests__/copilot.test.tsx`, `copilot/__tests__/copilotTurn.test.tsx`,
`../coach/copilot/__tests__/PathChangeDraftCard.test.tsx`, `src/__tests__/qaCoachStates131.test.tsx` (the drafts list states),
plus the source guards in `src/__tests__/wave11Screens.test.tsx`.
