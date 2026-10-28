# Find return catch-up

`CommunityFindScreen` uses the existing `useVoiceCatchUp` helper with its active
search query. A foreground return or navigation focus re-reads the current search
after its first answer, provided the last read or return attempt was at least
15 seconds ago. A realtime refresh counts as a read; paired foreground and focus
events share the same bound. The existing query retains its workspace, search
term, kind, cohort and pagination behavior.

Both the build-time and runtime search gates, a workspace, and a nonempty trimmed
term are required for catch-up. No timer polls in the background, no extra
realtime listener is created, and the helper removes its app/focus listeners when
Find unmounts. Failed reads continue to use Find's existing error and retry
states. No visible strings, routes, flags or layout are changed.

The screen-level tests live alongside the existing voice removal integration
tests in `src/hooks/__tests__/useVoiceRemovalPing.test.tsx`. They exercise a missed
ping on foreground return and refocus, the shared read bound, listener cleanup,
idle input and runtime-off suppression. The existing Find, search, voice feed,
detail and removal-ping suites remain regression coverage for the shared helper
and query behavior.

The separate duplicate badge subscription issue is not changed here. The tab
library renders the active and inactive icon layers separately, so putting the
badge subscription inside `CommunityTabBarIcon` creates two subscriptions.
`ClientNavigator.tsx` and the badge hook's module belong to concurrent lanes.
