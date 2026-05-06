/**
 * timelineApi.ts — Phase 7B: Transformation Timeline
 *
 * Typed client for GET /me/timeline.
 *
 * The endpoint requires a valid JWT (standard Bearer header from the shared
 * `api` client in `./api`). UserId is NEVER passed as a query parameter —
 * the backend derives it from the JWT exclusively.
 */
import api from './api';

// ─── Lane types ───────────────────────────────────────────────────────────────

export type TimelineLane = 'body' | 'win' | 'coach' | 'friction';

// ─── Event union ──────────────────────────────────────────────────────────────

interface TimelineEventBase {
  id: string;
  lane: TimelineLane;
  at: string;
  title: string;
  body?: string;
}

export interface BodyWeightEvent extends TimelineEventBase {
  lane: 'body';
  eventType: 'weight_logged';
  metadata: {
    weightLbs: number;
    deltaLbs: number | null;
    streakDays: number;
  };
}

export interface BodyCompositionEvent extends TimelineEventBase {
  lane: 'body';
  eventType: 'body_composition';
  metadata: {
    bodyFatPct: number | null;
    muscleMassLbs: number | null;
  };
}

export interface BodyPhotoEvent extends TimelineEventBase {
  lane: 'body';
  eventType: 'progress_photo';
  metadata: {
    photoId: string;
  };
}

export interface WinStreakEvent extends TimelineEventBase {
  lane: 'win';
  eventType: 'checkin_streak_milestone';
  metadata: {
    streakDays: number;
    threshold: 7 | 14 | 30 | 60 | 90;
  };
}

export interface WinFinanceMilestoneEvent extends TimelineEventBase {
  lane: 'win';
  eventType: 'finance_milestone';
  metadata: {
    milestoneRef: string;
  };
}

export interface WinBuildWeekDay7Event extends TimelineEventBase {
  lane: 'win';
  eventType: 'build_week_complete';
  metadata: {
    enrollmentId: string;
    dayCompleted: 7;
  };
}

export interface CoachTextNoteEvent extends TimelineEventBase {
  lane: 'coach';
  eventType: 'coach_text_note';
  metadata: {
    messageId: string;
    coachName: string;
  };
}

export interface CoachVoiceNoteEvent extends TimelineEventBase {
  lane: 'coach';
  eventType: 'coach_voice_note';
  metadata: {
    messageId: string;
    coachName: string;
    durationSec: number;
  };
}

export interface FrictionMissedDayEvent extends TimelineEventBase {
  lane: 'friction';
  eventType: 'missed_checkin';
  metadata: {
    consecutiveMisses: number;
  };
}

export interface FrictionRecoveredStreakEvent extends TimelineEventBase {
  lane: 'friction';
  eventType: 'streak_recovered';
  metadata: {
    priorStreakDays: number;
    gapDays: number;
  };
}

export type TimelineEvent =
  | BodyWeightEvent
  | BodyCompositionEvent
  | BodyPhotoEvent
  | WinStreakEvent
  | WinFinanceMilestoneEvent
  | WinBuildWeekDay7Event
  | CoachTextNoteEvent
  | CoachVoiceNoteEvent
  | FrictionMissedDayEvent
  | FrictionRecoveredStreakEvent;

// ─── Response / query shapes ──────────────────────────────────────────────────

export interface TimelineResponse {
  events: TimelineEvent[];
  nextCursor: string | null;
  total: number;
}

export interface TimelineQuery {
  sinceDays?: number;
  lanes?: TimelineLane[];
  cursor?: string;
  limit?: number;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      search.set(k, String(v));
    }
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

// ─── API client ───────────────────────────────────────────────────────────────

/**
 * Fetch the requesting user's transformation timeline.
 *
 * `userId` is resolved server-side from the JWT — do not pass it here.
 * Passing any user-id-like field would be silently ignored by the backend;
 * the client enforces the same principle to keep intent clear.
 */
export function fetchTimeline(query: TimelineQuery = {}): Promise<TimelineResponse> {
  const params: Record<string, string | number | undefined> = {
    since_days: query.sinceDays,
    cursor: query.cursor,
    limit: query.limit,
  };
  if (query.lanes && query.lanes.length > 0) {
    params.lanes = query.lanes.join(',');
  }
  return api.get<TimelineResponse>(`/me/timeline${qs(params)}`);
}

export const timelineApi = { fetchTimeline };
