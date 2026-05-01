# Wave 10 — Community rooms, cohorts, and chat doctrine

**Status:** Pre-build, docs-only.
**Last reviewed:** 2026-05-01.
**Backend dependency:** Spaces / events service (cross-repo backend wave), AI gateway for the operator copilot, push service for announcements.
**Mobile dependencies:** Wave 6 (`Install` consent), Wave 2 (`docs/expansion-wave-2/07-coach-client-messaging-surfaces.md`), `docs/whop-expansion/07-community-spaces.md`, `08-events-calls-replays.md`, `10-ai-business-copilot.md` (PR #96, source material).
**Position in 6–10 order:** Last. Community is the most doctrinally sensitive surface in the wave. Building it last means the install / consent / permission / refactor work in Waves 6–9 is in place before community ships.

> **Doctrine note.** This is the wave that most easily slides into Discord-style chrome. The doctrine choice is: **rooms over reactions, presence over performance, acknowledgement over applause.** Every UX choice in this file is consistent with that.

---

## 1. Persona contract

| Persona | What they see and do in Wave 10 |
| ------- | ------------------------------ |
| **Owner** | Sees a global moderation dashboard on web. Mobile companion read-only. Sets default moderation policies (per-coach overridable). |
| **Coach** | After installing `Community spaces` (Wave 6), sees a `Community` row in `Dashboard` and a `Community` tab inside each `ClientDetail` (post-Wave-6 refactor). Authors rooms / cohorts, posts announcements, runs voice-note check-ins, manages member directory and moderation queue. Sees the AI business copilot tile. |
| **Sub-coach** | Cannot install community. Can post in rooms / cohorts the head coach assigns them. Cannot create / archive rooms. Cannot post platform-wide announcements. |
| **Client / Student** | Sees a `Community` row in `MoreStack → Track` once their coach has installed community. Reads rooms / cohorts they belong to, posts, listens to voice notes from coach, sees announcements, browses member directory (opt-in). |
| **Ambassador / Affiliate** | No community-side privilege. The role does not promote inside community. |
| **Buyer / Prospect** | No community access pre-purchase. Storefront FAQ may *describe* the community; nothing in it is browseable. |

## 2. Navigation map

```
Coach Dashboard
└── CommunityCard                   — flagged behind features.community

Coach ClientsStack → ClientDetail (post-Wave-6 refactor)
└── ClientCommunityTab              — what rooms this client is in

Coach SettingsStack → Install → Community
└── CommunityAdminScreen            — rooms, cohorts, announcements, members, moderation

Client MoreStack → Track
└── Community
    ├── CommunityHome               — rooms + cohorts overview
    ├── RoomList
    ├── RoomDetail                  — thread of posts
    ├── PostComposer
    ├── PostDetail                  — comments under a post
    ├── AnnouncementsList
    ├── AnnouncementDetail
    ├── VoiceNoteList               — coach-published voice notes
    ├── VoiceNotePlayer
    └── MemberDirectory             — opt-in only; see §7
```

Deep links:

| URL pattern | Route |
| ----------- | ----- |
| `tgp://community` | `CommunityHome` |
| `tgp://community/room/<roomId>` | `RoomDetail` |
| `tgp://community/post/<postId>` | `PostDetail` |
| `tgp://community/announcement/<id>` | `AnnouncementDetail` |
| `tgp://community/voice/<id>` | `VoiceNotePlayer` |
| `tgp://community/members` | `MemberDirectory` |

## 3. Screen contracts

### Rooms vs Cohorts vs DMs (the contract)

The three primitives are **distinct** and **non-overlapping**:

- **Room.** Per-coach, persistent, many-to-many topic channel. Members are clients of the coach. Default room: `General`. Coach can create more (e.g. `Strength`, `Nutrition`, `Off-topic`). Posts are persistent, threaded one-level (post + replies, no nested threads).
- **Cohort.** A *time-bounded* group of clients on the same program / start date. Behaves like a room but auto-archives at program end. Member list is auto-derived from program enrolment. Coach cannot manually add / remove members.
- **DMs.** One-to-one between coach and client. Already shipped (`ClientMessages`). **Wave 10 does not change DM behaviour.**

If a feature could go in any of the three, it goes in the most narrow one. Doctrine bias: when in doubt, prefer DM over cohort over room.

### `RoomDetail`

- **Purpose:** Thread of posts in a room.
- **Server data:** `useRoomPosts(roomId, cursor)` → `GET /v1/community/rooms/:id/posts?cursor=`. Cursor-paged, newest first.
- **Mutations:** `createPost({ roomId, body, mediaUploadId? })`, `acknowledgePost(postId)` (the *seen* affordance — see §1 doctrine note).
- **States:**
  - Loading: skeleton list.
  - Empty: `Be the first to post.` honest empty.
  - Error: AsyncBoundary retry.
  - Offline: cached posts shown; new posts queued via the existing `services/foodLogQueue` shape.

### `PostComposer`

- **Purpose:** Write a post. Plain text, optional photo, no rich formatting in v1.
- **Mutations:** `createPost`. Optimistic.
- **Doctrine constraints:**
  - **No reactions.** No hearts, no claps, no fire. The single non-textual response is `Acknowledged` — a "seen by N" tally, no per-user attribution.
  - **No mentions in v1.** Avoids the moderation surface mentions create.
  - **No rich text in v1.** Plain text + line breaks. Markdown is *not* rendered.
  - **No emoji input.** The composer's text input does not enable emoji on iOS / Android keyboards via accessibility settings, but the doctrine forbids the platform from *suggesting* emoji. Posts containing emoji are rendered as-is — we do not rewrite user input — but no platform UI prompts for them.
  - **One-level threading only.** Replies are flat under a post.

### `AnnouncementsList` / `AnnouncementDetail`

- **Purpose:** Coach-authored announcement broadcast to all clients (or a chosen cohort). Distinct from rooms — announcements **cannot be replied to**.
- **Server data:** `useAnnouncements()` → `GET /v1/community/announcements`. `useAnnouncement(id)` → `GET /v1/community/announcements/:id`.
- **Mutations (coach):** `createAnnouncement({ body, audience: 'all' | { cohortIds } })`, `archiveAnnouncement(id)`.
- **Push:** announcements always send a push to the audience (per consent — see §7).

### `VoiceNoteList` / `VoiceNotePlayer`

- **Purpose:** Coach can publish voice notes (≤ 3 min) to a room or cohort. Member directory plays them; cannot reply with voice (v1).
- **Server data:** `useVoiceNotes(scope)` → `GET /v1/community/voice-notes?scope=`. `useVoiceNote(id)`.
- **Mutations (coach):** `publishVoiceNote({ scope: { roomId? | cohortId? }, mediaUploadId, transcript? })`. Mobile records via `expo-av` (Microphone permission — Wave 6 prompt).
- **Player:** standard audio player, scrubbable, 1x / 1.5x / 2x speed. Auto-pauses on screen lock.
- **Transcript:** optional, generated server-side (AI gateway). When present, mobile renders it under the player. Accessibility-required for users with auditory impairments.

### `MemberDirectory`

- **Purpose:** Opt-in directory of members in a coach's community. Each entry is `displayInitial` + first-name + city (if opted in) + tags (e.g. `New`, `On wave 1 of program X`).
- **Server data:** `useMembers(coachId)` → `GET /v1/community/members`. **Returns only opt-in members.**
- **Privacy contract:** opt-in is explicit, opt-out is one tap, default is opt-out. Revocation removes the directory entry within one app session.
- **No follow / friend graph.** Wave 10 explicitly defers all client-to-client direct interaction. No DMs between clients.

### `CommunityAdminScreen` (coach)

- **Purpose:** Coach moderation surface. Manage rooms, cohorts, announcements, members, moderation queue (reported posts).
- **Server data:** `useCommunityAdmin()` aggregating `rooms`, `cohorts`, `pendingReports`, `recentAnnouncements`.
- **Mutations:** create / archive room; archive cohort; review report.

## 4. API contract dependencies

```ts
type Room = {
  id: string;
  coachId: string;
  title: string;
  description: string | null;
  archivedAt: string | null;
  membership: 'all_clients' | 'cohort_only' | 'invite_only';
  createdAt: string;
};

type Cohort = {
  id: string;
  coachId: string;
  programId: string;
  startsAt: string;
  endsAt: string | null;
  memberCount: number;
};

type Post = {
  id: string;
  roomId: string;
  authorId: string;
  authorDisplayName: string;
  body: string;
  mediaUrl: string | null;
  acknowledgements: number;       // count only — never list per-user
  hasAcknowledged: boolean;
  replyCount: number;
  createdAt: string;
  reportedByMe: boolean;
};

type Reply = {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: string;
};

type Announcement = {
  id: string;
  body: string;
  audience: 'all' | { cohortIds: string[] };
  publishedAt: string;
  archivedAt: string | null;
};

type VoiceNote = {
  id: string;
  scope: { roomId?: string; cohortId?: string };
  durationSec: number;
  audioUrl: string;
  transcript: string | null;
  publishedAt: string;
};

type Member = {
  userId: string;
  displayInitial: string;
  firstName: string | null;        // null if not opted in
  city: string | null;             // null if not opted in
  tags: string[];
  optInVersion: number;
};
```

Endpoints:

```
GET  /v1/community/rooms                                  → Room[]
POST /v1/community/rooms                                  → Room
GET  /v1/community/rooms/:id/posts?cursor=                → { posts: Post[]; nextCursor: string | null }
POST /v1/community/rooms/:id/posts                        → Post
POST /v1/community/posts/:id/acknowledge                  → { count: number }
POST /v1/community/posts/:id/report                       → { ok: true }
GET  /v1/community/posts/:id/replies                      → Reply[]
POST /v1/community/posts/:id/replies                      → Reply

GET  /v1/community/cohorts                                → Cohort[]
GET  /v1/community/announcements                          → Announcement[]
POST /v1/community/announcements                          → Announcement

GET  /v1/community/voice-notes?scope=                     → VoiceNote[]
POST /v1/community/voice-notes                            → VoiceNote (coach)

GET  /v1/community/members                                → Member[]
POST /v1/community/members/me/opt-in                      → { ok: true; optInVersion: number }
POST /v1/community/members/me/opt-out                     → { ok: true }
```

## 5. State and cache strategy

- React Query keys: `['community','rooms']`, `['community','room',id,'posts',cursor]`, `['community','post',id,'replies']`, `['community','announcements']`, `['community','voice-notes',scope]`, `['community','members']`.
- `staleTime`: 30 s for rooms / posts (active surface), 1 min for announcements, 1 min for voice notes, 5 min for member directory.
- Optimistic updates on `createPost`, `acknowledgePost`, `createReply`. Rollback on 4xx.
- Voice-note playback uses `expo-av` with the system audio session. Background playback supported on iOS via `app.json` `UIBackgroundModes: ["audio"]` (per `docs/platform-readiness/01`).
- Offline posture: cached posts viewable offline; new posts and acknowledgements queued; voice notes are not pre-downloaded by default (OWNER_DECISION-10.B).
- Recent voice-note transcripts cached locally for accessibility (screen reader can read transcript when offline).

## 6. Push and deep-link behaviour

| Event | Push payload | Deep link | Foreground | Consent gate |
| ----- | ------------ | --------- | ---------- | ------------ |
| New post in a room I'm in | `{ kind: 'community_post', roomId, postId }` | `tgp://community/post/<postId>` | In-app banner. | Per-room mute available (`features.community_room_mute`). |
| New reply on a post I authored | `{ kind: 'community_reply', postId }` | `tgp://community/post/<postId>` | In-app banner. | Always on. |
| New announcement | `{ kind: 'community_announcement', id }` | `tgp://community/announcement/<id>` | High-priority banner with sound (still tokenised, no celebratory sound). | Per-coach mute. |
| New voice note | `{ kind: 'community_voice_note', id }` | `tgp://community/voice/<id>` | In-app banner. | Per-coach mute. |
| Post reported by another user (coach only) | `{ kind: 'community_post_reported', postId }` | `tgp://community/admin/reports` | Sounded high-priority. | Always on for coaches. |

A user who has muted notifications still sees the in-app surface; mute affects only push.

## 7. Permissions and consent

- **Microphone** (coach publishing voice notes): via `PermissionPromptModal` (Wave 6).
- **Notifications** (announcements + post pushes): via `PermissionPromptModal`. Per-coach mute lives in `MoreStack → Account → Notifications`.
- **Member directory opt-in (clients):** explicit opt-in surface. Default opt-out. Revocation is one tap; directory entry is removed within one app session. Opt-in is **per-coach** — opting in to coach A's directory does not opt the user in to coach B's.
- **Voice note transcripts:** if a transcript is generated by the AI gateway, the *coach* sees a confirmation step — "Generate transcript? This sends the audio to our AI service." First-time consent. Persistent setting in `Settings → AI`.

## 8. Accessibility notes

- Posts are rendered as `accessibilityRole="article"` with the author + body as the accessible label.
- Acknowledgement count is announced as `"Acknowledged by N members. Acknowledge."` Toggling state announces `"Acknowledged."` or `"Acknowledgement removed."` Never `"Like"` / `"Liked"`.
- Voice note transcripts are required for accessibility — players announce `"Voice note. N seconds. Transcript follows."` followed by the transcript text. If no transcript is available, announce `"Voice note. N seconds. No transcript available — ask your coach."`
- Announcements are announced with a higher tone via a tokenised sound asset for users with notification sound enabled, but **never** the system "achievement" sound.
- `MemberDirectory` opt-in state is announced as `"You appear in this directory. Tap to opt out."` or `"You do not appear in this directory. Tap to opt in."`
- Dynamic type up to `accessibilityLarge` on every Wave 10 surface.

## 9. Analytics, privacy, security

| Event | Properties | Notes |
| ----- | ---------- | ----- |
| `community_room_viewed` | `{ roomId }` | No PII. |
| `community_post_created` | `{ roomId, hasMedia }` | Body never logged. |
| `community_post_acknowledged` | `{ postId }` | No PII. |
| `community_announcement_viewed` | `{ id }` | No PII. |
| `community_voice_note_played` | `{ id, completionPct }` | No PII. |
| `community_member_directory_optin` | `{}` | No PII. |
| `community_post_reported` | `{ postId, reasonCode }` | No PII. Reasons: `harassment | spam | unsafe | off_topic | other`. |

Privacy:

- Post bodies, reply bodies, announcement bodies, transcripts: **never** logged client-side. Only events with structural metadata.
- Acknowledgements are **anonymous in count** at every layer — backend stores a per-user-per-post acknowledgement record but never returns the per-user list. Client UI cannot show "X and Y acknowledged this".
- Voice notes carry no metadata beyond duration and (optional, consented) transcript. EXIF / location stripped at upload (re-using Wave 8's pipeline).
- Member directory respects `optInVersion` — if backend bumps the version (privacy-policy change), mobile re-prompts opt-in.

Security:

- Reporting a post is rate-limited (5 / hour per user). Mobile honours 429 with honest message.
- Coach-side moderation actions require fresh JWT (`iat` < 10 min). Archiving a room or removing a member surfaces a confirmation modal with biometric / passcode unlock.
- Voice note recording is device-only until upload. The `expo-av` recording is written to `cacheDirectory`; on background, recording is paused and discarded if the app is killed.
- Coach cannot read DM threads they are not a participant in (existing `ClientMessages` contract; Wave 10 explicitly does not extend coach visibility).

## 10. Test plan and acceptance criteria

### Unit

- `createPost` is optimistic; rolls back on 4xx with the body restored to the composer.
- `acknowledgePost` toggles and reflects server count; never shows per-user list.
- `MemberDirectory` filters out non-opt-in entries even if backend returns them (defence in depth).
- `RoomDetail` does not render replies of replies — flat one-level only.

### Integration

- Coach posts a voice note → all members of the room get a push within reasonable latency → tapping push opens `VoiceNotePlayer` with audio loaded.
- Client opts in to member directory → entry visible to other opt-in members → opts out → entry removed within one session.
- A reported post enters coach's moderation queue; coach archives; member view of the post is replaced with `This post was archived.` honest tombstone.

### Manual QA

- Background playback of a voice note with screen lock; verify audio continues; verify pause-on-call.
- Send announcement to a cohort; verify only cohort members get push; non-members do not.
- Try to add an emoji reaction; verify no UI affordance exists.
- Try to mention a member; verify no UI affordance exists.
- Switch network off mid-post; verify queued; verify reconnect submits.

### Acceptance criteria

- [ ] Reactions, hearts, claps, fire, applause: **none added**. The single non-textual affordance is `Acknowledged`.
- [ ] No per-user acknowledgement list ever surfaced.
- [ ] No mentions in v1.
- [ ] No rich text / Markdown in v1.
- [ ] No client-to-client DMs.
- [ ] Member directory is opt-in, opt-out, revocable, default-off.
- [ ] Posts / replies / announcements / transcripts are never logged client-side.
- [ ] Voice note transcripts available for accessibility; honest fallback when missing.
- [ ] Reports are rate-limited; UI honours 429.
- [ ] Coach moderation actions require fresh JWT and biometric / passcode unlock.
- [ ] Cohorts auto-archive at program end; archived cohort surfaces are read-only.
- [ ] Per-room and per-coach mute available without disabling all notifications.
- [ ] No celebratory chrome on any community surface.
- [ ] No leaderboard, no "top contributor", no "most acknowledged".
- [ ] AI business copilot tile is coach-only; never appears on client surface.

## 11. Phased implementation order, OWNER_DECISIONs, cross-repo deps

### Phased order

1. **Rooms (read-only) + posts (read-only).** First runtime PR. Validates the API and presence model.
2. **`PostComposer` + `acknowledgePost`.** Second runtime PR.
3. **Replies.** Third runtime PR.
4. **Announcements (coach + client).** Fourth runtime PR.
5. **Voice notes (coach publish + client play).** Fifth runtime PR. Microphone permission via Wave 6.
6. **`MemberDirectory` (opt-in).** Sixth runtime PR.
7. **Cohorts.** Seventh runtime PR. Auto-archive depends on backend program-completion event.
8. **Coach moderation surface (`CommunityAdminScreen`).** Eighth runtime PR.
9. **AI business copilot tile + conversation surface.** Ninth runtime PR. Coach-only. Honours the coach AI voice/tone setting (Wave 1, `docs/expansion/11`).

### OWNER_DECISIONs

- **OWNER_DECISION-10.A — Reactions vs acknowledgements.** Choices: (a) Acknowledgements only — single "seen" affordance with anonymised count (this brief's recommendation), (b) Reactions (hearts / claps), (c) None. **Recommendation:** (a). Acknowledgement is the doctrinally calmest affordance that still gives a coach a pulse on engagement. Revisit only if Wave 10 engagement data shows persistent disengagement *and* clients explicitly request a richer signal.
- **OWNER_DECISION-10.B — Pre-download voice notes.** Choices: (a) On-demand only (this brief's recommendation), (b) Auto-download recent ones. **Recommendation:** (a). Auto-download is data-spend the user did not ask for.
- **OWNER_DECISION-10.C — Member directory default.** Choices: (a) Default opt-out (this brief's recommendation), (b) Default opt-in. **Recommendation:** (a). Privacy-by-default. Operator can override per-coach if the coach's brand depends on visible community.
- **OWNER_DECISION-10.D — Mentions in posts.** Choices: (a) Defer to v2 (this brief's recommendation), (b) Ship in v1. **Recommendation:** (a). Mentions create a moderation surface (notification spam, harassment vector). Defer until moderation tooling is mature.
- **OWNER_DECISION-10.E — Client-to-client DMs.** **Recommendation:** Never on this platform. The product's value is the coach relationship; client-to-client DMs are a different product.
- **OWNER_DECISION-10.F — Voice note transcript via AI.** Choices: (a) Coach-consented opt-in per voice note (this brief's recommendation), (b) Always-on, (c) Always-off. **Recommendation:** (a). Transcripts are accessibility-critical, but they touch the LLM gateway and create a recurring cost. Make it deliberate.
- **OWNER_DECISION-10.G — Sub-coach posting authority.** **Recommendation:** Sub-coaches can post in rooms / cohorts the head coach assigns. Sub-coaches cannot create rooms, archive rooms, or send platform-wide announcements. Cohort announcements specifically can be granted via head coach scope.
- **OWNER_DECISION-10.H — Auto-archive of cohorts.** **Recommendation:** Auto-archive 14 days after program end. Archive is read-only; transcripts and posts remain accessible to members. Operator can extend the window per cohort.

### Cross-repo dependencies

- **Backend spaces / events service** — hard for everything in Wave 10.
- **Backend AI gateway** (existing for Wave 1) — soft for transcripts, hard for AI business copilot.
- **Push service** — hard for announcements + post pushes.
- **Web moderation dashboard** — soft. Mobile coach-side admin is enough for v1.

### Finance dependencies

- None for Wave 10 itself.
- AI transcript usage is a metered cost; coach plan tier may include or exclude transcripts. Mobile reflects entitlement honestly — `Transcripts are not on your current plan. Upgrade on web.` honest message.
