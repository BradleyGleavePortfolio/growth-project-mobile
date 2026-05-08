# Private Community Hub

## Purpose

The Private Community Hub is a coach-led, closed social surface. It does not have a global feed or open replies — by design. Clients join rooms only by coach invitation, and all posts come from coaches or cohort members who have been added to a room. Member counts are rounded ("about 20 members") to prevent vanity comparisons.

Voice notes are represented in the UI as a coming feature but are held behind a separate `communityVoiceNotes` flag that defaults `false` even in dev — no false promises about availability.

All backend endpoints are **not yet live**. The adapter returns an empty `isStale: true` payload.

## Screens + State Machine

| Screen | File | State |
|---|---|---|
| PrivateCommunityHubScreen | `src/screens/client/PrivateCommunityHubScreen.tsx` | `loading → flag-off empty / stale empty / rooms + posts list` |

### State transitions

```
mount
  └─ featureFlags.privateCommunityHub === false
       └─ render: "Community is preview-only" [terminal until flag on]
  └─ featureFlags.privateCommunityHub === true
       └─ loading=true → fetch fetchCommunityHub()
            └─ success → payload.rooms/recentPosts empty → render empty states
            └─ success → rooms/posts present → render RoomRow + PostRow lists
  └─ pull-to-refresh → re-fetch
  └─ featureFlags.communityVoiceNotes === false → gated note banner visible
```

## API Endpoints Consumed

| Endpoint | Status | Notes |
|---|---|---|
| `GET /community/hub` | **MOCKED** | Adapter returns empty stub. Replace `fetchCommunityHub()` body when endpoint ships. |
| `POST /community/posts` | **MOCKED** | No post-creation UI yet in this scaffold. |
| Voice note upload pipeline | **MOCKED** | Flag stays `false` until upload pipeline ships. |

## Feature Flags

| Flag | Env var | Default (prod) | Default (dev) | Meaning |
|---|---|---|---|---|
| `privateCommunityHub` | `EXPO_PUBLIC_FF_PRIVATE_COMMUNITY_HUB` | `false` | `true` | Enables the Private Community Hub surface |
| `communityVoiceNotes` | `EXPO_PUBLIC_FF_COMMUNITY_VOICE_NOTES` | `false` | `false` | Enables voice-note attachments in posts (always OFF until upload pipeline ships) |

## Tests

| File | What it asserts |
|---|---|
| `src/__tests__/wave11Screens.test.tsx` | Flag-off renders preview-only empty state (RTL). Source guards: member-count rounding present, voice notes gated behind flag, no global feed reference, accessibility labels on screen + sections. |
| `src/__tests__/wave11Doctrine.test.ts` | `fetchCommunityHub()` adapter returns empty rooms + posts + `isStale: true`. |

## Future Work / Known Limits

- **No live backend.** `GET /community/hub`, room membership, and post endpoints do not exist yet.
- **Voice note pipeline.** The `communityVoiceNotes` flag stays `false` until the audio upload, 60-second cap, and abuse-scan pipeline are built. The scan promise ("scanned before they reach your room") must be backed by a real service before the flag is turned on.
- **Post creation UI.** This scaffold shows rooms and recent posts but has no compose flow. A compose button and `POST /community/posts` integration is needed.
- **Reply threads.** `CommunityRoom.repliesAllowed` is typed and respected in the data model, but the UI does not yet render reply threads.
- **Abuse-scan service.** The voice note gated note references scanning. The actual third-party service (ClamAV or equivalent) needs to be decided before the flag goes live.
