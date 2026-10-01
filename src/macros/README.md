# src/macros — macro display mode (lighter start for never-trackers)

Clinic onboarding contract v1, addition 8 (owner ruling 2026-09-30 18:11). A client who answered "never" to "tracking before" (N4) starts with a lighter view for their first week: calories and protein only. Carbohydrate and fat targets are still computed and stored by the server. Only the display changes.

## Server contract

`GET /me/macros/current` and the `POST /me/onboarding/complete` payload carry:

```json
{ "macro_display_mode": "simple" | "full", "simple_until": "2026-10-08" | "2026-10-08T07:00:00Z" | null }
```

- **Absent field means `full`.** Nothing changes for any client until the backend sends it.
- `simple` applies while `now < simple_until`. A bare date is the start of that day in the client's local time. With `simple` and no date, the view stays simple until the server says `full`.

## Files

- `macroDisplay.ts`: pure rules. Parsing (top level or common envelopes), the effective mode, `shouldShowFullMacrosIntro`, and what each surface shows (`homeCells`, `targetCells`, `foodMacroLine`).
- `macroDisplayStore.ts`: a zustand store, persisted per user at `tgp.macroDisplay.v1:<userId>`. It stores only the mode, the end date, whether the client was ever simple, and when the introduction was dismissed. No numbers and no answers. A user switch never carries state over.

## Who reports the field

- `startClientTutorial(payload)` (onboarding complete payload) and the `GET /me/onboarding` fallback in `TutorialHost`.
- `useMacroTargets()` (Log), `ClientMacrosScreen`, and `TutorialHost` (all read `GET /me/macros/current`).

## Surfaces

| Surface | Simple | Full (and absent field) |
| --- | --- | --- |
| Home number grid | Calories, Protein, Water | Protein, Carbs, Fat, Water (unchanged) |
| Log summary bar | Eaten, Remaining, Protein | Eaten, Remaining, Protein, Carbs, Fat (unchanged) |
| Log food entries | `P: 12g` | `P: 12g · C: 54g · F: 6g` (unchanged) |
| Macros screen | Calories, Protein, plus one quiet note | Calories, Protein, Carbs, Fats, Fiber (unchanged) |
| Pinned macro card (tutorial) | Calories, Protein, simple explanation | Calories, Protein, Carbs, Fat (unchanged) |
| Tutorial macro step | Roman: "This first week, we keep it to two numbers..." | Four-number line (unchanged) |

## The one-time introduction

`components/home/FullMacrosIntroCard.tsx` is a quiet Roman card on Home. It appears once the simple view ends, which is either the day `simple_until` passes or the moment the server reports `full` after a simple start. It shows the client's real carbohydrate and fat targets when known. "Understood" dismisses it, and the dismissal is persisted per user, so it never returns. A client who was never simple never sees it. It is not behind a feature flag: without the backend field it cannot render.

## Tests

`src/macros/__tests__/` (rules and store), `components/home/__tests__/FullMacrosIntroCard.test.tsx`, `components/log/__tests__/` (summary bar, meal entries), `screens/client/__tests__/HomeScreen.macroMode.test.tsx`, `screens/client/__tests__/ClientMacrosScreen.macroMode.test.tsx`, plus the simple-mode cases in `tutorial/__tests__/tutorialCopy.test.ts`, `tutorialStore`-backed cases in `macroDisplayStore.test.ts`, and `components/tutorial/__tests__/tutorialCards.test.tsx`.
