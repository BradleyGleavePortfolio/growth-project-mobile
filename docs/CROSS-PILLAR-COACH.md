# Cross-pillar coach UI — Stage-3 architecture (fitness mobile)

## Why this lives in the fitness app

The locked architecture for "Both" coaches is: **the cross-pillar UI
runs inside the Body app**. The Body app already hosts the OWNER admin
console (`AdminControlRoomScreen`), the federation orchestration
service (`gpb /admin/federation/*`), and the existing 18+ coach screens
that make this the natural seat. The Wealth app stays focused on its
own coach surfaces.

The Settings → "Cross-pillar practice" row was a Stage-2 stub
(`BothPillarsScreen.tsx`). Stage 3 replaces it with a full nested
navigator while preserving the original stub at the alias route
`BothPillarsLegacyStub` for QA regression.

## Screen map

```
SettingsStack ▶ "Cross-pillar practice" row (BothPillars route)
  │
  └── CrossPillarNavigator (decides mount based on coach_practice_type)
        │
        ├── PracticeSelection           — first run + Settings drilldown
        │     └── on save: PUT /api/coach/practice → invalidate, mount Home
        │
        ├── CrossPillarHome             — dashboard
        │     ├── practice analytics (fitness Postgres + finance via federation)
        │     ├── unified roster summary (counts, on-both vs body-only)
        │     └── quick tiles → Clients · Messages · Assignments
        │
        ├── CrossPillarClients          — universal roster + EHR search
        │     ├── <UniversalClientSearch /> at the top
        │     ├── filter chips: All · Both · Body only · Wealth only
        │     └── FlatList of CrossPillarRosterRow
        │
        ├── CrossPillarClientDetail     — per-client unified view
        │     ├── Body tab               (fitness profile + 7d activity)
        │     ├── Wealth tab             (finance summary + 7d activity)
        │     └── Both tab               (side-by-side + holistic insights)
        │
        ├── CrossPillarMessages         — combined inbox
        │     └── Body unread count + Wealth deep-link (intentional, see Doctrine)
        │
        └── CrossPillarAssignments      — combined assignments
              └── Roster picker → CrossPillarClientDetail.Both
```

## Doctrine choices (and the reasons)

### Practice gate at the navigator
The `CrossPillarPracticeGuard` on the backend rejects with
`PRACTICE_NOT_BOTH` for non-`both` coaches. The mobile navigator does
**not** rely on the 403 to drive UX — it reads the practice type once
on mount and routes to `PracticeSelection` instead. The 403 is the
belt-and-suspenders guard for tampered clients; the mobile experience
is "you haven't picked yet → here's the picker".

### Honest scope on Messages and Assignments
The cross-pillar Messages and Assignments screens explicitly link out
to single-product inboxes rather than fake a unified feed. We could
have built a fake feed by polling both endpoints and merging in
JavaScript, but the result would have been correct only by accident
(thread dedup across two backends with different schemas) and would
have masked the actual integration work. Stage 3.5 ships the unified
wire spec; until then, honest UX wins.

### Loading skeletons, not spinners
Every screen (Home / ClientsList / ClientDetail / Messages /
Assignments) defaults to a skeleton shape that matches the resolved
content's row layout. Reduce-Motion users get a calm `ActivityIndicator`
instead — the OS preference is queried once on mount.

### No `Record<string, unknown>` on the wire
`src/types/crossPillar.ts` defines closed string-literal unions for
every cross-app field (`CoachPracticeType`,
`CrossPillarFinanceRowStatus`). The Stage-3 contract test
`CrossPillarSurface.test.ts` pins the strict shape so the income-bucket
class of bug from Stage 1 cannot recur on a federation contract.

## Component reuse

`<UniversalClientSearch />` is generic on the fetch function — pass any
`(q: string) => Promise<UniversalSearchHit[]>` and the search bar +
debounce + recent-on-focus + reduce-motion skeleton all behave
identically. Three planned consumers:

1. Cross-pillar list (Stage 3 — shipped here): adapter wraps
   `crossPillarApi.search`.
2. Body coach client list: planned 3.5 — replace inline TextInput with
   the component, adapter wraps the local `coachApi.getClients` query.
3. Wealth coach client list: planned 3.5 — same pattern, adapter
   wraps `coachApi.getClients` on the finance side.

Stage 3 deliberately did **not** refactor the existing single-product
client list screens to use `<UniversalClientSearch />` — that's a
behavioural-equivalence diff that wants its own commit and its own
review. The component is built to drop in.

## Routes

The `CrossPillarStackParamList` exported from
`CrossPillarNavigator.tsx` is the single source of truth for typed
navigation params:

```ts
export type CrossPillarStackParamList = {
  PracticeSelection: { current?: CoachPracticeType | null } | undefined;
  CrossPillarHome: undefined;
  CrossPillarClients: { focus?: 'search' } | undefined;
  CrossPillarClientDetail: { email: string; name: string };
  CrossPillarMessages: undefined;
  CrossPillarAssignments: undefined;
};
```

`identityKey` on the wire is `email` today; the route param is also
`email` to match. Swap the param when shared `account_id` lands; the
detail screen reads only `route.params.email` so the change is
mechanical.

## Tests

| Test | Pinned guarantee |
| --- | --- |
| `src/__tests__/CrossPillarSurface.test.ts` | API client is typed, no `Record<string, unknown>`; CoachNavigator mounts the live navigator at `BothPillars`; Settings copy reflects live capability not preview. |
| `src/lib/__tests__/recentClients.test.ts` | Recent-clients local cache: deduplication, MAX_RECENT cap, malformed-input safety. |
| `src/hooks/__tests__/useDebouncedValue.test.ts` | Hook returns the initial value, debounces transitions, settles synchronously when delay is 0. |

Backend tests live alongside the federation surface they cover —
`gpb/test/cross-pillar.service.spec.ts`,
`gpb/test/cross-pillar-practice.guard.spec.ts`,
`gpb/test/coach-practice-type.service.spec.ts`,
`tgp-finance-app/backend/test/coach-practice-type.service.spec.ts`.
