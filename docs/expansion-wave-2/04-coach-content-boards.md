# 04 — Coach content boards (PDFs, newsletters, videos, links)

> A per-coach board of curated resources (PDFs, plaintext newsletters, video links, external links). Coaches publish; clients consume. Optional per-client visibility scoping.

## WHY

Coaches today route resources through messaging — they paste a PDF link or a YouTube URL into a 1:1 thread. That works for one client and decays for ten. Without a content surface, the same PDF gets pasted N times, version drift creeps in, and clients who join after the resource was sent never see it. A first-class content board solves this with a single source per coach, with explicit visibility, version tracking, and a doctrine-clean reading surface.

## WHEN

- Phase 0 — flag `wave2_content_boards` defined, off everywhere.
- Phase 1 — coach-side authoring + global-to-cohort visibility (every client of the coach sees the same items).
- Phase 2 — per-client visibility filters (some items pinned to assignments — see brief 06).
- Phase 3 — newsletter editing inside the app (markdown) instead of upload-only PDFs.

## WHERE

- New screen: `src/screens/coach/ContentBoardScreen.tsx` — coach authoring + listing.
- New screen: `src/screens/coach/ContentItemEditorScreen.tsx` — per-item edit.
- New screen: `src/screens/client/ContentBoardClientScreen.tsx` — read surface.
- New screen: `src/screens/client/ContentItemReaderScreen.tsx` — PDF / video / link reader.
- Reachable from:
  - Coach: `CoachNavigator → Templates tab` ("Content board" row at the top of `ProgramTemplatesScreen`).
  - Client: `MoreScreen` → "Coach resources" row, hidden when no items exist *and* flag is off.
- Deep links: `tgp://content/<itemId>` and `https://app.trygrowthproject.com/content/<itemId>`.

## WHO

| Role | Can see board | Can author |
| --- | --- | --- |
| Coach (head) | Their own | Yes |
| Junior coach (Team Mode) | Head coach's board (read) | Only if granted `content.author` capability |
| Client | Their assigned coach's board, filtered by visibility | No |
| Signed-out (deep link) | Auth gate first; no preview | No |

## WHAT

### Item types

```ts
type ContentItemType = 'pdf' | 'video' | 'link' | 'newsletter';

type ContentVisibility = 'cohort' | 'assigned' | 'private_draft';
// cohort        -> every client of the coach
// assigned      -> only clients linked via brief 06 (per-client-assignment)
// private_draft -> coach preview only

interface ContentItem {
  id: string;
  coachId: string;
  type: ContentItemType;
  title: string;            // ≤120 chars
  summary: string | null;   // ≤300 chars (the editorial subtitle)
  body: string | null;      // markdown for type='newsletter' only
  pdfKey: string | null;    // S3 key (server-owned), only when type='pdf'
  videoUrl: string | null;  // only when type='video'; YouTube/Vimeo/HLS
  externalUrl: string | null;
  thumbnailUrl: string | null;  // optional; auto-derived for video, optional for others
  visibility: ContentVisibility;
  pinnedToAssignmentId: string | null;  // brief 06 link
  publishedAt: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
```

### What the board renders

The list is editorial, not a tile grid. One large hero row pinned (`Latest`) + a vertically scrolled list grouped by type. Each row:

```
┌──────────────────────────────────────────┐
│ [thumb 56×56]  Title                     │
│                Summary line              │
│                Type · Updated 3d ago     │
└──────────────────────────────────────────┘
```

No emoji icons. The leading 24×24 type icon is from `Ionicons` (e.g. `document-text-outline` for PDF, `play-circle-outline` for video, `link-outline` for link, `mail-outline` for newsletter).

## HOW

### Screens / navigation sketch

```
CoachNavigator → Templates tab
  └── ProgramTemplatesScreen
        └── "Content board" row
              └── ContentBoardScreen
                    ├── Header: "Resources for your clients"
                    ├── Filter chips: All · PDFs · Videos · Links · Newsletters · Drafts
                    ├── List
                    └── + new (FAB-equivalent placed inline in header — no global FAB per doctrine §6)
                        └── ContentItemEditorScreen
                              ├── Type selector (one of four)
                              ├── Title, Summary, Body (newsletter) or URL (video/link) or Upload (pdf)
                              ├── Visibility selector
                              ├── Pin to assignment (optional, brief 06)
                              └── Publish / Save as draft

ClientNavigator → Profile → MoreStack
  └── "Coach resources" row
        └── ContentBoardClientScreen
              ├── Pinned (most recent published)
              ├── Grouped list
              └── ContentItemReaderScreen
                    ├── PDF: react-native-pdf or expo-document inline; download fallback
                    ├── Video: in-app player (expo-av) for HLS, web fallback for YouTube/Vimeo
                    ├── Link: opens in expo-web-browser in-app sheet
                    └── Newsletter: markdown render via react-native-markdown-display
```

### API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/coach/content-items` | Coach's board (all visibilities). |
| `POST` | `/coach/content-items` | Create. |
| `PATCH` | `/coach/content-items/:id` | Edit. |
| `POST` | `/coach/content-items/:id/publish` | Move from draft → published. |
| `POST` | `/coach/content-items/:id/archive` | Hide from clients. |
| `POST` | `/coach/content-items/pdf-presign` | Get presigned PDF URL (mirror of brief 03 avatar pattern). |
| `GET` | `/me/content-items` | Client view: published items visible to me. |
| `POST` | `/me/content-items/:id/viewed` | Per-client read receipt. |
| `POST` | `/me/content-items/:id/report` | Client reports an item (privacy/abuse). |

Versioning: `X-Capability: content`. Backend returns 404 → mobile hides the entry rows. Clients on stale builds gracefully ignore unknown `type` values (defensive: render a "Open externally" row with a link to a generic web fallback).

### Media upload UX (PDFs)

- `expo-document-picker` to pick the PDF.
- Max 50 MB, max 200 pages (server-validated; mobile pre-checks file size before upload).
- Upload flow mirrors brief 03's avatar pattern: presign → PUT → commit.
- Inline progress bar; cancellation supported.
- On 4xx (too big, wrong MIME): inline copy "PDFs must be under 50 MB and have a .pdf extension."
- The PDF is *not* embedded in the response payload — clients fetch via `expo-file-system` to the cache directory and render from disk for offline reads.

### Video links

- v1 accepts: YouTube (parsed for `vId`), Vimeo (parsed for vid), HLS `.m3u8` URLs, MP4 hosted on the coach's domain.
- Other URLs are *rejected at submit* with copy "Paste a YouTube, Vimeo, or .mp4/.m3u8 link." (Server validates; mobile pre-validates.)
- HLS streams use `expo-av` `Video` component (the coach can host their own).
- YouTube/Vimeo use `expo-web-browser` in-app sheet — **no third-party YouTube/Vimeo SDK** (avoids native deps, avoids Play Store policy creep).

### Newsletters (markdown)

- Body field accepts markdown subset: headings, bold/italic, links, lists, blockquotes, fenced code (rare for fitness, but harmless).
- Preview tab in editor.
- Render via `react-native-markdown-display`.
- No HTML, no inline scripts (server strips via DOMPurify-equivalent).
- Images-in-markdown reference URLs already on the server (no inline-image upload from inside the newsletter editor — keep the upload surface to brief 03 + the PDF flow).

### Accessibility

- Reading surface (`ContentItemReaderScreen`): respects font scale up to 2.0×; markdown + summary scale.
- PDFs use `react-native-pdf` accessibility pass-through where the PDF includes structure tags. Untagged PDFs surface a banner: "This PDF may not be screen-reader friendly." (Not a hard block.)
- Video: closed captions are *displayed* when the source has them; no in-app caption authoring in v1.
- Link rows announce as "Link to {summary}, opens in browser."
- Editor's type selector is a `radiogroup` with three `radio` children.
- Default scale 1.6× must not clip the editor.

### Loading / error / empty states

- **Loading list**: 3-row shimmer.
- **Empty (coach, none authored)**: "Resources you publish appear here. Pick a type to start." with three CTAs (PDF / Video / Link / Newsletter — four, actually).
- **Empty (client, none assigned)**: "Your coach hasn't shared resources yet."
- **Error**: human-language error, retry. Sentry tag `surface: 'wave2.content'`.
- **Offline**: cached list shown; PDFs already downloaded readable; videos/HLS show "You're offline — connect to play this video."
- **PDF download in progress**: progress bar in the row + on the reader screen.

### Privacy / moderation

- All content is *coach-authored*. The pipeline therefore needs less aggressive moderation than user-uploaded photos (brief 03), but still:
  - PDF / link / video URL is **scanned for known-malicious patterns** server-side at publish time. A hit returns 409 with a human-readable reason; coach edits and re-publishes.
  - PDF text is **not** scanned for content moderation in v1; the assumption is that coaches are accountable, paying users.
  - External links open in `expo-web-browser` in-app sheet; the URL is shown to the user before they tap (preview) so they know where they're going.
- **Reporting**: client can report an item via `POST /me/content-items/:id/report`. The server records + alerts the trust lead; the report does not auto-hide content.
- **Tenancy**: a client can only fetch items where their coachId matches the item's coachId. Server-enforced; mobile never asks for "all content".
- **Tier note**: founding-member clients have no different visibility — the founding accent is purely visual per doctrine §6.

### Feature flags / entitlements

- `wave2_content_boards` (PostHog) — top-level.
- `wave2_content_boards.author` — entitlement (L2+ only). L1 coaches see the read surface for *their own* test board, but cannot publish to clients.
- `wave2_content_boards.newsletter` — flag-gated separately so the markdown surface can be disabled if it causes review issues.
- `wave2_content_boards.assigned_visibility` — Phase 2.

### Analytics events

| Event | Properties | Where |
| --- | --- | --- |
| `wave2_content_view_list` | `role`, `count_bucket` | Board open |
| `wave2_content_publish` | `type`, `visibility`, `has_summary`, `pdf_size_bucket?` | Coach publish |
| `wave2_content_archive` | `type`, `days_published` | Coach archive |
| `wave2_content_view_item` | `type` | Reader open |
| `wave2_content_pdf_download_complete` | `pdf_size_bucket`, `duration_bucket_ms` | PDF flow |
| `wave2_content_external_link_open` | `host` (allowlisted; never the full URL) | Link open |
| `wave2_content_report` | `type` | Report action |

No PDF bytes, no video thumbs, no full URLs sent to PostHog.

### Rollout

1. Backend service stood up; presign + storage bucket configured.
2. Flag on for internal test coach.
3. Flag on for pilot coach with cohort-only visibility.
4. Phase 2: assigned-visibility flag flipped after brief 06 ships.
5. Phase 3: newsletter flag flipped after a moderation drill.
6. Rollback: flag off → coach sees the row removed; client sees no row; existing content survives in storage but isn't fetched.

### Tests

- **Unit**: URL validators (YouTube / Vimeo / HLS / .mp4) — accept + reject suite.
- **Unit**: markdown sanitisation (no `<script>`, no `javascript:` links).
- **Hook**: `useContentItems()` returns Loading/Empty/Error/Data and respects visibility.
- **Component (RNTL)**: type selector, visibility selector, publish/draft toggle, pin-to-assignment.
- **Component**: PDF reader renders a 1-page test PDF without crashing.
- **Component**: video reader handles a 404 video URL with the offline-style empty state.
- **Snapshot at scale=1.6×**: editor + reader.
- **Manual**: report flow → server log shows the report; coach is *not* notified (privacy).

### Risks

| Risk | Mitigation |
| --- | --- |
| Coach uploads sensitive client docs (e.g. a client photo) under `cohort` visibility. | Coach acknowledgement copy at publish: "This will be visible to all your clients." Phase 2's `assigned` visibility is the safer default once it ships. |
| YouTube / Vimeo embed via WebView introduces a tracking vector. | We use `expo-web-browser` (Safari/Chrome custom tab), not WebView — same privacy as a normal browser open. |
| PDF malware. | Storage bucket virus-scans on PUT; failed scans 409 with copy "We couldn't process that file." |
| Markdown XSS via newsletter field. | Server strips; mobile renderer (`react-native-markdown-display`) does not execute scripts; HTML is not enabled. |
| Content drift: a stale newsletter contradicts the current coach guidelines (`coachApi.getMyGuidelines`). | Editor includes a "Pin to assignment" affordance to anchor content to the program version it belongs with (brief 06). |
| Client thinks the report flow auto-hides content. | Report-confirmation copy: "Thanks. We'll review this." No promise of removal. |
| Bundle size growth from `react-native-pdf` + `expo-av`. | Implementation PR validates `eas build` size diff; if `> +5 MB`, switch PDF rendering to "open in system viewer" fallback. |

### Dependencies

- `react-native-pdf` (or fallback to system viewer), `react-native-markdown-display`, `expo-av`, `expo-document-picker`, `expo-web-browser`, `expo-file-system`. Implementation PR adds these; this docs PR does not modify `package.json`.
- Backend content service + storage bucket + virus scan.
- Brief 03 (presigned URL pattern reuse).
- Brief 06 (`per-client-assignment`) — for the `pinnedToAssignmentId` field.
- Brief 09 (`tier-gated-l2-l3`) — for `content.author` entitlement.
- PR #93 `docs/platform-readiness/05-reusable-expansion-ui-patterns.md` — `EditorialList`, `ReaderScreen` primitives.
- PR #93 `docs/platform-readiness/11-deep-links-readiness.md` — `tgp://content/<id>` route.

### Acceptance criteria

- A coach can author and publish a PDF, video, link, and newsletter without leaving the app.
- A client sees only items their coach has published with visibility that includes them.
- A PDF previously downloaded reads offline.
- An invalid YouTube URL is rejected at submit time with a clear error.
- Sentry shows zero `surface: 'wave2.content'` errors over a 7-day pilot.

### Operator handoff

- **Owning surface**: coach lead (authoring), client lead (reader). Trust lead reviews moderation.
- **Out-of-band steps**: bucket configured (PDF + thumbnails); virus scanner active; PostHog flags created; allowed-host list for `wave2_content_external_link_open` event maintained alongside `docs/platform-readiness/08-crash-and-analytics-readiness.md`.
- **"Done" means**: pilot coach publishes ≥3 items in each type and 5 pilot clients consume them over a 2-week window with zero support contact and zero unhandled Sentry errors.
