# TGP Standing Rules (read at the start of every session)

1. EVERYTHING MUST BE BUILT TO DECACORN QUALITY.
2. ALL NEW FEATURES MUST BE BUILT, AUDITED BY CHATGPT 5.5, FIXED PER THE AUDIT, AUDITED AGAIN, AND FIXED AGAIN UNTIL CLEAN.
3. ASSUME THE OWNER HAS THE TECH KNOWLEDGE OF A 7TH GRADER. EXPLAIN CHOICES IN SIMPLE LANGUAGE.
4. ASK QUESTIONS FOR CLARITY AT EVERY NEW FEATURE PROJECT.
5. AVOID THE 50 DOCUMENTED PATTERN FAILURES OF AI CODING AT ENTERPRISE SCALE.
6. NEVER KICK THE CAN. FIX ISSUES AT THE ROOT THE MOMENT THEY APPEAR.
7. DECACORN QUALITY / DEPTH / ENTERPRISE GRADE / 99.99% UPTIME IS THE GOAL.
8. CHECKOUT MUST FEEL IN-APP AND BRANDED — NEVER VISIBLY LEAVE THE APP.
9. NO RAW ERROR CODES TO USERS. EVERY ERROR MUST BE STRUCTURED AND CLEAR.
10. ALWAYS DEFAULT TO THE HIGHEST QUALITY, MOST THOROUGH PATH (DECACORN DEFAULT).
11. NEVER DELETE FEATURES OR SHRINK FEATURE ABILITIES. ALWAYS BUILD OUTWARD.
12. THE OWNER CANNOT CHECK FLY OR GCP VALUES DIRECTLY — DO NOT ASK.
13. OAUTH CONSENT SCREEN MUST BE IN PRODUCTION MODE (LAUNCHING IN FRONT OF 800 PEOPLE).
14. ALWAYS BUILD WITH THE LATEST VERSION OF ALL "PLUMBING" — DEPENDENCIES, LIBRARIES, SDKS, RUNTIMES, GITHUB ACTIONS, TOOLING. WHEN STARTING ANY NEW FEATURE OR PR, USE THE NEWEST STABLE VERSION OF EVERY DEPENDENCY IT TOUCHES. WHEN DEPENDABOT OPENS AN UPGRADE PR, "MERGE IT" IS THE DEFAULT OUTCOME. MAJOR-VERSION BREAKS GET THEIR OWN PR + AUDIT, NEVER DEFERRED INDEFINITELY. STALE PLUMBING IS TECH DEBT.
15. EVERY PERSISTED KEY IS USER-SCOPED — SIGN-OUT MUST WIPE THE LOCAL CACHE COMPLETELY.
Every key written to AsyncStorage, SecureStore, MMKV, or any local cache must be namespaced to the authenticated user's ID. On signOut, purge every key belonging to that user before resolving — no residual data for the next session.
16. NEVER TRUST THE CLIENT CLOCK — ALL TIME-SENSITIVE LOGIC IS SERVER-AUTHORITATIVE AND TIMEZONE-CORRECT.
Never use Date.now() or new Date() on the client for anything that affects business logic, scheduling, or expiry. Derive time from the server response and normalise to the user's declared timezone.
17. ERRORS MUST NEVER LEAK SERVER INTERNALS — SCRUB ALL OUTBOUND ERROR STRINGS.
Apply Rule 9's structured error format everywhere, and run every outbound error message through a regex scrubber that strips stack traces, file paths, query text, and env-var names before the string reaches the client.
18. NEVER CLAIM SUCCESS WHEN THE OPERATION HAS NOT COMPLETED — NO FABRICATED CONFIRMATIONS.
Do not update UI, fire analytics events, or return a 200 status until the underlying mutation has committed and the response has been verified. Speculative success is a silent data-integrity failure.
19. EVERY MUTATION MUST BE IDEMPOTENT — GENERATE A UUID IDEMPOTENCY KEY BEFORE THE FIRST ATTEMPT.
Generate the key on the client before initiating the request, persist it for the lifetime of the operation, and pass it on every retry. The server must deduplicate on this key. No payment, write, or state-changing call may fire without one.
20. ONE SOURCE OF TRUTH PER PIECE OF STATE — DERIVE EVERYWHERE ELSE, STORE NOWHERE ELSE.
Pick exactly one authoritative location (server DB, Zustand slice, React context) for each piece of state. Every other representation must be derived from that single source, never independently stored and later reconciled.
21. EVERY NAVIGABLE SCREEN MUST HAVE AT LEAST ONE REACHABLE navigate() CALL — NO ORPHAN ROUTES.
Before merging any screen, confirm that at least one production code path calls navigate() to that route. Screens with no caller are dead product surface and dead maintenance burden; remove them or wire them in the same PR.
22. RBAC IS SERVER-AUTHORITATIVE — THE CLIENT MIRRORS FOR UX ONLY, NEVER FOR ACCESS CONTROL.
Role checks that gate data access or mutations must be enforced at the server and database layer. Client-side role guards are cosmetic only; treat any client-supplied role claim as untrusted.
23. HOOKS MUST BE CALLED UNCONDITIONALLY — NEVER WRAP A HOOK IN A CONDITIONAL OR TRY/CATCH.
React's Rules of Hooks are not optional. No hook call may appear inside an if, a loop, a try/catch, or a callback. Violations cause non-deterministic render failures that are nearly impossible to reproduce in development.
24. DEAD CODE DIES IN THE SAME PR THAT ORPHANS IT — NEVER DEFER CLEANUP.
When a refactor, feature removal, or rename makes code unreachable, delete it before the PR is merged. Do not leave commented-out blocks, unused imports, or stale feature-flag branches for a "later cleanup" PR that never comes.
25. AUDIT EVERY CALLER BEFORE CHANGING AN API CONTRACT — CROSS-CONSUMER REVIEW IS MANDATORY.
Before altering the shape, name, or behaviour of any API endpoint, query, or exported function, enumerate every consumer of that contract. The PR description must list all callers and confirm each one is updated or unaffected.
26. TESTS MUST PROVE BEHAVIOUR, NOT STRINGS — ASSERT SPECIFIC VALUES AND OUTCOMES.
A test that only checks toBeDefined(), toBeInstanceOf(), or that a function was called proves nothing. Every test must assert the specific value, state change, or side effect that constitutes correct behaviour for the scenario under test.
27. EVERY nav.navigate() TARGET MUST BE TYPE-CHECKED AT COMPILE TIME.
Use typed navigation (React Navigation's typed param lists or equivalent). A navigate() call that references a screen name or param shape the TypeScript compiler cannot verify is a latent crash waiting for a rename or param change.
28. PERMISSION PROMPTS ARE GATED TO VALUE MOMENTS — NEVER ASK ON COLD LAUNCH.
System permission prompts (camera, notifications, location, contacts) must appear only immediately before the user performs an action that requires that permission. Prompting on app open trains users to deny reflexively and tanks approval rates.
29. BACKEND CONTRACT DRIFT MUST FAIL THE BUILD — TYPE-SHARE OR SCHEMA-VALIDATE ACROSS THE BOUNDARY.
The mobile app and the backend must share a single source of type truth (generated types, OpenAPI spec, Zod schemas, or equivalent). Any drift between the client's expected contract and the server's actual contract must surface as a CI failure, not a runtime crash.
30. BAN `dangerouslySetInnerHTML` AND ANY UNSANITISED RENDERING OF USER-GENERATED OR THIRD-PARTY HTML/MARKDOWN — ALL UGC MUST PASS THROUGH A WHITELISTED SANITIZER BEFORE RENDER.
Every string that originates from a user, a community submission, or a third-party feed and is rendered as HTML or Markdown must be processed by an approved sanitiser (e.g., DOMPurify or equivalent) before it touches the DOM. `dangerouslySetInnerHTML` is banned project-wide; violations must be caught in code review and blocked in CI.
31. EVERY AUTH ENDPOINT, PAID-API ENDPOINT, AND WEBHOOK MUST HAVE RATE LIMITING ENFORCED AT THE EDGE OR IN THE FRAMEWORK — NO ENDPOINT THAT TOUCHES MONEY, IDENTITY, OR AI CREDITS SHIPS WITHOUT A DOCUMENTED LIMIT.
Define the limit in the PR that adds or changes the endpoint, configure it at the reverse proxy or middleware layer, and include it in the PR description. Limits must be reviewed and tightened if abuse signals appear in observability dashboards.
32. WILDCARD CORS (`*`) IS BANNED ON ANY ENDPOINT THAT HANDLES AUTH, SESSIONS, OR USER DATA — CORS MUST BE AN EXPLICIT ALLOWLIST OF KNOWN ORIGINS.
List every permitted origin in an environment variable or configuration file; never derive it dynamically from the request unless the origin is confirmed to be in the allowlist. Any endpoint that issues tokens, reads user records, or mutates state must reject requests from unlisted origins with a 403.
33. NO DATABASE QUERY INSIDE A LOOP — BATCH WITH `IN (...)`, JOIN, OR A SINGLE PARAMETERISED QUERY. EVERY NEW REPOSITORY METHOD STATES ITS QUERY COUNT IN ITS DOCSTRING IF IT TOUCHES MORE THAN ONE ENTITY.
Identify the query boundary before writing a loop; if the data cannot be fetched in one round-trip, restructure to use eager loading, a batch fetch, or a DataLoader. Every foreign key and every column used in a WHERE or ORDER BY on a high-volume table must have an index. Repository method docstrings must document the expected query count for any method that joins or aggregates across entities.
