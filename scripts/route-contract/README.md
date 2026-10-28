# Phone to backend route contract

This is a static existence guard, not a live API or authorization test. The check lists
each mobile HTTP method, canonical path and caller line, then fails for any missing
method/path or obsolete allowlist row. It never imports app code, starts Nest, accesses
secrets, sends requests or needs a GitHub token.

## Run and refresh

```sh
node scripts/route-contract/check.js
npx jest scripts/__tests__/routeContract.test.js --ci --runInBand

# In a clean, separately authenticated backend checkout:
git -C ../growth-project-backend fetch origin main
git -C ../growth-project-backend checkout --detach origin/main
node scripts/route-contract/backend.js ../growth-project-backend \
  scripts/route-contract/backend-routes.txt
node scripts/route-contract/backend.js ../growth-project-backend --unmounted
git diff -- scripts/route-contract/backend-routes.txt
```

Commit the reviewed snapshot alongside route changes before consuming a newly added
server endpoint. The first snapshot line records the exact backend `origin/main` head.
The generator refuses a non-main or dirty backend source tree. GitHub CI deliberately
uses this checked-in snapshot, not cross-repository credentials or a moving network
target. Refresh after backend route changes; this guard does not promise continuous
freshness between refreshes.

## Extraction and normalization

- **Phone:** parse production `src` TypeScript/TSX/JavaScript using the existing
  TypeScript dev dependency. Include imports of the shared `services/api` client
  (including same-directory/renamed imports), its local aliases and axios-created
  clients, request-config calls, and direct backend `fetch`. Scan all source modules,
  not just screens or currently enabled features.
- **Expressions:** support literals, generic/multiline calls, template strings,
  local/imported constants and functions, concatenation, conditional branches,
  literal union parameters and `encodeURIComponent`. Resolve every branch; do not
  interpret comments as callers or execute source. Unknown full segments are `:id`;
  unknown partial segments and whole unknown URLs fail instead of being omitted.
- **Server:** follow `AppModule`'s Nest module imports (including `forwardRef`) to
  registered controllers, excluding dormant source-only controllers. Combine HTTP
  decorators, controller paths/arrays, global `api` prefix and method-specific
  prefix exclusions. Reject unsupported dynamic modules, router mounting and
  versioning rather than generating an apparently complete snapshot.
- **Comparison:** preserve `api` and `v1`, ignore query/fragment details and trailing
  slashes, and normalize parameter names. A server parameter can match a literal
  phone segment, but a dynamic phone segment cannot be proven by one static route.
  Both method and path must match; extra server routes do not matter.
- **Non-server transfers:** the three existing local-byte `fetch` readers are
  file/expression scoped in `mobile.js`. The community voice signed Supabase PUT
  is also file/expression scoped. Injectable health-ingest transport is verified
  against its single delegated route. New unclassified `fetch`/raw axios,
  detached/destructured methods and computed method calls fail closed. Native
  Expo byte upload calls are storage transfers, not Nest routes.

This is deliberately a bounded static evaluator, not a general TypeScript interpreter.
When a new caller shape fails extraction, add focused fixtures and explicit support;
do not broaden an exclusion or replace it with a regular-expression skip.

## Known gaps

`allowlist.tsv` is tab separated: method, canonical path, exact caller file, removal PR
URL, reason. Each row must name a real follow-up PR, except the exact operator-owned
`ROUTE-GAP-1` token authorized by agent 180 on 2026-10-28 11:2x PDT. That token is
only valid with a non-empty `unreachable on main: ...` reason, independently checked
at this PR's head; it is a queued dead-caller cleanup, not an empty placeholder PR.
No other queue token is accepted. No wildcard paths, caller globs,
silent baselines or permanently ignored directories are permitted. The check prints
every exception, and fails when an entry no longer corresponds to a missing caller,
so the removal PR must delete its allowlist rows too. The eight community exceptions
belong to mobile PR 868. The 14 ROUTE-GAP-1 exceptions are unused helpers, screens
without navigation entries, or Team Mode callers hidden for launch. Any newly live
caller must not use the dead-caller exception without resolving the route.

The guard covers route registration only. Guards, rollout switches, payload schemas,
tenant scope, runtime middleware and response compatibility still need their own tests.
No user-facing wording, UI, backend route or runtime behavior changes here.
