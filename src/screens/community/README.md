# Client Community

CommunityComposerScreen uses a serif heading, Inter hairline inputs, DTO character
limits and one forest Post/Send action. Workspace failures retry; rejected drafts stay.
CommunitySpaceScreen uses a serif space name and unfilled hairline post rows.
Post, coach-message, safety and flag-gated voice-note pathways remain reachable.
CommunityThreadScreen reads posts in Inter 17 pt, separates replies with hairlines,
distinguishes loading/failure/empty, and focuses the reply input from its empty action.
A Back row returns (or opens the Community tab when a link opened the thread). The post
and each reply carry a muted author/time line: "You" and "Your coach" come from ids, any
other name only from the server's `author_name` (first name), otherwise only the time.
Reactions show the server's summary (the post's `reactions`, else the state the last tap
returned), flip while a tap is in flight, and a second tap removes the reaction. The
author deletes their own post from its "..." menu after a confirm
(DELETE /community/posts/:postId); replies have no delete endpoint. Pull to refresh
reloads the post and its replies. Tests: `CommunityThreadScreen.test.tsx`.

ReactionBar offers Like, Fire, Strength, Love, Clap and Celebrate from the single
`COMMUNITY_REACTION_BY_KIND` registry in `api/communityApi.ts`. REST accepts exact
emoji graphemes; named kinds are for realtime only. Raised hands display the
backend celebration key; target and eyes are not offered. The quick row's first
four are Like, Fire, Strength and Love. Accepted stored keys remain tappable;
unknown/legacy stored keys keep their glyph and count as read-only content.
No reaction layout, wording or haptic behaviour changed (REACTFIX, agent 146).
Tests: `components/community/__tests__/ReactionBar.test.tsx`.

Today is a calm date-led column built from `src/ui` (`Screen`, `Headline`,
`Overline`, `QuietSection`, `PrimaryButton`): a TODAY overline over the serif
date, one hairline section per item (overline, serif title, muted meta, chevron)
and one rounded forest action pinned in the footer (New post, or the empty
state's destination). Loading is the shared skeleton and a failed load is the
shared QuietError text retry (REDO-HABITS-CAL-COMM-133). The server supplies cohort name
and count, pinned title, event start and challenge end; no author name, post body,
post timestamp or engagement count is invented. “Pinned post” does not imply its
author is the client's coach.

`CommunityHomeScreen.tsx` (C6-M1S, `featureFlags.communityHomeV2`, default off; off,
the tab opens on the shell below) is the Forest Pop Community Home (C6CHAT-S-V2 c01,
MOCK-COMMX2). A deep masthead holds the community's gold monogram and name (GET
/community/workspaces/:id, "Community" until it loads) and Search with `communitySearch`.
The segment on a forest track is Home, then Challenges with `communityChallenges` (the
embedded Challenges list); Activity takes its place between them when its feed ships,
and one segment draws no control. The leaf pill slides 180 ms with a selection tick;
Reduce Motion moves it at once. Home is `components/community/SpaceTree`: a Spaces
section (the server's spaces in its order, announcement spaces with a megaphone, the
rest with #; Leaderboard with a Private chip for coached clients; Classroom with
`communityClassroom`) and Direct messages (the coach's first name and "Your coach",
opening the C3 coach thread, with its `/messages/unread-count` in a leaf badge capped at
99+), then Community safety. Sections fold. Spaces render flat and carry no count until
B-LAYERS (layers) and B3 (per-space unread) ship; section spaces wait for layers. A space
row opens `CommunitySpace` with its id; with the flag on that page draws Back and "Open
space list" (`SpaceDrawer`): a deep drawer with the same tree, the open space on a leaf
edge, "Jump to a space or person" filtering by name, 250 ms slide (Reduce Motion: fade);
a space picked there replaces the open one, so Back returns Home. Loading is a still
skeleton; a failed read shows the error with Try again (error tick if it fails again).
Tests: `CommunityHomeScreen.test.tsx`.

`CommunitySpaceChatScreen.tsx` (SC-M1, `featureFlags.communitySpaceChat`, default off) is
the space chat: one stream per space, newest at the bottom, with `# name` and the member
count in the header. The coach's info button opens the space's page. A member's opens
`components/community/space-chat/SpaceInfoSheet` (FR-871R7): the name, the member count,
the purpose the coach wrote (the space's `description` on GET /community/cohorts, shown
only when it has text; backend#1178 adds the field, so it is read as optional) and the
people in the space from GET /community/cohorts/:cohortId/members, grouped Coach, Team
and Members with the viewer first as "You". People load 50 at a time (Show more), stay in
memory only, and are asked for only after the server has let this person in on this
visit; a 403 or 404 lists no one. Loading is the shared QuietLoading; a failed read is one
calm line with Try again (the connection line when offline).
Tests: `CommunitySpaceChatScreen.test.tsx`.

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
