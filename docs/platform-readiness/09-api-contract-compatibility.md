# 09 — API contract compatibility

> Pre-build brief. Defines how mobile stays compatible with backend changes (PRs #117, #118, #119) without forcing every user to upgrade the app on every backend deploy.

## WHY

Today `src/services/api.ts` is the single HTTP entry point. Backend changes ride that pipe. The repo does **not** have:

- A version contract between client and server (e.g. `Accept: application/vnd.tgp.v1+json` or an `X-App-Version` header → backend gates new behaviour on it).
- A "capability discovery" mechanism — the client cannot ask "does this backend support team-mode role data?" without trying and catching.
- A documented degradation policy when the backend returns a shape the client doesn't recognise (extra fields, missing optional fields, new enum values).

The expansion features depend on backend draft PRs:

- **#117 — AI Program Builder** — affects the LLM-using surfaces (#92 items 10, 11, 18). Mobile will call new endpoints; mobile must degrade gracefully when the deployed backend is older than the build.
- **#118 — Team Mode** — adds `roles[]`, `activeOrgId` (see [brief 04](./04-role-based-navigation-architecture.md)). Mobile must keep working when the response lacks those fields.
- **#119** — third backend pre-work PR; same compatibility concerns apply.

Without a written compatibility policy, a backend revert or a slow App Store rollout will produce 500s or blank screens.

## WHEN

Land this brief before the first mobile call to a #117 / #118 / #119 endpoint. There is no urgency until then; once a backend pre-work PR begins implementation, the mobile counterpart should consume only via this contract.

## WHERE

When implemented:

- `src/services/api.ts` — extended with version + capability headers in the request interceptor.
- `src/services/capabilities.ts` (new) — fetches and caches `/v1/capabilities` (or equivalent), exposes `useCapability('team-mode')`.
- `src/types/api/` (new sub-directory) — Zod (or io-ts) schemas for response validation, replacing implicit `any` parsing.
- `docs/API_CONTRACT.md` (new) — the policy.

## WHO

- **Mobile lead + backend lead**: jointly own `docs/API_CONTRACT.md`. Any change to the version header / capability shape goes through both.
- **Engineer**: when adding a new endpoint call, declares the schema in `src/types/api/` and the capability flag (if applicable).

## WHAT

Three policy items + one technical contract.

### Policy

1. **Forward compatibility (older client, newer backend)**: clients **must** ignore unknown response fields, **must** treat unknown enum values as a generic fallback (e.g. `'unknown'`), **must** continue to function for previously-supported features.
2. **Backward compatibility (newer client, older backend)**: clients **must** check capabilities before using a new endpoint. Calling an unsupported endpoint must surface a recoverable UI ("This requires the latest backend deploy") not a crash.
3. **Schema evolution**: backend may add fields freely. Removing or renaming a field is a breaking change requiring a coordinated release. Numeric enum values are forbidden; use string enums.

### Technical contract

Two headers on every request from `api.ts`:

- `X-App-Version: <expo.version>+<buildNumber|versionCode>` — so backend logs know exactly which client is calling.
- `X-App-Channel: development | preview | production` — so backend can route to staging vs prod data.

One endpoint, called once per app launch and cached for the session:

- `GET /v1/capabilities` → returns `{ capabilities: ['team-mode', 'ai-recap', ...], version: '1.4.2' }`.
- `useCapability('team-mode')` returns boolean + the response above.

Response validation through Zod (preferred — already small, tree-shakable):

```ts
// src/types/api/coach.ts
const CoachClientsResponse = z.object({
  clients: z.array(z.object({
    id: z.string(),
    name: z.string(),
    roles: z.array(z.enum(['student'])).optional(), // optional during transition
    // ...
  })),
});
```

A schema parse error logs a Sentry breadcrumb and degrades to a generic error state — does not crash.

## HOW

1. Add the two headers in `api.ts`'s request interceptor. Read from `expo-constants` for the version pieces.
2. Add `src/services/capabilities.ts` + a single React Query hook + a small `useCapability(name)`.
3. Add Zod (small dependency, well-supported) and the first schema for the most-touched response (proposed: `GET /coach/clients`).
4. Write `docs/API_CONTRACT.md` with the policy + schema-evolution rules + examples for each forward / backward case.
5. Add a small integration: when a feature depends on a capability, the feature check is `if (!useCapability('feature-name')) return <ErrorState message="Update backend …" />` — do not let it call and 404.

## Expo / EAS considerations

- `expo-application` is in `package.json` — read `Application.nativeApplicationVersion` and `Application.nativeBuildVersion` for the headers, not from `expo-constants` (which lags on store builds).
- Zod adds ~12 KB. Acceptable; its tree-shaking on RN is good.
- No native module addition.
- The `/v1/capabilities` call must not block first-render. Wrap in React Query with `staleTime: Infinity` for the session and let the UI render while it loads.

## Acceptance criteria

- Every request from `api.ts` carries `X-App-Version` and `X-App-Channel`.
- `GET /v1/capabilities` is called once per session, cached, exposed via `useCapability`.
- One canonical response (proposed `GET /coach/clients`) is Zod-validated; an unexpected field does not throw, an unexpected enum value falls back to `'unknown'`.
- `docs/API_CONTRACT.md` exists with the three policy items + the schema-evolution rules.
- When a capability is missing, the UI shows a recoverable error state, not a crash.

## Rollout strategy

- **Phase 1**: add headers (no behavioural change). Backend logs improve.
- **Phase 2**: add `/v1/capabilities` consumption + `useCapability`. Wired but no feature consumes it yet.
- **Phase 3**: add Zod for one response. Validate that schema parse errors degrade, not crash.
- **Phase 4**: each new backend-dependent feature uses `useCapability` for gating.
- Rollback: each phase reverts independently.

## Tests

- Unit (`api.test.ts`): headers are present on every request.
- Unit (`capabilities.test.ts`): `useCapability` returns false until the capabilities response loads, then true; remembers the result for the session.
- Unit (`coachSchema.test.ts`): unknown field is allowed; unknown enum becomes `'unknown'`; missing required field surfaces a parse error.
- Manual: deploy a stale backend (without `/v1/capabilities`) and confirm the app still loads — `useCapability` returns false, gated features show the recoverable state.

## Risks

- **`/v1/capabilities` doesn't exist on backend yet**: handled by treating "missing endpoint" as "no capabilities". Mobile is forward-compatible from day one.
- **Zod adoption gradient**: schemas added one endpoint at a time, not big-bang. Tracked in a checklist in `docs/API_CONTRACT.md`.
- **Capability flag ↔ feature flag confusion**: capability = "backend supports", feature flag = "user is rolled into". Two layers, both required for a new feature path. Documented.
- **Header values too long**: `X-App-Version` is bounded; `X-App-Channel` is one of three values. Safe.

## Dependencies

- Backend PR **#117** (AI Program Builder) — provides `ai-recap`, `ai-program-builder` capabilities.
- Backend PR **#118** (Team Mode) — provides `team-mode` capability and the `roles[]` field.
- Backend PR **#119** — provides whatever third capability that PR introduces; this brief stays compatible by virtue of policy item 1.
- Cross-link with [`02-feature-flag-consumption.md`](./02-feature-flag-consumption.md) and [`04-role-based-navigation-architecture.md`](./04-role-based-navigation-architecture.md).

## Operator handoff

- **Owning surface(s)**: `src/services/api.ts`, `src/services/capabilities.ts`, `src/types/api/`, `docs/API_CONTRACT.md`.
- **Out-of-band steps**: backend implements `GET /v1/capabilities` (the brief here is mobile-side only). Until then, mobile treats every capability as absent, which is the safe default.
- **Done means**: mobile can be deployed independently of backend without 5xx storms; new backend features are gated on a capability the client checks before calling.
