The 50 Failures of AI-Generated Code at Enterprise Scale

An Audit Reference Document for Production Codebases

How to Use This Document

This document catalogues the 50 most documented, research-verified
failure patterns in AI-generated code at production scale. Each failure
includes a severity rating, prevalence rate where known, what to look
for, and what the fix looks like. Feed this to your audit subagent as a
checklist to scan, flag, and prioritize.

Severity tiers:

- 🔴 CRITICAL — Data loss, financial exposure, or security breach risk

- 🟠 HIGH — Production failures, user data exposure, or significant
  performance degradation

- 🟡 MEDIUM — Technical debt, scalability limits, or maintainability
  collapse

- 🟢 LOW — Code quality, review burden, or future-proofing concerns

CATEGORY 1: Security Vulnerabilities

#1 — Hardcoded Secrets and API Keys 🔴

Prevalence: Found in majority of scanned vibe-coded
repositories[^(1][)2]

AI tools trained on public code reproduce the pattern of putting secrets
directly in source files. API keys, JWT secrets, Stripe keys, Supabase
service role keys, and database connection strings get committed to git
history — where they are permanent even after deletion.

What to flag: Any string matching key/secret/token/password patterns
outside of .env files. Check git history, not just current state.

Fix: Environment variables only. .env in .gitignore. Rotate any key that
has ever appeared in a commit.

#2 — Missing Row-Level Security (RLS) on Database Tables 🔴

Prevalence: 10.3% of scanned Lovable-built apps had critical RLS gaps
exposing user data to the public internet[^3]

AI generates Supabase tables without RLS policies, meaning any
authenticated (or unauthenticated) user can read or write any row in the
database via the client SDK.

What to flag: Any Supabase table without ALTER TABLE ... ENABLE ROW
LEVEL SECURITY and corresponding policies. Any table where the client
SDK can directly query without server-side filtering.

Fix: Enable RLS on every table. Write explicit policies for SELECT,
INSERT, UPDATE, DELETE per role.

#3 — SQL Injection via String Concatenation 🔴

Prevalence: OWASP Top 10 #1 in vibe-coded applications[^(4][)5]

AI reproduces the common tutorial pattern of building SQL queries with
string interpolation: "SELECT * FROM users WHERE id = " + userId. A
malicious input like 1 OR 1=1 reads the entire table.

What to flag: Any raw SQL query construction using string concatenation
or template literals. Any ORM .raw() call with user-supplied values
interpolated.

Fix: Parameterized queries exclusively. Use the ORM's built-in query
builder, never raw string SQL with dynamic values.

#4 — Cross-Site Scripting (XSS) via Unescaped Output 🔴

Prevalence: 86% failure rate in AI-generated code on XSS defenses
specifically[^(6][)7]

AI generates frontend code that renders user-supplied strings directly
into the DOM without sanitization, enabling script injection.

What to flag: Any use of dangerouslySetInnerHTML in React/React Native
web views. Any direct DOM insertion of user content. Any rendered string
that originated from user input or external API without sanitization.

Fix: Never use dangerouslySetInnerHTML with unsanitized input. Use
DOMPurify for any HTML that must be rendered.

#5 — Broken Object-Level Authorization (IDOR) 🔴

Prevalence: Consistently in OWASP Top 10 for vibe-coded apps[^(1][)4]

AI generates API endpoints that accept resource IDs as parameters but do
not verify the requesting user owns or has access to that resource. A
user can read or modify another user's data by changing the ID in the
request.

What to flag: Any endpoint that takes a resource ID (:clientId,
:workoutId, :paymentId) and queries the database without first verifying
the authenticated user's ownership of that resource.

Fix: Every data fetch after authentication must include a WHERE clause
joining to the authenticated user's ID. Never trust client-supplied IDs
alone.

#6 — Missing Rate Limiting on Auth Endpoints 🔴

Prevalence: 100% of scanned external API call implementations lacked
timeout/rate protection[^8]

AI generates login, registration, password reset, and API endpoints with
no rate limiting. Attackers can brute-force credentials indefinitely or
rack up $14,000+ in third-party API costs from unrestricted access.[^9]

What to flag: Auth endpoints (/login, /signup, /reset-password,
/verify-otp) without rate limiting middleware. Any endpoint calling a
paid external API (OpenAI, Stripe, Mux) without request throttling per
user.

Fix: Implement rate limiting middleware (e.g., express-rate-limit,
NestJS ThrottlerModule) on all auth and payment endpoints. Set
conservative limits — 5 attempts per minute on auth.

#7 — Broken Authentication — Weak JWT Configuration 🔴

Prevalence: Common across AI-generated auth implementations[^(2][)1]

AI generates JWT implementations with short or hardcoded secrets, no
token expiry, no refresh token rotation, and no invalidation mechanism.
A leaked token is permanently valid.

What to flag: JWT secrets under 32 characters. JWTs with no exp claim.
No refresh token rotation on use. No mechanism to invalidate tokens on
logout or password change.

Fix: 64+ character random secret from environment. Short access token
expiry (15 min). Refresh token rotation with revocation list.

#8 — Missing Input Validation at API Boundaries 🔴

Prevalence: The #1 anti-pattern in audited AI codebases — "Phantom
Validation"[^10]

AI generates TypeScript interfaces and types that look like validation
but are compile-time only. At runtime, API inputs are completely
unchecked. Malicious or malformed data flows directly into business
logic and database queries.

What to flag: Any API endpoint handler that destructures request body
without runtime schema validation. TypeScript types used as the only
"validation." Missing Zod, Joi, or class-validator schemas on all
incoming data.

Fix: Zod or Valibot schema validation on every request body, query
param, and path param. Derive TypeScript types from schemas, not the
other way around.[^10]

#9 — Privilege Escalation Paths 🔴

Prevalence: 322% increase in privilege escalation paths in AI-generated
enterprise code[^6]

AI generates role-based access control that checks roles on the frontend
or in middleware but not at the data layer. A user who manipulates their
JWT role claim or bypasses middleware can access admin functionality.

What to flag: Role checks performed only in frontend guards or route
middleware, without server-side enforcement at the data access layer.
Any admin endpoint that trusts a client-supplied role.

Fix: Role verification must happen at the database query level and in
the business logic layer, not just at the route guard level.

#10 — Unverified NPM Dependencies with Known Vulnerabilities 🔴

Prevalence: Active supply chain attacks compromising hundreds of
packages simultaneously[^(11][)12]

AI auto-installs packages without auditing them. As of May 2026, a
supply chain attack compromised 84 TanStack package versions and 416+
total NPM packages including Mistral AI packages. AI agents that
auto-install dependencies have zero verification window.[^(13][)11]

What to flag: Any package installed without running npm audit.
Dependencies with 0.x versions (unstable). Packages with no recent
maintenance activity. Any auto-installed dependency added by an AI agent
without human review.

Fix: npm audit --audit-level=high in CI/CD pipeline. Lockfile committed
and verified. socket.dev or Snyk for supply chain monitoring.

#11 — Missing CORS Configuration 🟠

AI generates APIs with wildcard CORS (Access-Control-Allow-Origin: *) or
no CORS configuration at all, allowing any origin to make authenticated
requests to the API.[^(14][)2]

What to flag: Wildcard CORS on any endpoint that handles auth tokens or
user data. Missing CORS headers entirely.

Fix: Explicit allowlist of permitted origins. Credentials not allowed
with wildcard origin.

#12 — Secrets Exposure in Error Messages 🟠

Prevalence: Common in AI-generated error handlers[^1]

AI generates verbose error handling that includes stack traces, database
query text, internal file paths, and environment variable names in API
error responses — visible to any client.

What to flag: Error handlers that pass raw exceptions or err.message
directly to API responses in production. Stack traces in HTTP responses.

Fix: Generic error messages to clients. Full error details logged
server-side only. Separate error handling for development vs. production
environments.

#13 — Missing HTTPS Enforcement 🟠

AI generates server configurations that accept HTTP connections without
redirecting to HTTPS, allowing credentials and session tokens to be
transmitted in plaintext.[^2]

What to flag: Any HTTP endpoint accepting authentication tokens. Missing
HSTS headers. Mixed content on any page.

Fix: Force HTTPS at the infrastructure level. HSTS header with long
max-age. Redirect all HTTP to HTTPS.

CATEGORY 2: Architectural Failures

#14 — Return of Monoliths 🟠

Prevalence: 40-50% of AI-generated codebases[^(15][)16]

AI defaults to tightly-coupled monolithic architectures, reversing a
decade of progress toward maintainable service boundaries. Business
logic, data access, and presentation layers are intermixed. A change in
one area breaks unrelated features unpredictably.

What to flag: Business logic in route handlers. Database queries in
frontend components. No clear separation between data access, service,
and presentation layers.

Fix: Explicit layer boundaries. Data access only in repository/service
layer. Route handlers only orchestrate, never implement business logic.

#15 — Over-Specification — Hyper-Specific Non-Reusable Code 🟡

Prevalence: 80-90% of AI-generated code[^(16][)15]

Instead of building reusable components, AI creates hyper-specific
single-use implementations for each prompt. The same logic is
re-implemented with slight variations across the codebase, each carrying
its own bugs.

What to flag: Functions that do exactly one thing for exactly one
screen. Repeated logic blocks that differ by 1-2 variable names. No
shared utilities, helpers, or service abstractions.

Fix: Extract common logic into shared services and utilities. If the
same pattern appears 3+ times, it should be abstracted.

#16 — Avoidance of Refactors 🟡

Prevalence: 80-90% of AI-generated code[^(15][)16]

AI generates code that satisfies the current prompt but never improves
existing architecture. As features accumulate, the codebase grows in
complexity without any structural improvement. Dead code, deprecated
patterns, and outdated approaches remain forever.

What to flag: Functions over 200 lines. Files over 500 lines. Obvious
duplication of logic across files. Commented-out code blocks. Deprecated
API usage alongside current API usage for the same operation.

Fix: Regular architectural review sessions. Explicit prompts to refactor
existing code, not just add new code.

#17 — Fake Test Coverage 🟠

Prevalence: 40-50% of AI-generated repositories; 70% of scanned
vibe-coded projects had no test files at all[^(8][)15]

AI generates tests that call functions and assert they return something
without testing actual business logic correctness. Coverage metrics look
healthy while the tests verify nothing meaningful. Critical paths —
payment processing, auth flows, data mutations — go entirely untested.

What to flag: Tests that only check expect(result).toBeDefined(). Tests
with no assertions on specific values. Zero tests on payment, auth, or
data modification paths. Coverage percentage above 80% but no tests for
critical flows.

Fix: Tests must assert specific values, not just existence. Every
payment flow, auth flow, and data mutation must have integration tests.

#18 — "Worked on My Machine" — Missing Environment Parity 🟠

Prevalence: 60-70% of AI-generated codebases[^(16][)15]

AI lacks awareness of deployment environments. Code passes local tests
but fails in production due to environment-specific assumptions:
hardcoded localhost URLs, missing production environment variables, Node
version differences, or file system path assumptions.

What to flag: Hardcoded localhost URLs. Missing .env.example with all
required variables documented. Code that reads from local filesystem
paths without abstraction. Node or runtime version not specified.

Fix: .env.example with every required variable. No hardcoded
environment-specific values. Docker or equivalent environment parity
between local and production.

#19 — Missing API Versioning 🟡

AI generates APIs with no versioning strategy. When breaking changes are
needed, all clients break simultaneously. Gym admin board, client app,
and coach app all break together on any API change.[^17]

What to flag: API routes with no version prefix (/api/v1/). No
versioning strategy documented. Breaking changes deployed without
backward compatibility.

Fix: Version all public-facing API routes from day one. Maintain
backward compatibility or provide migration windows.

#20 — Circular Dependencies 🟡

AI generates module imports that create circular dependency chains —
Module A imports Module B which imports Module A. These cause subtle
initialization failures, memory leaks, and unpredictable behavior at
startup.[^18]

What to flag: Import chains that loop back to the originating module.
Dependency injection containers with circular references. Build warnings
about circular imports.

Fix: Dependency analysis tool (Madge for Node.js). Refactor to break
circular chains using dependency injection or event-based decoupling.

CATEGORY 3: Performance Failures

#21 — N+1 Query Problem 🔴

Prevalence: The most common database performance anti-pattern in
ORM-based AI code[^(19][)20][^21]

AI generates code that fetches a list of items, then executes a separate
database query for each item's related data. For a coach admin board
listing 50 clients with their latest workouts, this executes 51 queries
instead of 1. Query count grows linearly with data — 1,000 clients =
1,001 queries per page load.[^20]

What to flag: Any loop that contains a database query. ORM calls inside
forEach, map, or for...of loops. Endpoints that slow down significantly
as data volume grows.

Fix: Eager loading with JOIN queries or include/select in
Prisma/TypeORM. Batch fetching with IN clauses. DataLoader pattern for
GraphQL.

#22 — Missing Database Indexes on Frequently Queried Columns 🔴

Prevalence: Systematically absent in AI-generated database
schemas[^(22][)23][^24]

AI generates working database schemas without considering query
performance at scale. Columns used in WHERE clauses, JOIN conditions,
ORDER BY, and GROUP BY have no indexes. Every query performs a full
table scan — invisible at 100 rows, catastrophic at 100,000.[^23]

What to flag: Any column used in .where(), .eq(), .filter(), or JOIN
conditions without a corresponding index. Foreign key columns without
indexes. Columns used in ORDER BY without indexes.

Fix: Index every foreign key. Index every column used in WHERE clauses
on high-volume tables. Use EXPLAIN ANALYZE to verify query plans.

#23 — No Pagination on List Endpoints 🟠

AI generates endpoints that return all records in a table without
pagination. A coach with 200 clients, each with 12 months of workout
history, means a single API call attempts to load millions of
rows.[^(24][)17]

What to flag: Any list endpoint with no limit, offset, or cursor
parameters. Frontend components that render arrays from API without
virtualization.

Fix: Cursor-based or offset pagination on every list endpoint.
Server-enforced maximum page size (never return more than N records per
call).

#24 — Synchronous Operations Blocking the Event Loop 🔴

AI generates blocking synchronous code — file I/O, CPU-intensive
calculations, or synchronous external API calls — in Node.js request
handlers. A single slow request blocks all other requests.[^(25][)18]

What to flag: Synchronous file system calls (fs.readFileSync) in request
handlers. CPU-intensive operations (parsing, encoding) in the main
thread. Any await call inside a forEach loop (which runs sequentially,
not in parallel).

Fix: Use Promise.all() for parallel async operations. Move CPU-intensive
work to worker threads. Use streaming for large file operations.

#25 — No Caching Strategy 🟡

AI generates fresh database queries for every request, including data
that rarely changes — coach profiles, gym configuration, workout
templates. Without caching, every request hits the database
unnecessarily.[^25]

What to flag: High-frequency endpoints querying data that changes
rarely. No Redis, in-memory cache, or HTTP cache headers on any
endpoint. Identical database queries repeated across multiple requests
within milliseconds.

Fix: Cache stable data (gym config, coach profiles, workout templates)
with appropriate TTL. Cache at the HTTP layer with Cache-Control headers
for public data.

#26 — Unoptimized Image and Media Handling 🟠

AI generates code that uploads and serves original-size images without
compression or format optimization. A client uploading a 12MB iPhone
photo to their profile bloats storage and makes every load of that data
expensive.[^8]

What to flag: Image uploads stored without compression or resize.
Original file formats served without WebP conversion. No CDN or edge
caching for media assets.

Fix: Resize and compress images on upload (Sharp for Node.js). Serve via
CDN. Use WebP with fallbacks.

#27 — Polling Instead of WebSockets or Server-Sent Events 🟡

AI generates real-time-like features using polling — calling an API
every few seconds to check for updates. For a coach admin board that
needs to show real-time client check-ins, this creates constant
unnecessary load.[^18]

What to flag: setInterval calls that hit API endpoints. Repeated
identical queries at fixed intervals. "Real-time" features with visible
delays.

Fix: WebSockets or Server-Sent Events for real-time data. Supabase
Realtime for database change subscriptions.

CATEGORY 4: Concurrency and State Failures

#28 — Race Conditions in Async Flows 🔴

Prevalence: AI fundamentally misunderstands concurrent
execution[^(26][)27][^25]

AI generates code that assumes linear, sequential execution. In real
production systems, multiple users make simultaneous requests, and
responses resolve out of order. A coach updating a client's plan while
the client is simultaneously completing a workout can produce corrupted
state — no error is thrown, the system silently loses data.[^25]

What to flag: Any state mutation that involves read-modify-write
patterns without locking or optimistic concurrency. Payment operations
without idempotency keys. Any counter or aggregate that multiple
requests can update simultaneously.

Fix: Optimistic locking with version fields. Database-level transactions
for multi-step operations. Idempotency keys on all payment operations.

#29 — Missing Idempotency on Payment Endpoints 🔴

Prevalence: Critical gap in payment-processing AI code[^25]

AI generates payment processing without idempotency keys. Network
failures cause clients to retry requests, resulting in duplicate
charges. A client gets charged twice for the same coaching session with
no error visible to either party.

What to flag: Any Stripe charge, subscription creation, or payout
initiation without an idempotency key. Payment endpoints that can be
called multiple times for the same transaction.

Fix: Generate and store idempotency keys on the client before initiating
payment. Pass to Stripe's idempotencyKey option. Store payment intent
IDs and check before creating new ones.

#30 — Optimistic UI Updates Without Rollback 🟠

Prevalence: Standard React pattern AI misimplements[^25]

AI generates optimistic updates — immediately updating the UI before the
server confirms — without implementing rollback on failure. When the
server request fails, the UI shows incorrect data that is never
corrected until the next full reload.

What to flag: State updates that precede await API calls with no
.catch() or error handling that restores previous state. Zustand or
React state mutations before API confirmation.

Fix: Every optimistic update must have a corresponding rollback in the
error handler. TanStack Query's onMutate/onError/onSettled pattern
handles this correctly.

#31 — Stale Closures Capturing Outdated State 🟠

Prevalence: Common React/React Native anti-pattern in AI code[^25]

AI generates useEffect and useCallback hooks with empty or incorrect
dependency arrays, causing them to capture stale values from the initial
render. Timers, intervals, and async operations use outdated state —
behavior changes based on render timing rather than logic.

What to flag: useEffect(() => {...}, []) that references state variables
inside the callback. setInterval inside useEffect without proper
cleanup. useCallback with empty dependencies that uses changing values.

Fix: Correct dependency arrays. useRef for values that shouldn't trigger
re-renders but need to be current. React's eslint-plugin-react-hooks
catches these automatically.

#32 — No Abort/Cleanup on Component Unmount 🟡

AI generates data fetching and subscriptions that continue running after
a component unmounts, causing memory leaks and "Can't perform state
update on unmounted component" errors in React Native.[^25]

What to flag: useEffect data fetches without AbortController cleanup.
Supabase subscriptions without unsubscribe on unmount. Event listeners
without removal on cleanup.

Fix: Return cleanup function from every useEffect that starts async
operations or subscriptions. AbortController for fetch calls. Supabase
subscription .unsubscribe() in cleanup.

CATEGORY 5: Error Handling and Observability Failures

#33 — No Error Boundaries 🟠

Prevalence: 82% of scanned vibe-coded projects[^8]

AI generates React/React Native components without error boundaries. A
single uncaught error in any component crashes the entire app, showing a
blank white screen to the user with no recovery path.

What to flag: Zero ErrorBoundary components in the component tree. No
try/catch around critical rendering logic. No fallback UI for failed
data loads.

Fix: Wrap major sections in ErrorBoundary components with graceful
fallback UI. Use Sentry's React error boundary integration for automatic
capture.

#34 — No Logging or Observability 🟠

Prevalence: 76% of scanned vibe-coded projects[^8]

AI generates console.log statements for debugging and nothing else. In
production, these are invisible. When something breaks, there is no
record of what happened, what the request looked like, or what error was
thrown.

What to flag: Only console.log for error reporting. No structured
logging with timestamps, user IDs, and request context. No log
aggregation service. No alerting on error spikes.

Fix: Structured logging library (Pino, Winston). Sentry for error
tracking (you have this — verify it's capturing breadcrumbs correctly).
Log every payment event, auth event, and API error with user context.

#35 — Missing API Timeout Handling 🔴

Prevalence: 100% of scanned external API implementations[^8]

AI generates external API calls with no timeout configuration. If
Stripe, Mux, or any external service hangs, the request waits
indefinitely, blocking server resources until the connection eventually
resets — typically after 2 minutes of frozen user experience.

What to flag: Any axios or fetch call to external services without a
timeout option. No timeout configured on Stripe SDK initialization. Mux
upload calls with no timeout.

Fix: Set explicit timeouts on all external calls. Axios: { timeout:
10000 }. Fail fast and show the user an actionable error rather than
hanging indefinitely.

#36 — Silent Failures — Swallowed Errors 🔴

Prevalence: Common throughout AI-generated try/catch blocks[^28]

AI generates try/catch blocks that catch errors but do nothing with them
— no logging, no user notification, no retry. The operation silently
fails while the user assumes it succeeded. A client's check-in never
saves; a payment confirmation never fires.

What to flag: catch(e) {} empty catch blocks. catch(e) { console.log(e)
} with no further action. Async operations with no .catch() handler.

Fix: Every caught error must be logged with context and either surfaced
to the user or retried with exponential backoff.

#37 — No Health Check Endpoints 🟡

AI generates backend servers without health check endpoints. Load
balancers, container orchestration, and uptime monitors cannot verify
whether the service is running or degraded without them.[^17]

What to flag: No /health or /ping endpoint. No database connectivity
check in the health endpoint. Fly.io deployment without health check
configuration in fly.toml.

Fix: /health endpoint that verifies database connectivity, external
service reachability, and returns a 200 with a JSON status summary.

CATEGORY 6: Code Quality Anti-Patterns

#38 — Comments Everywhere 🟢

Prevalence: 90-100% of AI-generated code — the most universal
anti-pattern[^(15][)16]

AI generates excessive inline comments explaining every line of code —
"// increment the counter", "// return the result". These comments add
cognitive load, make code harder to scan, and become incorrect when code
changes without comment updates.

What to flag: Comments that describe what the code does rather than why.
Comment-to-code ratio exceeding 1:3. Outdated comments that no longer
match the code.

Fix: Delete explanatory comments. Keep only comments that explain why —
business context, non-obvious decisions, known limitations.

#39 — By-The-Book Fixation — Textbook Patterns Over Appropriate
Solutions 🟡

Prevalence: 80-90% of AI-generated code[^(16][)15]

AI rigidly follows textbook patterns (Repository Pattern, Factory
Pattern, Decorator Pattern) even when simpler solutions are more
appropriate. A 3-line database call gets wrapped in interfaces, abstract
classes, and factory functions that serve no practical purpose at
current scale.

What to flag: Design patterns applied to simple operations that don't
benefit from abstraction. Interface/implementation pairs where a single
class would suffice. Abstract factories for objects that only exist in
one form.

Fix: YAGNI (You Aren't Gonna Need It). Apply patterns only when the
problem they solve is actually present.

#40 — Bugs Déjà-Vu — Identical Bugs Repeated Throughout Codebase 🟠

Prevalence: 70-80% of AI-generated codebases[^(15][)16]

Because AI generates code in-place rather than reusing shared utilities,
identical logic — date formatting, currency display, validation — is
reimplemented separately for each feature. Each copy carries the same
bugs, and fixing one copy leaves the others broken.

What to flag: The same logic pattern appearing 3+ times in different
files with slight variations. Bug fixes that only address one occurrence
of a repeated pattern. Inconsistent behavior in features that should
behave identically.

Fix: Extract repeated logic into shared utilities on first repetition.
Audit all copies when fixing a bug in any one of them.

#41 — Vanilla Style — Reimplementing What Libraries Already Do 🟡

Prevalence: 40-50% of AI-generated code[^(16][)15]

AI reimplements functionality from scratch that well-tested libraries
already provide — custom date parsing, manual JWT decoding, hand-rolled
encryption, DIY state management. Each custom implementation introduces
new bugs and maintenance burden.

What to flag: Custom date/time manipulation instead of date-fns or
dayjs. Manual JWT parsing instead of library verification. Hand-rolled
debounce/throttle instead of lodash. Custom form validation instead of
Zod.

Fix: Audit custom implementations against available libraries. If a
library exists for the purpose and is battle-tested, use it.

#42 — Phantom Bugs — Over-Engineering for Impossible Edge Cases 🟡

Prevalence: 20-30% of AI-generated code[^(15][)16]

AI generates extensive handling for edge cases that will never occur in
the actual application — 1000-user concurrent write scenarios for a
feature used by 3 coaches, network partition handling for operations
that run in microseconds, integer overflow protection for numbers that
will never exceed 100.

What to flag: Concurrency controls on operations that are inherently
single-user. Retry logic for operations that are synchronous. Error
handling for error conditions the architecture makes impossible.

Fix: Delete over-engineered edge case handling. Add it back when the
actual edge case is observed in production.

#43 — Dead Code and Orphaned Modules 🟡

AI generates experimental implementations, tries multiple approaches,
and leaves the abandoned attempts in place. Dead functions, unused
imports, and entire modules that are never called accumulate and confuse
future understanding of the codebase.[^29]

What to flag: Imported symbols that are never used. Functions defined
but never called. Entire files with no imports from other modules.
Feature flags that are always false.

Fix: ESLint no-unused-vars and no-unreachable. Regular dead code audits.
Delete, don't comment out.

CATEGORY 7: Data Integrity Failures

#44 — No Database Transactions for Multi-Step Operations 🔴

AI generates multi-step database operations without wrapping them in
transactions. If step 3 of a 4-step operation fails, steps 1 and 2 have
already committed — leaving the database in a partially-updated,
inconsistent state.[^(18][)25]

What to flag: Any operation that writes to multiple tables without a
transaction. Payment processing that updates multiple records
sequentially. Coach/client relationship creation that involves multiple
inserts.

Fix: Wrap all multi-table write operations in database transactions.
Supabase: use RPC functions with transaction blocks or Prisma
$transaction().

#45 — Missing Soft Deletes 🟠

AI generates hard DELETE operations that permanently remove records.
When a coach accidentally deletes a client or a gym removes a PT, all
associated history — workouts, check-ins, payment records — is
permanently gone with no recovery path.[^18]

What to flag: DELETE operations on user, client, coach, or workout data.
No deleted_at column on tables containing business-critical data. No
audit trail for destructive operations.

Fix: Soft delete pattern — add deleted_at TIMESTAMP column. Filter out
soft-deleted records in queries. Implement a recovery UI for accidental
deletions.

#46 — Missing Data Validation at the Database Layer 🟠

AI enforces data constraints only in application code, not at the
database level. If a bug bypasses application validation, invalid data
writes directly to the database — negative prices, future birthdates for
historical records, orphaned foreign keys.[^(10][)1]

What to flag: Numeric columns without CHECK constraints. String columns
without length limits. Foreign key relationships without FOREIGN KEY
constraints. No NOT NULL on required fields.

Fix: Database-level constraints mirror application validation. CHECK
constraints on numeric ranges. NOT NULL on required fields. Foreign key
constraints with appropriate CASCADE behavior.

#47 — No Backup or Data Recovery Strategy 🔴

AI never generates backup configuration. A database corruption event,
accidental deletion, or infrastructure failure results in permanent data
loss.[^17]

What to flag: No point-in-time recovery configured on Supabase. No
backup verification procedure. No documented recovery runbook. Single
region deployment with no redundancy.

Fix: Enable Supabase point-in-time recovery. Regular backup verification
(restore to a test environment monthly). Document recovery procedures.

CATEGORY 8: Infrastructure and Deployment Failures

#48 — No CI/CD Pipeline 🟠

Prevalence: 66% of scanned vibe-coded projects[^8]

AI generates code but never sets up automated testing, linting, or
deployment pipelines. Code is deployed manually with no automated checks
— broken code ships undetected.

What to flag: No GitHub Actions, CircleCI, or equivalent pipeline. No
automated test runs before deployment. No linting enforcement before
merge. No staging environment before production.

Fix: GitHub Actions workflow: lint → test → build → deploy to staging →
promote to production. Block merges that fail tests.

#49 — Environment-Specific Code Baked into Production Builds 🟠

AI generates screenshot modes, mock data adapters, and development
utilities that are conditionally disabled in production but still
bundled and shipped — increasing bundle size and potentially leaking
internal implementation details.

What to flag: Mock adapters, fixture data, or demo seeding code that is
toggled by a runtime flag rather than excluded at build time.
Development-only utilities in production bundle. Screenshot/demo modes
that exist in production code.

Fix: Metro bundler config to exclude dev-only modules in production
builds. EAS build profile environment variables to completely prevent
import of non-production modules at bundle time.

#50 — No Graceful Degradation for External Service Failures 🟠

AI generates code that assumes external services (Stripe, Mux, Supabase,
Sentry, PostHog) are always available. When any one service has an
outage, the entire application becomes non-functional rather than
degrading gracefully.[^(28][)17]

What to flag: Application code that throws uncaught errors when
analytics, monitoring, or non-critical services fail. No fallback when
video delivery is unavailable. Stripe unavailability crashing the entire
coach interface, not just the payment flow.

Fix: Wrap non-critical service calls in try/catch with silent failure.
Critical paths (auth, core data) have offline-capable fallbacks. Feature
flags to disable integrations when they fail.

Audit Priority Order

Feed this to your audit subagent in severity order. Focus the first pass
on Categories 1 and 2 — security vulnerabilities are the items that can
end the company overnight. Categories 3–5 are the items that end user
experience at scale. Categories 6–8 are the items that end engineering
velocity over time.

  ----------------------- ----------------------- -----------------------
  Priority                Categories              Risk

  Pass 1                  Security (#1–#13)       Data breach, financial
                                                  loss, legal exposure

  Pass 2                  Data integrity          Permanent data loss,
                          (#44–#47)               corrupted business
                                                  records

  Pass 3                  Concurrency (#28–#32)   Silent data corruption
                                                  under real usage

  Pass 4                  Error handling          Production
                          (#33–#37)               invisibility, user
                                                  abandonment

  Pass 5                  Performance (#21–#27)   Scale failure, user
                                                  experience degradation

  Pass 6                  Architecture (#14–#20)  Long-term
                                                  maintainability and
                                                  team onboarding

  Pass 7                  Code quality (#38–#43)  Developer velocity and
                                                  technical debt

  Pass 8                  Infrastructure          Deployment risk and
                          (#48–#50)               operational resilience
  ----------------------- ----------------------- -----------------------

References

1.  Common Security Vulnerabilities in AI-Generated Code - The security
    vulnerabilities AI coding tools create most often and how to fix
    them before going live...

2.  Vibe Coding Security: Risks, Vulnerabilities + How to Ship Safely -
    Hard-coded credentials, missing input validation, and insecure auth
    flows account for the majority o...

3.  The Vibe Coding Hangover: Why Speed Is Breaking Enterprise ... - Out
    of 1,645 Lovable-created web applications that were scanned, 170
    (approximately 10.3%) contained...

4.  The OWASP Top 10 for Vibe-Coded Applications (Part 2) - The OWASP
    Top 10 got a major update in 2025 — the first since 2021 — and it
    maps surprisingly well t...

5.  Vibe Coding Against OWASP Top10 2025 - SoftwareMill - The idea is
    simple: we'll vibe code a web app where there's a lot of potential
    for making security m...

6.  The AI code review checklist that prevents the next $1M production
    ... - 8 documented disasters. 7 failure modes. 3 review tiers. 12
    self-review prompts. Built for engineers...

7.  Enterprise AI Challenges in 2026: Mystery Meat, Kill Zones ... - ...
    failure rate of enterprise AI ... Found 45% of AI-generated code
    contained vulnerabilities, with...

8.  I scanned 50 vibe-coded projects for production readiness. Average -
    Here's what came out: Average production readiness: 57%. 82% had no
    error boundaries. 76% had no log...

9.  The Wild Security Mistakes Hiding in Vibe-Coded Apps - AI code often
    skips sanitizing inputs. This leaves your app wide open to SQL
    injection or cross-site...

10. 10 Anti-Patterns Hiding in Every AI-Generated Codebase - The same 10
    bugs show up in every AI codebase we audit. TypeScript without
    validation, orphan migrat...

11. Hundreds of NPM packages compromised in a new supply chain ... - A
    major supply chain attack has compromised hundreds of open-source
    packages on NPM and PyPI, steali...

12. Largest NPM Compromise in History - Supply Chain Attack - Reddit -
    Hey Everyone. We just discovered that around 1 hour ago packages
    with a total of 2 billion weekly do...

13. No, the AI didn't compromise your npm packages. You did. - AI agents
    that auto-install dependencies are dangerous because they shrink the
    verification window f...

14. Vibe Coding Security: Risks, Vulnerabilities, and Secure AI Coding -
    Enterprise scale API security scanning for early detection of
    critical vulnerabilities. ... What Sec...

15. OX Research: AI Code Not Inherently Less Secure, but "Army of ... -
    OX Security finds 10 critical anti-patterns in AI-generated code,
    warning that speed, not quality, i...

16. AI-Generated Code Creates New Wave of Technical Debt, Report ... -
    AI-generated code is “highly functional but systematically lacking
    in architectural judgment”, a new...

17. Why Enterprise AI POCs Fail | Building AI-Ready Architecture at
    Scale - It is a failure of architectural readiness. The pattern
    enterprises are increasingly recognizing. Ac...

18. Anti‑Patterns Where AI Breaks Systems - Simplico - This article
    documents common anti‑patterns we see when AI is introduced into
    production systems, wh...

19. Common SQL Performance Issues - Page 5 of 5 | OneNoughtOne - Master
    the identification, diagnosis, and resolution of the most prevalent
    SQL performance anti-patt...

20. The N+1 Query Problem: When Your Code Needs a Performance ... - The
    N+1 problem happens when you need a collection of data and related
    details for each item. ... To...

21. What is the "N+1 selects problem" in ORM (Object-Relational ... -
    The "N+1 selects problem" is generally stated as a problem in
    Object-Relational mapping (ORM) discus...

22. [bug/error] Missing database indexes on frequently queried columns
    ... - Performance Impact: Full table scans on commonly queried
    columns; Query latency increases linearly w...

23. Database Indexing — AI Coding Building Blocks - LearnWithHasan -
    Your app worked great with 100 users. Now you have 10,000, and every
    page takes forever to load. <st...

24. Performance Pitfalls – AI That Kills Your Latency - DEV Community -
    Mistake 2: Missing Index Recommendations. Description: AI generates
    queries without suggesting appro...

25. AI-generated code doesn't fail loudly. It fails
    correctly-looking. - 1. Concurrency and race conditions · multiple
    requests can run in parallel · responses can resolve o...

26. Prompts Won't Fix Race Conditions: Designing Code-Debugging AI ... -
    The reason is simple: concurrency bugs are properties of executions,
    not just code. Without a model ...

27. Race Conditions — Why Your Code Randomly Breaks - YouTube - Code
    From Scratch #60 — Race conditions — why shared state breaks Part of
    Phase 6: Concurrency ◁ Pre...

28. Why Vibe Coding Fails and How to Fix It - DAPLab - Why vibe coding
    often stalls during iteration: common failure patterns and fixes to
    make coding agen...

29. Understanding Anti-Patterns and Quality Degradation in AI ... -
    They're systematic behaviours that show how AI tools approach code
    generation. The patterns break do...
