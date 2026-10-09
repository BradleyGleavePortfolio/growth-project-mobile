# Entitlements: the client paid-screen gate

`EntitlementProvider` asks the server whether the signed-in client has access (`GET /v1/checkout/entitlement`) at sign-in and
whenever the app returns to the foreground. The code sheet, checkout and plan screens ask again after a join or a purchase. A 402
`CLIENT_ENTITLEMENT_REQUIRED` from a paid call marks access inactive and opens `PaywallSheet`. `withProtectedScreen` / `ProtectedScreen` wrap the paid
client routes in `ClientNavigator` (see `src/navigation/README.md`); Messages is not wrapped.

What `ProtectedScreen` shows:

| State | Shown |
|---|---|
| unknown, loading, checking | Spinner |
| active | The screen |
| inactive, client with a coach | "Choose a Plan" with View Plans; on hidden iOS builds "Your coach manages your access" with Message your coach |
| any state, any client, screen marked `openToCoachless` | The screen. Logging, workouts, plans, fasting, macros, check-ins and Roman guidance are the client's own basic functions: the server opens these routes (`@OpenToCoachlessClient()`) to every client, coachless or coached, with a free package, no package or a lapsed plan (b#888 B22/B24; owner ruling 10-08 23:5x, B1), so they are never gated. The rows above and below apply only to screens without the mark |
| inactive, coachless client, coach-only screen (Community, sessions, Calendar) | "This part comes with a coach", "Join a coach with their code. Each coach sets up what their coaching includes." with Enter a coach code (the existing code sheet) |
| unavailable (the check failed: weak signal, server error) | "Your access could not be checked", "Check the connection, then try again." with Try again, which re-runs the check. The screen stays closed until the server confirms access (FOOD-GATE-RETRY-130). |
| checking or unavailable after access was confirmed in this session | The screen stays mounted, so a live workout survives weak signal (TRAIN-GATE-128) |

`withProtectedScreen(X, { openToCoachless: true })` also wraps the screen in `dunning/DunningOwnScreen`, so it stays open through the Day 10+ payment lockout with the locked notice at its foot (owner ruling 10-08 23:5x; see `dunning/README.md`).

On hidden iOS builds and for coachless clients `PaywallSheet` never lists packages or prices (App Review 3.1.1). Follows
`docs/QUIET_LUXURY_DOCTRINE.md`.

Coachless coach-only screens (owner 10-09 00:0x, B-ROMANLOCK-135): the body now reads "It opens once you join a coach. Each
coach sets up what their coaching includes." and the button "Join a coach" (`PaywallSheet` `COACHLESS_BODY` / `COACHLESS_CTA`),
replacing the wording in the table row above; it still opens the existing code sheet.
