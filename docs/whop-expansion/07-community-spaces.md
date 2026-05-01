# 07 — Community spaces (per-coach forums)

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Client app (member experience) + coach app (moderation
+ authoring)
**Owner:** Mobile client team (member surface) + mobile coach team
(moderation surface)

## WHY

Coaching retention rises sharply when clients feel they are part of
a group, not just a 1:1 relationship. Today TGP has 1:1 messaging
(`docs/expansion-wave-2/07`) and challenges (`docs/expansion-wave-2/01`)
but no persistent many-to-many room. A community Space is that
room: a per-coach forum where members post, comment, react, and see
each other.

This is also the surface that converts a $200/mo program into a
$300/mo "program + community" offer — Spaces are an entitlement
attachable to any offer.

## WHEN to build

After:
- `docs/expansion-wave-2/07` messaging surfaces v2 ships
  (composer, attachment surface, list pattern). Spaces reuse the
  composer.
- `docs/expansion-wave-2/03` profile images & avatars in the
  field (members are visible to each other).
- Backend #122 (spaces / events service) exposes thread, post,
  reaction, member-list endpoints.

In parallel with [02-offer-builder](./02-offer-builder.md), which
introduces the `space` offer kind.

## WHERE in the repo

- New screens (member side):
  - `src/screens/client/spaces/SpaceListScreen.tsx` — entry list
    of spaces this user belongs to.
  - `src/screens/client/spaces/SpaceFeedScreen.tsx` — single
    space, scrollable post feed.
  - `src/screens/client/spaces/PostDetailScreen.tsx` — single
    post + comments.
  - `src/screens/client/spaces/SpaceMembersScreen.tsx` — roster.
- New screens (coach / moderator side):
  - `src/screens/coach/spaces/SpaceSettingsScreen.tsx` — title,
    description, rules, who can post.
  - `src/screens/coach/spaces/ModerationQueueScreen.tsx` —
    flagged content review.
- Entry: client side — More-stack row "Spaces" + a Home tile if
  the user belongs to ≥1 active space. Coach side — Settings →
  "Spaces" row, plus a quick-link from each `space` offer in the
  builder.
- API: `src/services/api.ts` — `spacesApi.list`,
  `getSpace`, `listPosts`, `createPost`, `getPost`,
  `createComment`, `addReaction`, `removeReaction`,
  `flagContent`, `coachApi.listFlagged`,
  `moderateContent`, `updateSpaceSettings`.
- Type: `src/types/spaces.ts`.

## WHO owns and uses it

- **Builder:** Mobile client team for member surface, mobile
  coach team for moderation. Composer + reaction primitives are
  shared with messaging v2 — extract before extending.
- **Author:** Coach (creates the space via the offer builder
  with `space` kind, or as a free space attached to an existing
  program).
- **Audience (member):** Anyone with the space entitlement
  (purchased or coach-granted).
- **Audience (moderator):** Coach + Team Mode moderator role.

## WHAT MVP includes

### Member side

- **SpaceListScreen** — list of joined spaces, sorted by latest
  activity. Each row: space title, coach name, unread badge,
  last-post preview.
- **SpaceFeedScreen** — feed of posts (text + optional single
  image). Composer at the top. Pull-to-refresh; cursor pagination.
- **PostDetailScreen** — full post body + comments. Reactions
  on post and on each comment (closed set: 👍 ❤️ 🔥 🙌 — finalise
  in the doctrine doc; do not invent UI emoji here).
- **SpaceMembersScreen** — read-only roster: name + avatar +
  role chip (coach / member / moderator).
- **Notifications** — opt-in per space. Default off; user opts
  in per-space. Push handled by existing notification pipeline.

### Coach / moderator side

- **SpaceSettingsScreen** — title, description, rules markdown,
  "Who can post" (members vs moderators-only), notifications
  default for new joiners.
- **ModerationQueueScreen** — flagged content list; tap →
  moderate (hide / restore / ban member).
- Coach can post as themselves anywhere; coach posts render with
  a "Coach" chip.

### Out of scope for v1

- Channels within a space (single-feed only).
- Threaded replies beyond one level (post → comments, not nested).
- Voice / video posts.
- DMs from inside spaces (use existing 1:1 messaging).
- Cross-space search.
- Rich-media attachments beyond single image (defer with the
  attachment work in messaging v2 if it defers).
- Mentions (@user) — defer to v1.1.
- Polls.
- Pinned posts (defer; coaches can post and ask members to
  scroll until then).

## HOW to implement safely

1. **Reuse the composer.** Messaging v2 owns the composer; spaces
   do not fork it. If spaces need anything the composer doesn't
   support, change the composer (extracted), not in spaces.
2. **Membership comes from entitlement.** Joining a space is the
   side-effect of an offer purchase (or a coach grant). There is
   no "request to join" flow on mobile in v1.
3. **Single-source unread counts.** The notifications service is
   the source; mobile does not compute unread from local state.
4. **Reactions are a closed set.** The set is configured server-
   side; mobile renders whatever the server returns. Do not
   hardcode the emojis in the renderer.
5. **Hidden vs deleted.** Moderation hides; only the user (or an
   admin via support) can permanently delete. Mobile's moderation
   action is "hide" — the copy must reflect it.
6. **Permissions on actions.** Reaction is open to all members;
   create-post depends on the space's "who can post" setting;
   create-comment depends on the same.

## Screens / navigation sketch

```
Member
──────
Home tile (if ≥1 active space)  ──► SpaceListScreen
More-stack → "Spaces"           ──► SpaceListScreen
                                       └─ tap row → SpaceFeedScreen
                                                       ├─ Composer (if allowed)
                                                       ├─ Post  ──► PostDetailScreen
                                                       │              └─ Comments + reactions
                                                       ├─ Header → "Members" → SpaceMembersScreen
                                                       └─ Header → "Notifications" toggle

Moderator
─────────
Coach app → Settings → "Spaces"  ──► (list of spaces this coach owns)
                                        └─ tap → SpaceSettingsScreen
                                                    ├─ Title / description / rules
                                                    ├─ Who can post
                                                    └─ "Moderation queue" → ModerationQueueScreen
                                                                                ├─ Hide / Restore
                                                                                └─ Ban member
```

## API contract dependency

- `GET /me/spaces` → `Space[]`
- `GET /spaces/:id` → `Space`
- `GET /spaces/:id/posts?cursor=` → `{ items: Post[], next:
  string | null }`
- `POST /spaces/:id/posts` body `{ body, imageRef?, idempotencyKey }`
  → `Post`
- `GET /spaces/:id/posts/:postId` → `{ post: Post, comments:
  Comment[] }`
- `POST /spaces/:id/posts/:postId/comments` body `{ body }`
  → `Comment`
- `POST /reactions` body `{ targetKind: 'post' | 'comment',
  targetId, key }` → `ReactionState`
- `POST /flags` body `{ targetKind, targetId, reason? }` → 204
- `GET /coach/spaces/:id/flagged` → `Flag[]`
- `POST /coach/moderate` body `{ targetKind, targetId, action:
  'hide' | 'restore' | 'ban' }` → 204
- `PUT /coach/spaces/:id/settings` body `SpaceSettings` → `Space`

```ts
type Space = {
  id: string;
  coachSlug: string;
  title: string;
  description: string;
  rules: string;
  whoCanPost: 'members' | 'moderators';
  memberCount: number;
  unreadCount: number;
};

type Post = {
  id: string;
  authorId: string;
  authorName: string;
  authorPhotoUrl: string | null;
  authorRole: 'coach' | 'moderator' | 'member';
  body: string;
  imageUrl: string | null;
  createdAt: string;
  reactions: { key: string; count: number; mine: boolean }[];
  hidden: boolean;
};

type Comment = { /* same shape minus image */ };
```

## Stripe / TGP-balance abstraction

A space is purchased via the same checkout flow
([03](./03-checkout-deposits-subscriptions.md)) as any other
offer. Space access can also be granted by a coach without
payment (e.g. as part of an existing program). From the user's
perspective: they see the space in their list once the
entitlement is granted; payment kind is invisible at the space
surface.

## Loading / error / empty states

- **SpaceListScreen empty:** "You're not in any spaces yet." with
  a link to the marketplace.
- **SpaceFeedScreen empty:** "Be the first to post." (if user
  can post) or "No posts yet — your coach will start the
  conversation."
- **SpaceMembersScreen loading:** skeleton rows.
- **Network error:** keep last good cache visible; toast the
  error.
- **Moderated post:** renders as "This post was hidden by a
  moderator." (visible only to the post's author and moderators
  in the queue).

## Accessibility

- Composer focusable from a clear header affordance, not relying
  on the floating action button alone.
- Reactions render a textual count and an `accessibilityLabel`
  including the reaction key (e.g. "Heart, 12 people").
- Long-press menu (flag / report) is mirrored as a visible "..."
  menu for users without long-press support.
- Image posts have alt text; if the author didn't provide one,
  the renderer prompts on submit.

## Analytics

- `space_viewed` — `{ spaceId }`
- `post_created` — `{ spaceId, hasImage: bool, bodyLength }`
- `post_viewed` — `{ spaceId, postId }`
- `comment_created` — `{ spaceId, postId, bodyLength }`
- `reaction_added` — `{ targetKind, key }`
- `flag_submitted` — `{ targetKind, reason }`
- `moderate_action` — `{ targetKind, action }`

No body content; lengths only.

## Feature flags / entitlements

- Flag: `features.spaces`. Off by default.
- Entitlement: `entitlements.spaces.create` (coach side, Pro/Studio).
- Per-space membership is itself an entitlement
  (`entitlements.space:<spaceId>`) granted by purchase or coach
  action.
- Team Mode: `roles.moderate_spaces` controls who in the team
  can act on the queue.

## Privacy / moderation

- Spaces are private to their members; mobile must not surface
  any space content to non-members. Server enforces; mobile
  treats a 403 as "not a member".
- Reporting / flagging is one-tap on any post or comment.
- Hidden content is removed from feed for non-moderators; the
  author sees it with a "hidden" indicator and can edit.
- Banning a member revokes the space entitlement immediately.
- Coach-authored rules markdown is moderated server-side on save.

## Rollout

1. Internal — one team space, no public exposure.
2. Add a moderation case (manual flag) and verify the queue
   end-to-end.
3. Flip on for the storefront ring; only paid `space` offers
   from those coaches surface; verify entitlement granting on
   purchase.
4. GA after notifications opt-in flow is verified with real
   push delivery.

## Tests

- Unit: reaction-state local merge (optimistic add/remove).
- Unit: feed cursor pagination dedup on refresh.
- Component: composer respects `whoCanPost`; hidden posts render
  correctly for author vs other members.
- Component: notification toggle persistence.
- Integration: purchase a space offer → space appears in list →
  post + comment → reaction → flag → moderator hides.
- Manual: ban flow on a real test account.

## Risks

- **Toxic content scaling.** A space with 500 members is the
  smallest unit where moderation effort matters. Backend
  ingest-time filters + a coach moderation queue are the v1
  defenses; if either lags, do not flip the flag for a coach
  with >100 members until it lands.
- **Notification fatigue.** Default-off opt-in is the safety
  net; do not auto-opt-in on join.
- **Cross-space search regression.** Out of scope, but if a
  coach later wants global search, the data model in v1 must
  not block it. Use stable post ids and per-space scoping in
  every read.
- **Reaction emoji drift.** Lock the closed set in the doctrine
  doc; do not let it grow per-coach in v1.

## Dependencies

- Backend #122 spaces / events service.
- `docs/expansion-wave-2/03` profile images.
- `docs/expansion-wave-2/07` messaging v2 (composer + list
  primitives).
- `docs/expansion/20` team mode (moderator role).
- [02-offer-builder](./02-offer-builder.md) (`space` offer kind).
- [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md)
  (purchase path).

## Acceptance criteria

- [ ] Flag off → no spaces surface; deep-links to a space route
      to "not available".
- [ ] Flag on → member can list, view feed, post (per
      `whoCanPost`), comment, react, flag.
- [ ] Coach can configure space, view queue, hide/restore, ban.
- [ ] Hidden posts visible only to author + moderators.
- [ ] Notifications default-off; opt-in per space delivers push.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- The first ban event will produce a support ticket. Coach-facing
  ban copy and member-facing "you can no longer access this
  space" copy must be reviewed with support before flipping the
  flag.
- Track median posts-per-week per space; spaces with zero coach
  posts in 4 weeks are likely candidates for a "kickstart" nudge
  to the coach (separate feature).
- The composer reuse in messaging v2 is non-negotiable; if it
  feels easier to fork, that's a sign messaging v2's composer
  needs a feature flag, not a fork.
