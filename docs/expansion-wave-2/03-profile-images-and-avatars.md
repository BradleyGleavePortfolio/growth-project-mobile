# 03 — Profile image / avatar flows

> Upload, crop, moderate, cache, and fall back. One pattern serves both client + coach. Identity-safe defaults: initials avatar until the user explicitly uploads.

## WHY

The current shipped surface uses initials-only avatars (the `Avatar` component renders a circle with two letters in `Inter_500Medium`). Coaches and clients have repeatedly asked to add a photo. Without a documented flow, the eventual implementation will reach for `expo-image-picker` and an arbitrary upload path, ending in (a) an iCloud-permissions trap on iOS, (b) a moderation gap that lets the wrong content sit in someone else's coaching surface, and (c) an unbounded image cache that bloats device storage. This brief specifies the smallest correct version: `expo-image-picker` → server-issued presigned URL → moderation queue → cache invalidation, with initials-avatar fallback intact.

## WHEN

- Phase 0 — flag `wave2_profile_image` defined, off everywhere. Initials avatar continues to ship.
- Phase 1 — coach-side upload only. Coach images appear in `ClientDetailScreen`, `ClientMessages`, and `MoreScreen` of the client side.
- Phase 2 — client-side upload. Client images appear in coach surfaces (`ClientsListScreen`, `ClientDetailScreen`, `ClientMessages`).
- Phase 3 — challenge / leaderboard avatars (only after brief 02 ships and only at the visibility scope brief 02 documents).
- Reasoning for coach-first: coach identity is already a public-facing thing (the "your coach" row in `MoreScreen` / `MembershipScreen`); client identity is only seen by their coach. Coach-first lets us validate the moderation pipeline against a smaller, higher-signal cohort.

## WHERE

- **No new screens.** Edits to existing screens only:
  - `src/screens/client/EditProfileScreen.tsx` — adds an avatar row to the existing form.
  - `src/screens/coach/SettingsScreen.tsx` — adds the same row in the "Business profile" section.
  - `src/components/Avatar.tsx` (existing) — extends to render a remote image with the initials fallback.
- New helper: `src/services/avatarUpload.ts` — orchestrates picker → presigned URL → POST → cache invalidate.
- New endpoint namespace under `src/services/api.ts`: `mediaApi` (presigned URL grant + delete-self).

## WHO

| Role | Can upload | Can see whose avatar |
| --- | --- | --- |
| Client | Own | Own + assigned coach |
| Coach | Own | Own + own clients |
| Junior coach (Team Mode) | Own | Own + clients shared by head coach |
| Signed-out | None | None (initials in marketing surfaces only) |

A user can never see another user's avatar **outside the tenancy graph**. Two clients of the same coach do not see each other's avatars unless they appear together on a leaderboard (brief 02), and even then the rendering rule for the leaderboard is "no avatars on leaderboard rows in v1" — text-only display name, by design, to reduce comparison surface.

## WHAT

### Asset pipeline (mobile expectation)

```
ImagePicker
  ↓ (jpeg/png, max 4096×4096, max 12 MB)
Local crop to 1:1 (expo-image-manipulator)
  ↓ (jpeg, ≤1024×1024, quality 0.85, max ≈300 KB)
POST /me/avatar/presign        → { url, fields, key, expiresAt }
PUT to presigned URL with FormData
POST /me/avatar/commit         → { avatarUrl, version }
React Query: invalidate ['me'], ['coach','clients'] (coach side), broadcast 'avatar_updated' on realtime
```

The mobile client never holds an S3 / R2 / GCS key directly. The presigned URL pattern lets the backend rotate storage providers without a mobile change. Backend stores the moderation status alongside the version; mobile's render path only ever uses `avatarUrl` (already-moderated, public read).

### Local crop UX

- 1:1 enforced — no rectangular crops in v1; the avatar is always rendered in a circle.
- A "RESET" affordance restores the default initials avatar. Server soft-deletes the image (sets `avatar_version: null`).
- Re-uploading is the same flow; old image is garbage-collected server-side after 30 days.

### Moderation contract

- Server runs an automated moderation pass on every commit (e.g. NSFW/violence model). Mobile expectation is: `POST /me/avatar/commit` is **synchronous** and may return:
  - `200 { avatarUrl, status: 'approved', version }` — render normally.
  - `202 { status: 'pending', version }` — render initials avatar locally; poll `/me/avatar/status` once on next app foreground.
  - `409 { status: 'rejected', reason: 'nsfw' | 'violence' | 'other' }` — show inline rejection copy on the editor; user can pick a different image. Reason copy is human-readable; mobile does not surface the raw category to the user.
- A second-pass human review path is server-only; mobile shows whichever status the server reports.

### Caching

- All remote avatars use `expo-image` (not `Image`) for built-in disk + memory caching with stale-while-revalidate.
- The `avatarUrl` is versioned (`...?v=12`). When the user updates, the version bumps and `expo-image` fetches anew without a manual cache-bust.
- Cache size cap (per `expo-image`): 50 MB disk, 50 MB memory. No further mobile-side cap needed.

## HOW

### Avatar component contract

```tsx
<Avatar
  user={{ id, displayName, avatarUrl, avatarVersion }}
  size="sm" | "md" | "lg" | "xl"           // sm=24, md=40, lg=56, xl=96
  ring="none" | "founding"                  // founding = camel hairline only (doctrine §6)
  accessibilityLabel="Avatar of {displayName}"
/>
```

Behaviour:

1. If `avatarUrl` present → `<Image>` with placeholder = initials.
2. If `avatarUrl` absent or fails to load → initials.
3. `ring="founding"` shows a 1px camel hairline. **No glow, no gradient, no animated ring.**
4. The component never renders a fallback emoji or external icon for "unknown user". Initials only.

### Screens / navigation sketch

```
EditProfileScreen
  ┌─ Existing fields ─────────────────┐
  │ Name                              │
  │ Pronouns                          │
  │ Bio                               │
  ├─ NEW: Avatar row ─────────────────┤
  │ <Avatar size="lg" /> CHANGE ▸     │
  └───────────────────────────────────┘
        │ tap CHANGE
        ▼
  Action sheet: Take photo · Choose from library · Reset to initials · Cancel
        │
        ▼
  Picker → Crop → Confirm → Upload (with progress bar)
        │
        ▼
  On success: updated Avatar replaces row, toast confirms.
  On rejection: inline error explains which category; "Try again" affordance.
```

Coach-side `SettingsScreen` repeats the same row in the "Business profile" section.

### API contract

| Method | Path | Purpose | Response codes |
| --- | --- | --- | --- |
| `POST` | `/me/avatar/presign` | Get a presigned URL bound to my user | 200 / 401 |
| `PUT` | (presigned URL) | Upload bytes | 200 / 4xx storage errors |
| `POST` | `/me/avatar/commit` | Confirm upload + run moderation | 200 / 202 / 409 / 4xx |
| `GET` | `/me/avatar/status` | Poll if pending | 200 |
| `DELETE` | `/me/avatar` | Reset to initials | 200 |
| `GET` | `/users/:id` (existing, extended) | Now includes `avatarUrl`, `avatarVersion` |

Versioning per `docs/platform-readiness/09-api-contract-compatibility.md`: `X-Capability: avatar`. Backend that does not know about avatars returns 404 on presign; mobile silently hides the avatar editor row (initials-only continues to ship).

### Permissions

- iOS: `NSPhotoLibraryUsageDescription` + `NSCameraUsageDescription` strings updated in `app.json` **by the implementation PR, not this docs PR**. Strings: "We use your photos to set your profile image." + "We use your camera to take a profile image."
- Android: `READ_MEDIA_IMAGES` (SDK 33+) / `READ_EXTERNAL_STORAGE` (older) — Expo handles via `expo-image-picker` plugin config.
- Permission denial path: action sheet shows "Choose from library" disabled with sub-copy "Allow photo access in Settings." Camera the same. The "Reset to initials" option remains enabled regardless of permission state.

### Accessibility

- Action sheet items have `accessibilityRole="button"`.
- The avatar row's `accessibilityHint` reads "Tap to change profile image."
- Upload progress is exposed as `accessibilityValue={{ now: percent, min: 0, max: 100 }}` on a `progressbar`-roled view.
- Crop screen pinch/pan uses `react-native-gesture-handler`; an alternative slider control is provided for users who can't pinch (accessibility requirement).
- Initials fallback is never the *only* representation of identity — the displayName is also rendered next to the avatar wherever space allows.
- Default font scale to 1.6× must not break the avatar+name row.

### Loading / error / empty states

- **Loading (uploading)**: progress bar inline on the row. No full-screen modal.
- **Empty (no avatar)**: initials. No "Add photo" call-to-action splash — the editor row is the only nudge, and it is restrained.
- **Error (network)**: "Upload failed. Try again." — preserves the cropped image in memory so the retry doesn't re-pick.
- **Error (rejected)**: human-readable copy per category. No mention of model name or score.
- **Error (file too big)**: caught locally in the crop step before upload; copy: "Image is too large. Try a smaller photo."
- **Offline**: editor row is disabled; copy: "You're offline. Photo updates need a connection."

### Privacy / moderation

- Default state is **no photo**. The product does not nag users to add one.
- Avatars are *public to the tenancy graph* once approved (a coach's clients can fetch the coach's avatar; a coach can fetch their own clients' avatars). They are not in any sense globally public unless brief 02 / brief 16 (PR #92) `public-coach-profile` references them — and brief 16 already specifies its own opt-in.
- Reset path is destructive; confirmation modal copy: "Remove your photo? Your initials will appear instead." Single-tap confirm.
- Coach cannot upload a client's photo. Server enforces; mobile never surfaces an "upload for client" affordance.
- Reporting another user's avatar: long-press in coach surfaces opens "Report this avatar" → server endpoint records + queues human review. Same shape as brief 04's report flow.
- Avatars are *not* attached to outgoing share-sheet content (`InviteCodesScreen` share text remains text-only).

### Feature flags / entitlements

- `wave2_profile_image` (PostHog) — top-level. Default off.
- `wave2_profile_image.client_upload` — Phase 2 gate, separate flag.
- No L2/L3 entitlement on basic avatar upload; this is table-stakes identity, not a premium feature. Custom-shape avatars or animated avatars (post-MVP, if ever) would be entitlement-gated, not flag-gated.

### Analytics events

| Event | Properties | Where |
| --- | --- | --- |
| `wave2_avatar_change_open` | `role` | Action sheet open |
| `wave2_avatar_upload_started` | `source: 'camera' \| 'library'`, `bytes_bucket` | Upload begin |
| `wave2_avatar_upload_succeeded` | `bytes_bucket`, `duration_bucket_ms` | Commit 200 |
| `wave2_avatar_upload_pending` | (no body) | Commit 202 |
| `wave2_avatar_upload_rejected` | `reason` | Commit 409 |
| `wave2_avatar_reset` | (no body) | Reset action |

No image bytes, hashes, or URLs are sent to PostHog. Sentry breadcrumbs may include the *URL* of the avatar (already public to the tenancy graph) but never the upload bytes.

### Rollout

1. Avatar component update lands behind flag in shipped builds (renders identically until flag flips).
2. Backend deployed; presign/commit/status/delete all live in staging.
3. Flag on for coach lead account in production. Verify upload, reset, rejection paths.
4. Flag on for paid pilot coach.
5. Phase 2: client upload flag on for the same pilot coach's clients.
6. Wider release.
7. Rollback: flag off → editor row disappears → existing avatars continue to render (server still serves them; that's intentional and fine).

### Tests

- **Unit**: `avatarUpload.ts` orchestration — picker cancel, presign 4xx, PUT 5xx, commit 409 all map to the documented UI states.
- **Unit**: `Avatar` component — initials path, ring=founding path, image-load-failure fallback.
- **Hook**: `useAvatar(userId)` returns the right `avatarUrl` from cache and bumps version on broadcast.
- **Component (RNTL)**: action sheet items, permission-denied disabled state.
- **Component**: long-press report flow on coach surfaces.
- **Snapshot at scale=1.6×**: avatar+name row.
- **Integration manual**: iOS photo library, iOS camera, Android photo library, Android camera; permission denied flows on each.
- **Manual moderation drill**: upload an obviously NSFW test image (in a controlled QA environment) → expect 409 with `reason: 'nsfw'` → expect inline rejection copy.

### Risks

| Risk | Mitigation |
| --- | --- |
| User uploads and the moderation pipeline is slow → user sees pending forever. | 202 path is documented; client polls once on foreground; if still pending after 24 h, server flags for human review and mobile shows initials in the meantime. |
| Permission grant is denied; user thinks the feature is broken. | Disabled state with sub-copy "Allow photo access in Settings." |
| Old image survives in tenancy after reset. | Server soft-deletes immediately; coach surfaces invalidate via realtime broadcast. |
| iOS bundle size grows (image manipulator). | `expo-image-manipulator` is already in transitive use. The follow-up implementation PR validates `+0` MB on `eas build` size diff. |
| User selects a HEIC photo (iOS); server can't process. | `expo-image-manipulator` re-encodes to JPEG before upload; HEIC never leaves the device. |
| Coach impersonates a client by uploading a photo of them. | Client opt-out: a "Hide photos of me" preference (out of scope for v1; flagged as a follow-up). v1 mitigation: no inbound report ever loses; coach upload of client photos is server-blocked. |
| Avatar loaded over HTTP not HTTPS. | `expo-image` enforces HTTPS in production builds via `app.json` ATS settings (already set; not touched by this docs PR). |

### Dependencies

- `expo-image-picker` (already a dep), `expo-image-manipulator` (already transitive — implementation PR confirms direct add or reuse).
- Backend moderation service. Without it, this brief should not ship; the alternative ("ship without moderation, add later") is explicitly rejected here.
- **PR #93 `docs/platform-readiness/05-reusable-expansion-ui-patterns.md`** — the `Avatar` primitive lives in the named-primitive set.
- **PR #92 `docs/expansion/16-public-coach-profile.md`** — the public coach profile is one of the consumers of coach avatars; that brief's avatar requirement is satisfied by this brief.
- **`docs/HANDOFF.md` §4 (auth)** — JWT identity is the source for `userId`.

### Acceptance criteria

- A coach can upload, crop, and commit an image; an initials avatar replaces it on reset; a rejected upload surfaces a human-readable reason inline.
- The `Avatar` component renders identically to today's design when no `avatarUrl` is present.
- Disk cache stays under `expo-image`'s default cap; no manual cache-clearing UX is needed.
- Permission denial on iOS / Android shows the documented disabled state, not a crash.
- Sentry shows no `surface: 'wave2.avatar'` errors in a 7-day pilot window.
- Initials fallback works in every place avatars render — including offline and cold-start.

### Operator handoff

- **Owning surface**: mobile lead. Backend = backend lead (storage + moderation). Trust review = security/trust lead.
- **Out-of-band steps**: PostHog flags created (`wave2_profile_image`, `wave2_profile_image.client_upload`). Storage bucket lifecycle policy (30-day garbage collection of replaced versions) configured. Moderation provider account active in staging. iOS / Android permission strings drafted and reviewed before the implementation PR (not changed by this docs PR).
- **"Done" means**: pilot coach + pilot clients can upload, reset, and re-upload over a 2-week window without support contact; moderation pipeline rejects a known-bad test image inside ≤30s; zero `surface: 'wave2.avatar'` Sentry errors.
