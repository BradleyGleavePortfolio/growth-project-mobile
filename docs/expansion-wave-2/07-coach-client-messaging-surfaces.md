# 07 — Coach ⇄ client messaging surfaces

> Extension of the existing 1:1 thread (`MessagesScreen` / `ClientMessagesScreen`) with attachments, voice notes, broadcast (1:N), pinned messages, read receipts, and improved offline behaviour.

## WHY

The existing surface ships today (`src/screens/client/MessagesScreen.tsx`, `src/screens/coach/ClientMessagesScreen.tsx`, with realtime via `subscribeToMessages` + 60 s safety poll). It is text-only, single-pair, and has no broadcast surface. Coaches end up routing PDFs through `coachApi.postGuidelines`, voice notes through external apps, and "the same message to ten clients" through manual copy-paste. Each workaround introduces a tracking gap (PDFs and voice notes don't appear in the message timeline) and a labour gap (broadcast is N×O(send)). This brief extends the existing surface — it does **not** introduce a new chat product.

## WHEN

- Phase 0 — flag `wave2_messaging_v2` defined, off everywhere; current text-only surface ships unchanged.
- Phase 1 — image + PDF attachments, read receipts, "delivered" state.
- Phase 2 — voice notes (≤ 2 minutes).
- Phase 3 — broadcast 1:N from coach to a client cohort or assignment-cohort.
- Phase 4 — pinned messages (one per thread).
- This brief is independent of brief 01 / 04 / 05 / 06; it can ship in parallel after the existing realtime stack is hardened (see Risks).

## WHERE

- Extends `src/screens/client/MessagesScreen.tsx` and `src/screens/coach/ClientMessagesScreen.tsx`.
- New screen: `src/screens/coach/BroadcastComposeScreen.tsx` — the 1:N composer.
- New screen: `src/screens/coach/BroadcastDetailScreen.tsx` — read-receipt visibility per recipient.
- No new client screens.
- Reachable from:
  - Coach: existing `MessagesScreen` (inbox) gets a "BROADCAST" affordance in the header.
  - Client: existing `MessagesScreen` for inbound broadcasts; broadcasts render *as a regular message* with a small "Broadcast" badge.

## WHO

| Role | Can send 1:1 | Can send broadcast | Can pin | Can attach |
| --- | --- | --- | --- | --- |
| Coach (head) | Own clients | Own clients | One per thread | image / PDF / voice |
| Junior coach (Team Mode) | Shared clients | Only if `messages.broadcast` capability granted | Yes for shared threads | Yes |
| Client | To assigned coach | No | No | image / voice (no PDF in v1) |
| Anyone else | No | No | No | No |

## WHAT

### Message shape (extended)

```ts
type MessageId = string;
type MessageKind = 'text' | 'image' | 'pdf' | 'voice' | 'system';

interface Message {
  id: MessageId;
  threadId: string;            // coach-client pair id
  senderId: string;
  kind: MessageKind;
  text: string | null;         // body for text; caption for image/voice; null for system
  attachment: MessageAttachment | null;
  broadcastId: string | null;  // non-null for messages spawned from a broadcast
  pinned: boolean;
  deliveredAt: string | null;
  readAt: string | null;
  editedAt: string | null;     // v1: not supported (always null); reserved
  createdAt: string;
}

interface MessageAttachment {
  kind: 'image' | 'pdf' | 'voice';
  url: string;                 // public-read once moderated; presigned otherwise
  bytes: number;
  durationSec: number | null;  // voice only
  thumbUrl: string | null;     // image / pdf-cover only
  width: number | null;        // image only
  height: number | null;       // image only
}

interface Broadcast {
  id: string;
  coachId: string;
  audience: { kind: 'all_clients' } | { kind: 'cohort'; clientIds: string[] } | { kind: 'assignment_subject'; subjectKind: 'program' | 'challenge'; subjectId: string };
  message: Pick<Message, 'kind' | 'text' | 'attachment'>;
  createdAt: string;
  recipients: Array<{ clientId: string; messageId: MessageId; readAt: string | null }>;
}
```

### Realtime / offline contract

- Existing pattern: Supabase realtime broadcast channel + 60 s safety poll. Extended to fan out attachment-bearing messages and broadcasts.
- Outgoing messages queue locally (mirroring `services/foodLogQueue.ts`) when offline. Queue retries on reconnect with idempotency key (`clientLocalId`) so a slow ack doesn't double-send.
- Voice note recording continues offline; upload happens when online.
- Read-receipt is best-effort; mobile does not retry indefinitely if a `markRead` request fails.

## HOW

### Screens / navigation sketch

```
ClientMessagesScreen / MessagesScreen (existing, extended)
  ├── Header: peer name, presence ("Last seen 12m ago" — opt-in only)
  ├── Pinned message banner (if any)
  ├── Thread (FlashList, inverted)
  │     ├── Text bubble (existing)
  │     ├── Image bubble — tap to open viewer
  │     ├── PDF bubble — tap to open in PDF reader (brief 04 component)
  │     ├── Voice bubble — inline play button + waveform; tap-and-hold for speed
  │     └── System message — neutral row ("Bradley pinned a message")
  ├── Composer
  │     ├── Text input
  │     ├── + attach (image / PDF / voice) — long-press composer = voice
  │     └── Send
  └── Long-press a message: Pin · Unpin · Copy · Report (client only) · Delete-for-everyone (sender only, ≤5 min)

BroadcastComposeScreen (coach)
  ├── Audience selector (all / cohort / by assignment subject)
  ├── Compose (same components as 1:1)
  ├── Preview: "Will reach 12 clients."
  └── Send → fans out 1:N

BroadcastDetailScreen (coach)
  ├── Sent at, audience description
  ├── Per-recipient read state
  └── "Resend to unread" affordance (Phase 4)
```

### API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/threads/:peerId/messages` | Existing; extended to return new `kind` values. |
| `POST` | `/threads/:peerId/messages` | Existing; body extended. Backwards-compatible. |
| `POST` | `/messages/attachment-presign` | Body: `{ kind: 'image'|'pdf'|'voice', bytes, durationSec? }`. Returns presigned URL. |
| `POST` | `/threads/:peerId/messages/:id/pin` | Coach pin. |
| `POST` | `/threads/:peerId/messages/:id/unpin` | Coach unpin. |
| `POST` | `/threads/:peerId/messages/:id/report` | Either side reports. |
| `DELETE` | `/threads/:peerId/messages/:id` | Sender deletes within 5 min. |
| `POST` | `/coach/broadcasts` | Create + fan-out. |
| `GET` | `/coach/broadcasts/:id` | Read-state per recipient. |

Versioning: `X-Capability: messaging-v2`. A mobile build without this capability still receives the legacy text shape (server omits the new fields).

### Media upload UX (per attachment kind)

**Image**
- `expo-image-picker` → image manipulator (≤2048×2048, JPEG quality 0.8) → presign → PUT.
- Inline progress in the bubble; cancel by tap-and-hold.
- Image viewer on tap: pinch-zoom (`react-native-reanimated`), share, save (`expo-media-library`).

**PDF**
- `expo-document-picker` → presign → PUT (max 25 MB for messages, smaller than brief 04's 50 MB cap because it's a private send).
- Tap opens the brief 04 PDF reader.

**Voice**
- `expo-av` `Audio.Recording`. Press-and-hold the microphone; release to send (or swipe-up to lock for hands-free).
- Max 2 minutes; soft cap at 90 s with a header copy "Keep it under 2 minutes."
- Generated waveform (downsampled amplitudes) bundled into the upload payload to avoid a server-side decode.
- Playback: tap to play, tap-and-hold for speed sheet (1.0× / 1.25× / 1.5× / 2.0×).

### Accessibility

- Voice messages have a `accessibilityLabel="Voice message, {duration}, from {sender}"` and `accessibilityRole="button"`; double-tap plays.
- Auto-transcription (Phase 4) of voice notes for accessibility — backend job, surfaced as a "Show transcript" affordance. Out of scope for v1; flagged.
- Image bubbles include a `accessibilityHint="Tap to view full image"`.
- Long-press menu reachable via accessibility actions.
- Reduce-motion respected for the bubble enter animation (currently a 1-frame fade in the existing screen; extending it should not violate that).
- Default font scale to 1.6× must keep all bubble types readable; voice-bubble waveform is decorative (not announced).

### Loading / error / empty states

- **Loading thread**: existing shimmer extended to 3-bubble skeleton.
- **Empty thread**: existing copy preserved ("Start a conversation with your coach.").
- **Sending state**: bubble shows tick-state — sending (spinner) → sent (single tick) → delivered (double tick) → read (filled tick). No emoji.
- **Failed send**: bubble shows a small alert dot + tap-to-retry.
- **Offline**: top `OfflineBanner`; outgoing bubbles render with sending state and replay on reconnect.
- **Broadcast empty audience**: editor disables Send with copy "No recipients in this audience."

### Privacy / moderation

- All attachments are **server-moderated synchronously** (NSFW + violence + malware for PDF) before fan-out. A rejected attachment surfaces inline on the sender side; the recipient never sees a transient bubble.
- Voice messages: no automated content moderation in v1 (server scans for known-malicious audio formats, not content). Reporting + manual review is the recourse.
- A pinned message is visible to both parties and persists across thread reload.
- "Delete-for-everyone" within 5 minutes is best-effort: on the recipient side a system message replaces the bubble — "Bradley deleted a message." We do not pretend the message was never seen.
- Report flow is one tap from long-press; recipient can block sender (out of scope for v1; backlog item).
- **Coach access to client photos via image attachments** is the same as if the client emailed them — there is no extra storage on the client device beyond the cache. The Trust Center docs (`docs/well-known/`) need an update before image attachments ship; flagged.
- Junior-coach impersonation: server tags every outbound message with `senderId`; junior coach cannot send "as the head coach" — their identity is the sender.

### Feature flags / entitlements

- `wave2_messaging_v2` (PostHog) — top-level. Default off.
- `messaging_v2.attachments` — Phase 1.
- `messaging_v2.voice` — Phase 2.
- `messaging_v2.broadcast` — Phase 3 (entitlement: L2+ for coach; junior coach also requires `messages.broadcast` capability).
- `messaging_v2.pinned` — Phase 4.

### Analytics events

| Event | Properties | Where |
| --- | --- | --- |
| `wave2_msg_attach_sent` | `kind`, `bytes_bucket`, `from_role` | Composer send |
| `wave2_msg_attach_failed` | `kind`, `reason_code` | Send failure |
| `wave2_msg_voice_record` | `duration_bucket_sec` | Voice send |
| `wave2_msg_play` | `kind` | Recipient play |
| `wave2_msg_pin` | (no body) | Pin action |
| `wave2_msg_report` | `kind` | Report |
| `wave2_msg_delete` | `kind`, `seconds_after_send_bucket` | Delete-for-everyone |
| `wave2_broadcast_sent` | `audience_kind`, `recipient_count_bucket`, `kind` | Broadcast send |
| `wave2_broadcast_read_pct` | `pct_bucket`, `hours_after_send_bucket` | Periodic re-emit |

No message text, no attachment URLs, no client / coach IDs.

### Rollout

1. Server adds new fields to existing endpoints in a backwards-compatible way. Mobile on `main` continues to work.
2. `wave2_messaging_v2` on for internal coach + their internal-test client. Image first, PDF second.
3. Voice flag flipped after a recording-permission drill on iOS / Android.
4. Broadcast flag flipped only after L2+ entitlement is wired (brief 09).
5. Pinned messages last (lowest-impact, lowest-priority).
6. Rollback: per-feature flags off → composer affordances disappear; thread continues to render existing messages plus new ones in their text-fallback form (e.g. an image becomes "[image — open in newer build]" copy).

### Tests

- **Unit**: `messagingApi` shape; idempotency on retry (send same `clientLocalId` twice → server returns the existing row, not a duplicate).
- **Unit**: voice waveform downsampling produces deterministic output for a known input.
- **Hook**: `useThread(peerId)` Loading/Empty/Error/Data with realtime updates.
- **Component (RNTL)**: bubble variants render; long-press menu items appear per role.
- **Component**: composer attach flow (image, PDF, voice) with permission states.
- **Component**: broadcast composer audience selector.
- **Snapshot at scale=1.6×**: image, PDF, voice bubble.
- **Manual**: send an image while offline; reconnect; bubble shows correct sequence.
- **Backend contract**: messages without `X-Capability: messaging-v2` see legacy text shape and ignore unknown kinds.

### Risks

| Risk | Mitigation |
| --- | --- |
| Realtime stack instability under attachment fan-out. | Phase rollout: 1:1 attachments first, broadcast last. Per-flag rollback. Sentry alert on `surface: 'wave2.messaging'` error rate. |
| Voice messages become a primary channel — accessibility regressions. | Transcript stub planned (Phase 4); long voice notes off by default (>90 s warning). |
| Coach uses broadcast as a marketing tool to *prospects*, not their clients. | Audience options are coach's own clients only; cohort / assignment-subject only narrow further. There is no "everyone who has installed the app" audience. |
| Recipient count surprise on broadcast. | Preview line ("Will reach 12 clients.") is mandatory before send; large broadcasts (>50) require a confirm modal. |
| Storage cost of voice notes / images / PDFs. | Bucket lifecycle: 365-day retention by default; per-tenant override controlled by tier (L3 retains longer). Coach-side TrustCenter shows total storage. |
| Doctrine drift: someone reaches for emoji reactions. | This brief explicitly excludes emoji reactions. v1 has no reactions. |
| Pinned message becomes stale and contradicts a current program. | Pinning sets `pinnedAt`; UI shows "Pinned 23 days ago" as a soft prompt to re-pin. |

### Dependencies

- Brief 03 (avatar pattern) — header peer avatar.
- Brief 04 (PDF reader, content board moderation pipeline reuse).
- Brief 06 (assignment-subject audience option).
- Brief 09 (L2+ entitlement on broadcast).
- PR #93 `docs/platform-readiness/02-feature-flag-consumption.md` — feature-flag rollout pattern.
- PR #93 `docs/platform-readiness/07-loading-error-empty-states.md` — `AsyncBoundary` reused.
- `expo-av`, `expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-media-library`, `react-native-reanimated`, `@shopify/flash-list`. Implementation PR adds these; this docs PR does not modify `package.json`.

### Acceptance criteria

- A coach can send an image, PDF, and voice note to one client; the client receives them with delivery + read state.
- A coach can broadcast to a cohort; per-recipient read state is visible on `BroadcastDetailScreen`.
- An offline send appears in queue and replays on reconnect, never duplicating.
- A pinned message survives thread reload and a fresh login.
- Sentry shows zero `surface: 'wave2.messaging'` errors over a 7-day pilot.

### Operator handoff

- **Owning surface**: mobile lead; messaging is cross-cutting client + coach. Trust lead reviews moderation pipeline.
- **Out-of-band steps**: PostHog flags created (5); storage bucket lifecycle policy configured (365-day retention default + tier override); Stripe / entitlement metadata supports `messages.broadcast`; Trust Center docs updated for image attachments before flag flips.
- **"Done" means**: pilot coach uses each new affordance once with each pilot client, sends one broadcast to a cohort of 5, sees expected read receipts; zero unhandled Sentry errors over 7 days.
