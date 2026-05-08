/**
 * Wave 11 — Runtime Scaffolding Type Contracts
 *
 * Typed contracts for the four runtime-oriented surfaces introduced in Wave 11:
 *   1. Client Path Copilot      — AI summarises / drafts; coach approves.
 *   2. Coach Brief              — daily morning brief for the coach.
 *   3. Admin Control Room       — governance view for ops/admin.
 *   4. Private Community hub    — private rooms / cohorts / coach-led threads.
 *
 * All endpoints these types describe are NOT YET LIVE.
 * See `src/services/wave11Adapters.ts` for the mock-safe adapter layer that
 * returns shaped empty data until the backend ships.
 *
 * Doctrine notes (encoded in field names + enums):
 *   - The community is private + coach-led by default. "noisy" surfaces
 *     (open feeds, reply-storms) are deliberately not modeled.
 *   - AI never approves a verified-progress claim on its own. Every
 *     `VerifiedProgressItem` carries a `signoffStatus` whose terminal
 *     "approved" / "admin_reviewed" states require a human actor id.
 *   - "AI" fields are always advisory: `aiSummary`, `aiDraft`, `aiFlags`.
 *     The decision belongs to `coachActorId` or `adminActorId`.
 */

// ─── Shared primitives ────────────────────────────────────────────────────────

export type ISODateString = string;

/** Person who took an action. AI is explicitly its own actor kind so the UI
 *  can never misattribute an AI suggestion as a human decision. */
export type ActorKind = 'client' | 'coach' | 'admin' | 'ai' | 'system';

export interface Actor {
  id: string;
  kind: ActorKind;
  /** Display-safe label. May be a first name, "AI Copilot", or "Admin". */
  displayName: string;
}

// ─── Verified-progress signoff lifecycle ──────────────────────────────────────

/** All terminal states a verified-progress claim can be in. Names are chosen
 *  so the UI can render a status chip directly off the enum. */
export type SignoffStatus =
  | 'pending'           // submitted, awaiting coach review
  | 'coach_approved'    // coach has signed off
  | 'admin_reviewed'    // additionally admin-reviewed (e.g. high-stakes claims)
  | 'disputed'          // client or another coach disputed the signoff
  | 'flagged'           // automated or manual abuse flag
  | 'source_missing'   // proof source link is broken / unavailable
  | 'source_stale';     // proof source older than the staleness threshold

export type VerifiedProgressKind =
  | 'net_worth_milestone'
  | 'fitness_metric'
  | 'coach_report'
  | 'admin_report'
  | 'login_streak'
  | 'days_logged'
  | 'habit_consistency'
  | 'check_in_consistency'
  | 'self_report'
  | 'milestone_review'
  | 'income_proof'
  | 'bank_proof'
  | 'platform_proof'
  | 'screenshot';

export interface VerifiedProgressItem {
  id: string;
  kind: VerifiedProgressKind;
  /** Short, human-readable label rendered in lists ("Q1 Net Worth: $250k"). */
  label: string;
  /** Optional numeric value when the kind is metric-shaped. Strings carry
   *  units to keep typing simple at this layer (e.g. "250000 USD"). */
  value?: string;
  submittedAt: ISODateString;
  submittedBy: Actor;
  signoffStatus: SignoffStatus;
  /** When `signoffStatus` is `coach_approved` or `admin_reviewed`, this is
   *  populated. The UI uses its absence to refuse to render the "approved"
   *  chip even if the status field claims otherwise. */
  signoffActor?: Actor;
  signoffAt?: ISODateString;
  /** Proof source. `null` is rendered as "source missing" by the UI. */
  proofUrl?: string | null;
  /** AI-generated short summary; ALWAYS shown with an "AI summary" badge. */
  aiSummary?: string;
  /** AI-detected concerns. UI surfaces these as flags, never as conclusions. */
  aiFlags?: string[];
  /** Free-text note from the coach attached at signoff time. */
  coachNote?: string;
}

// ─── Client Path Copilot ──────────────────────────────────────────────────────

/** A single suggestion the Copilot is offering the client. The client can
 *  acknowledge it; binding actions still flow to the coach for approval. */
export interface CopilotSuggestion {
  id: string;
  createdAt: ISODateString;
  /** One-sentence headline rendered as the card title. */
  headline: string;
  /** 2–4 sentences of context the AI assembled from logs. */
  body: string;
  /** Tag for the UI ("nutrition" / "training" / "mindset" / "admin"). */
  topic: 'nutrition' | 'training' | 'mindset' | 'admin' | 'finance';
  /** Pinned by the coach so it survives the next refresh. */
  pinnedByCoach: boolean;
  /** True if the suggestion needs an explicit coach approval before the
   *  client should act on it (e.g. macro/training-load changes). */
  requiresCoachApproval: boolean;
  /** Set once a coach has approved. Read by the client UI to flip the
   *  "Approved by your coach" chip on. */
  coachApproval?: {
    actor: Actor;
    approvedAt: ISODateString;
    note?: string;
  };
}

export interface ClientPathCopilotPayload {
  /** Stable sort: most recent first, pinned items always first. */
  suggestions: CopilotSuggestion[];
  /** Pending verified-progress items the client has submitted; shown so they
   *  can see where each claim is in the signoff lifecycle. */
  pendingVerifiedProgress: VerifiedProgressItem[];
  /** True when the latest payload generation is older than `staleAfterHours`
   *  and the UI should show a refresh affordance instead of stale data. */
  isStale: boolean;
  generatedAt: ISODateString;
}

// ─── Coach Brief ──────────────────────────────────────────────────────────────

/** A single client surfaced in the Coach Brief. Never includes prescriptive
 *  AI conclusions — only summaries the coach can act on. */
export interface CoachBriefClientCard {
  clientId: string;
  clientDisplayName: string;
  /** Two-sentence AI summary of the last 24h of activity. */
  aiSummary: string;
  /** Things the AI noticed that may need attention. UI prefixes "AI noticed:". */
  aiFlags: string[];
  /** Items the coach must act on (signoff queue, unanswered DMs, etc.). */
  todos: CoachBriefTodo[];
  /** Last verified-progress submission so the coach can quickly skim. */
  latestVerifiedProgress?: VerifiedProgressItem;
}

export interface CoachBriefTodo {
  id: string;
  kind:
    | 'verified_progress_signoff'
    | 'unanswered_dm'
    | 'check_in_overdue'
    | 'plan_review'
    | 'admin_referral';
  label: string;
  /** Soft due-by; rendered as a relative time. */
  dueBy?: ISODateString;
}

export interface CoachBriefPayload {
  /** Coach's morning summary. AI-drafted, coach can edit and "use as
   *  announcement" (gated behind the community feature flag). */
  morningSummary: {
    aiDraft: string;
    /** True once the coach has explicitly approved the summary for posting. */
    approvedByCoach: boolean;
    approvedAt?: ISODateString;
  };
  clients: CoachBriefClientCard[];
  generatedAt: ISODateString;
  isStale: boolean;
}

// ─── Admin Control Room ───────────────────────────────────────────────────────

export type AdminAlertSeverity = 'info' | 'watch' | 'critical';

export interface AdminAlert {
  id: string;
  severity: AdminAlertSeverity;
  /** Headline ("3 disputed signoffs in the last 24h"). */
  headline: string;
  /** Optional links the admin can drill into; UI renders as buttons. */
  links?: { label: string; href: string }[];
  /** AI-drafted recommendation. ALWAYS rendered with the "AI suggests" prefix. */
  aiRecommendation?: string;
  occurredAt: ISODateString;
}

export interface AdminControlRoomPayload {
  alerts: AdminAlert[];
  /** Aggregate KPIs. Admin-only fields; never shown to coaches. */
  kpis: {
    activeCoaches: number;
    activeClients: number;
    pendingSignoffs: number;
    flaggedItems: number;
    disputedItems: number;
  };
  generatedAt: ISODateString;
  isStale: boolean;
}

// ─── Private Community ────────────────────────────────────────────────────────

/** Default doctrine: community is private, coach-led, restrained, not noisy.
 *  These shapes intentionally do not model "public feed" or "global thread".
 *  When the broader community layer ships, add new variants here. */

export type CommunityRoomKind =
  | 'private_room'      // 1:N coach-owned room (default)
  | 'cohort'            // bounded cohort of clients sharing a start window
  | 'announcement'      // coach broadcasts; replies disabled by default
  | 'coach_led_thread'; // coach-pinned topic thread within a room

export interface CommunityRoom {
  id: string;
  kind: CommunityRoomKind;
  title: string;
  /** True when membership is gated by coach invitation. */
  invitationOnly: boolean;
  /** Member count is rounded ("about 12") in the UI to discourage vanity. */
  memberCountApprox: number;
  /** When `kind === 'announcement'`, replies are off unless this is true. */
  repliesAllowed: boolean;
  lastActivityAt?: ISODateString;
}

export interface CommunityPostAttachment {
  kind: 'voice_note' | 'image' | 'doc';
  /** Duration in seconds for voice notes; UI clamps to 60s by default. */
  durationSec?: number;
  /** Content URL; absent for the placeholder pre-upload state. */
  url?: string;
  /** True when the underlying file is still being processed (transcode,
   *  abuse scan). UI renders a "processing" state. */
  processing?: boolean;
}

export interface CommunityPost {
  id: string;
  roomId: string;
  author: Actor;
  /** Plain-text body. Markdown is intentionally disabled at this layer to
   *  keep the surface restrained. */
  body: string;
  attachments: CommunityPostAttachment[];
  postedAt: ISODateString;
  /** True when the post has been pinned by a coach or admin. */
  pinned: boolean;
  /** Reaction counts; the only allowed reactions are {fire, clap, heart}. */
  reactions: {
    fire: number;
    clap: number;
    heart: number;
  };
}

export interface CommunityHubPayload {
  rooms: CommunityRoom[];
  /** Most recent posts across all rooms the user can see. */
  recentPosts: CommunityPost[];
  generatedAt: ISODateString;
  isStale: boolean;
}
