# 50 AI-Coding Failures → TGP Rule Coverage Matrix

Rules referenced use the post-PR numbering (Rules 1–33).

| # | Failure | Severity | Rules that prevent it | Coverage |
|---|---------|----------|----------------------|----------|
| 1 | Hardcoded Secrets & API Keys | P0 | R14 (latest plumbing/CI), R5 (avoid 50 failures) | COVERED |
| 2 | Missing Row-Level Security (RLS) | P0 | R22 (RBAC server-authoritative), R5 | COVERED |
| 3 | SQL Injection via String Concatenation | P0 | R5 (avoid 50 failures), R29 (schema-validate across boundary) | COVERED |
| 4 | XSS via Unescaped Output | P0 | R30 (output sanitisation, dangerouslySetInnerHTML banned), R17 (scrub outbound error strings), R5 | COVERED |
| 5 | Broken Object-Level Authorization (IDOR) | P0 | R22 (RBAC server-authoritative), R15 (user-scoped keys) | COVERED |
| 6 | Missing Rate Limiting on Auth Endpoints | P0 | R31 (rate limiting on every auth/paid/webhook endpoint), R5 | COVERED |
| 7 | Broken Authentication / Weak JWT Config | P0 | R5, R22 (RBAC server-authoritative) | PARTIAL |
| 8 | Missing Input Validation at API Boundaries | P0 | R29 (contract drift fails build), R25 (audit every caller), R5 | COVERED |
| 9 | Privilege Escalation Paths | P0 | R22 (RBAC server-authoritative, client-mirrored only) | COVERED |
| 10 | Unverified NPM Dependencies / Supply Chain | P0 | R14 (always build with latest plumbing, npm audit in CI) | COVERED |
| 11 | Missing / Wildcard CORS Configuration | P1 | R32 (wildcard CORS banned, explicit allowlist required), R5 | COVERED |
| 12 | Secrets Exposure in Error Messages | P1 | R9 (no raw errors to users), R17 (scrub outbound error strings) | COVERED |
| 13 | Missing HTTPS Enforcement | P1 | R5 (avoid 50 failures) | PARTIAL |
| 14 | Return of Monoliths (tight coupling) | P1 | R5, R6 (fix issues at root) | PARTIAL |
| 15 | Over-Specification / Non-Reusable Code | P2 | R5, R24 (dead code dies in same PR) | PARTIAL |
| 16 | Avoidance of Refactors / Perpetual Debt | P2 | R6 (never kick the can), R24 (dead code dies same PR) | COVERED |
| 17 | Fake Test Coverage | P1 | R26 (tests prove behaviour, not strings), R2 (audit until clean) | COVERED |
| 18 | "Worked on My Machine" / Environment Parity | P1 | R14 (latest plumbing, CI parity), R29 (contract drift fails build) | COVERED |
| 19 | Missing API Versioning | P2 | R25 (audit every caller before changing contract), R29 | COVERED |
| 20 | Circular Dependencies | P2 | R14 (latest tooling + lint enforcement), R5 | PARTIAL |
| 21 | N+1 Query Problem | P0 | R33 (no DB query inside a loop, batch/join required), R1 (decacorn quality), R7 (enterprise grade) | COVERED |
| 22 | Missing DB Indexes on Queried Columns | P0 | R33 (every FK and WHERE/ORDER BY column on high-volume tables must be indexed), R5 | COVERED |
| 23 | No Pagination on List Endpoints | P1 | R5, R25 (audit callers / contract review) | PARTIAL |
| 24 | Synchronous Operations Blocking Event Loop | P0 | R5, R1 (decacorn quality) | PARTIAL |
| 25 | No Caching Strategy | P2 | R5, R1 | PARTIAL |
| 26 | Unoptimized Image / Media Handling | P1 | R5, R14 (latest SDKs) | PARTIAL |
| 27 | Polling Instead of WebSockets/SSE | P2 | R5, R1 | PARTIAL |
| 28 | Race Conditions in Async Flows | P0 | R19 (every mutation idempotent with UUID key), R20 (one source of truth) | COVERED |
| 29 | Missing Idempotency on Payment Endpoints | P0 | R19 (every mutation idempotent, UUID idempotency keys) | COVERED |
| 30 | Optimistic UI Updates Without Rollback | P1 | R18 (no fabricated success), R20 (one source of truth) | COVERED |
| 31 | Stale Closures Capturing Outdated State | P1 | R20 (one source of truth), R23 (hooks unconditional) | COVERED |
| 32 | No Abort/Cleanup on Component Unmount | P2 | R23 (hooks unconditional — correct lifecycle), R5 | PARTIAL |
| 33 | No Error Boundaries | P1 | R9 (structured errors), R5 | PARTIAL |
| 34 | No Logging / Observability | P1 | R5, R2 (audit until clean) | PARTIAL |
| 35 | Missing API Timeout Handling | P0 | R5, R1 | PARTIAL |
| 36 | Silent Failures / Swallowed Errors | P0 | R9 (no raw errors — implies errors must surface), R17 (scrub + surface), R18 (no fabricated success) | COVERED |
| 37 | No Health Check Endpoints | P2 | R5, R14 (CI/CD plumbing) | PARTIAL |
| 38 | Excessive / Wrong Comments | P3 | R5 | PARTIAL |
| 39 | By-The-Book Fixation / Over-Engineering | P2 | R5, R10 (most thorough — not most complex) | PARTIAL |
| 40 | Bugs Déjà-Vu / Repeated Bugs Across Copies | P1 | R5, R24 (dead code dies same PR), R6 (fix at root) | COVERED |
| 41 | Vanilla Style / Reimplementing Library Code | P2 | R14 (always use latest libraries), R5 | COVERED |
| 42 | Phantom Bugs / Over-Engineering Edge Cases | P2 | R5, R10 | PARTIAL |
| 43 | Dead Code and Orphaned Modules | P2 | R24 (dead code dies in same PR that orphans it) | COVERED |
| 44 | No DB Transactions for Multi-Step Operations | P0 | R5, R19 (idempotent mutations), R20 (one source of truth) | COVERED |
| 45 | Missing Soft Deletes | P1 | R11 (never delete features/shrink abilities), R5 | COVERED |
| 46 | Missing Data Validation at DB Layer | P1 | R29 (contract drift fails build), R8 (input validation), R5 | COVERED |
| 47 | No Backup / Data Recovery Strategy | P0 | R5, R7 (99.99% uptime) | PARTIAL |
| 48 | No CI/CD Pipeline | P1 | R14 (CI/CD is part of plumbing), R2 (audit until clean) | COVERED |
| 49 | Dev Code Baked into Production Builds | P1 | R14 (build profiles), R5 | PARTIAL |
| 50 | No Graceful Degradation for External Service Failures | P1 | R9 (structured errors), R5, R1 | PARTIAL |

---

## Uncovered failures (need new rules or process)

The following failures are mapped as PARTIAL because no existing rule directly mandates a concrete practice for them. They are addressed only indirectly via the meta-rules (R1, R5, R7). A dedicated rule or process checkpoint is recommended for each:

| # | Failure | Gap | Recommendation |
|---|---------|-----|----------------|
| 7 | Broken Authentication / Weak JWT Config | Covered by RBAC rule but not JWT specifics | Add to Rule 22's explanation: JWT secrets must be ≥64 chars from env; access tokens expire ≤15 min; refresh tokens rotate on use. |
| 13 | Missing HTTPS Enforcement | Infrastructure concern, no rule | Covered by infra checklist; add to PR template: "HTTPS enforced at infrastructure level?" |
| 47 | No Backup / Data Recovery | Infrastructure concern | Add to launch checklist: Supabase PITR enabled, backup verified in a test restore quarterly. |

---

## Most-covering rules (which rules pull the most weight)

Ranked by number of failures they fully or partially address:

| Rank | Rule | Failures addressed | Count |
|------|------|--------------------|-------|
| 1 | **R5** — Avoid the 50 documented failures | 1–50 (meta-rule — covers all by reference) | 50 |
| 2 | **R14** — Always latest plumbing / CI | 1, 10, 18, 20, 26, 37, 41, 48, 49 | 9 |
| 3 | **R1 / R7** — Decacorn quality / 99.99% uptime | 21, 22, 23, 24, 25, 27, 35, 47 | 8 |
| 4 | **R33** — No DB query in a loop, batch/join required | 21, 22 | 2 |
| 5 | **R22** — RBAC server-authoritative | 2, 5, 7, 9 | 4 |
| 6 | **R19** — Every mutation idempotent | 28, 29, 44 | 3 |
| 7 | **R20** — One source of truth | 28, 30, 31, 44 | 4 |
| 8 | **R29** — Backend contract drift fails build | 8, 18, 19, 46 | 4 |
| 9 | **R9** — No raw errors to users | 12, 33, 36, 50 | 4 |
| 10 | **R24** — Dead code dies same PR | 16, 40, 43 | 3 |
| 11 | **R25** — Audit every caller before contract change | 8, 19, 23 | 3 |
| 12 | **R17** — Scrub outbound error strings | 4, 12, 36 | 3 |
| 13 | **R30** — Output sanitisation / dangerouslySetInnerHTML banned | 4 | 1 |
| 14 | **R31** — Rate limiting on auth/paid/webhook endpoints | 6 | 1 |
| 15 | **R32** — Explicit CORS allowlist, wildcard banned | 11 | 1 |
| 16 | **R18** — No fabricated success | 30, 36 | 2 |
| 17 | **R23** — Hooks unconditional | 31, 32 | 2 |
| 18 | **R26** — Tests prove behaviour, not strings | 17 | 1 |
| 19 | **R6** — Never kick the can | 16, 40 | 2 |

---

## Coverage summary

- **Fully COVERED: 26 / 50**
- **PARTIAL: 24 / 50**
- **UNCOVERED (no rule at all): 0 / 50**

All 50 failures are addressed at minimum by the meta-rule R5. The 24 PARTIAL failures are ones where no specific standing rule mandates the concrete practice beyond the meta-rules. Rules 30–33 (added in this PR) converted 4 previously PARTIAL failures — XSS/output sanitisation (4), rate limiting (6), CORS wildcard (11), and N+1 queries (21/22) — to COVERED.
