/**
 * communityEventsApi — schema-drift tests (F6).
 *
 * The mobile `CommunityEventSchema` is a STRICT mirror of the backend event
 * response DTO at growth-project-backend PR #389 HEAD `c6799955`
 * (`src/community/dto/community-event.dto.ts`). These tests pin that parity so
 * a backend shape change (an added/removed field, a loosened timestamp, a new
 * lifecycle/RSVP enum member, a relaxed UUID) fails LOUDLY here rather than
 * silently corrupting the client at runtime.
 *
 * Backend contract mirrored:
 *   EVENT_STATES   = [scheduled, tomorrow, live, replay, reflected]
 *   RSVP_STATUSES  = [going, maybe, declined, attended, missed]
 *   id/workspace_id/cohort_id/created_by_user_id: z.string().uuid()
 *   starts_at/ends_at/reflected_at/created_at/updated_at: z.string().datetime()
 *   rsvp_counts: strict object of nonnegative ints
 *   .strict() at the object level (extra fields rejected)
 */

import {
  CommunityEventSchema,
  COMMUNITY_EVENT_STATES,
  COMMUNITY_RSVP_STATUSES,
} from '../communityEventsApi';

/** A canonical, backend-shaped event fixture (every field present + valid). */
function validEvent(): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: '22222222-2222-4222-8222-222222222222',
    cohort_id: null,
    created_by_user_id: '33333333-3333-4333-8333-333333333333',
    title: 'Live Q&A',
    description: null,
    state: 'scheduled',
    starts_at: '2026-07-01T18:00:00.000Z',
    ends_at: null,
    external_url: null,
    reflected_at: null,
    canceled: false,
    rsvp_counts: {
      going: 12,
      maybe: 3,
      declined: 1,
      attended: 0,
      missed: 0,
    },
    viewer_rsvp_status: null,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
  };
}

describe('CommunityEventSchema drift parity (backend c6799955)', () => {
  it('parses a valid backend-shaped event', () => {
    const parsed = CommunityEventSchema.safeParse(validEvent());
    expect(parsed.success).toBe(true);
  });

  it('mirrors the backend lifecycle states exactly', () => {
    expect([...COMMUNITY_EVENT_STATES]).toEqual([
      'scheduled',
      'tomorrow',
      'live',
      'replay',
      'reflected',
    ]);
  });

  it('mirrors the backend RSVP statuses exactly', () => {
    expect([...COMMUNITY_RSVP_STATUSES]).toEqual([
      'going',
      'maybe',
      'declined',
      'attended',
      'missed',
    ]);
  });

  it('rejects an unknown extra field (strict drift guard)', () => {
    const drifted = { ...validEvent(), surprise_field: 'nope' };
    const parsed = CommunityEventSchema.safeParse(drifted);
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-ISO / bad timestamp on starts_at', () => {
    const drifted = { ...validEvent(), starts_at: 'July 1 2026 6pm' };
    const parsed = CommunityEventSchema.safeParse(drifted);
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-UUID id', () => {
    const drifted = { ...validEvent(), id: 'not-a-uuid' };
    const parsed = CommunityEventSchema.safeParse(drifted);
    expect(parsed.success).toBe(false);
  });

  it('rejects an out-of-contract lifecycle state', () => {
    const drifted = { ...validEvent(), state: 'archived' };
    const parsed = CommunityEventSchema.safeParse(drifted);
    expect(parsed.success).toBe(false);
  });

  it('rejects an out-of-contract viewer RSVP status', () => {
    const drifted = { ...validEvent(), viewer_rsvp_status: 'interested' };
    const parsed = CommunityEventSchema.safeParse(drifted);
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing required field (canceled)', () => {
    const base = validEvent();
    delete base.canceled;
    const parsed = CommunityEventSchema.safeParse(base);
    expect(parsed.success).toBe(false);
  });

  it('rejects an extra field nested in rsvp_counts (strict)', () => {
    const drifted = validEvent();
    drifted.rsvp_counts = {
      going: 1,
      maybe: 0,
      declined: 0,
      attended: 0,
      missed: 0,
      waitlisted: 5,
    };
    const parsed = CommunityEventSchema.safeParse(drifted);
    expect(parsed.success).toBe(false);
  });
});
