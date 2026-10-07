# Client Community

CommunityComposerScreen uses a serif heading, Inter hairline inputs, DTO character
limits and one forest Post/Send action. Workspace failures retry; rejected drafts stay.
CommunitySpaceScreen uses a serif space name and unfilled hairline post rows.
Post, coach-message, safety and flag-gated voice-note pathways remain reachable.
CommunityThreadScreen reads posts in Inter 17 pt, separates replies with hairlines,
distinguishes loading/failure/empty, and focuses the reply input from its empty action.

Today is a calm date-led column on the theme background: small-caps sections,
text-first hairline rows and one forest action. The server supplies cohort name
and count, pinned title, event start and challenge end; no author name, post body,
post timestamp or engagement count is invented. “Pinned post” does not imply its
author is the client's coach.

The shell retains Today, Hall, Cohorts, Challenges and Messages behind their
existing flags, with underlined text segments and real unread counts. Safety and
coach-gated leaderboard stay visible; Find and Classroom open their existing
routes when enabled. Loading, retry and true-empty states remain distinct.
Empty actions name their actual Hall/community-message/coach-message destination;
coachless accounts see no unavailable coach-message action. New post opens the
existing composer only after an enabled Today response confirms a workspace and
Hall is enabled. Event/challenge feature-off fallbacks are unchanged.

`CommunityChallengesScreen.tsx` presents unfilled hairline rows with real start/end
dates, status, title and description; each opens the same challenge detail.
`CommunityChallengeDetailScreen.tsx` keeps Join/Log progress, sharing choices,
progress sheet, encouragement composer, paging and safety controls. Own rank
appears only from a returned self row; empty/error copy never invents standings
or successful sends. The current challenge contract has no participant total,
so no participant count is fabricated. Tests: `CommunityChallengesScreen.test.tsx`,
`CommunityChallengeDetailScreen.test.tsx`.

Tests: `CommunityTodayScreen.test.tsx`, `communityLeaderboardEntry.test.tsx`,
`communityMessageCoach.test.tsx`. Design rules: `docs/QUIET_LUXURY_DOCTRINE.md`.
