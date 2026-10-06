/**
 * aiRefusal: the two server refusals every AI surface must handle (backend
 * R2b, growth-project-backend #626, D2 consent contract box 2).
 *
 *   403 { code: 'ai_consent_required', message }
 *       The client has not allowed Roman and their coach's AI tools to use
 *       their information (box 2 is optional). Nothing was sent to the AI
 *       provider. Client surfaces offer the "Allow AI help" choice; coach
 *       surfaces say the client has not allowed it and that the coach still
 *       sees their data as usual.
 *   503 { code: 'ai_egress_blocked', message, requestId }
 *       A server-side policy defect (never the person's choice). Contact
 *       support with the reference (the request ID). Never a consent prompt.
 *
 * Roman's buffered SSE stream can carry the same codes in its in-stream
 * error frame (HTTP 200, `event: error`, exactly `{ code, message }`); the
 * reference then comes from the response's X-Request-ID header.
 *
 * Detection reads the HTTP status AND the machine code, never message text
 * (owner rule 2026-10-01 13:34). Everything here is pure so each surface and
 * its tests share one mapping.
 */
import { shortReference, supportReferenceOf } from '../../utils/correlation';

export const AI_CONSENT_REQUIRED_CODE = 'ai_consent_required';
export const AI_EGRESS_BLOCKED_CODE = 'ai_egress_blocked';

/** Who is looking at the refusal: the client themself, or their coach. */
export type AiAudience = 'client' | 'coach';

export type AiRefusal =
  | { kind: 'consent_required' }
  | {
      kind: 'egress_blocked';
      /** Full support reference (request ID), or null when none is known. */
      reference: string | null;
      /** The server's own message (it names the support address), if sent. */
      serverMessage: string | null;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The machine code of an error body (`code`, or the legacy `error` slot). */
export function machineCodeOf(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (typeof body.code === 'string' && body.code) return body.code;
  return null;
}

function bodyMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.message === 'string' && body.message ? body.message : null;
}

function bodyReference(body: unknown): string | null {
  if (!isRecord(body)) return null;
  for (const key of ['requestId', 'request_id']) {
    const v = body[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * Map an HTTP status + parsed body to a refusal, or null when the response
 * is not one of the two AI refusals. Both the status and the code must match.
 */
export function aiRefusalFromHttp(
  status: number | null | undefined,
  body: unknown,
  headerReference: string | null = null,
): AiRefusal | null {
  const code = machineCodeOf(body);
  if (status === 403 && code === AI_CONSENT_REQUIRED_CODE) return { kind: 'consent_required' };
  if (status === 503 && code === AI_EGRESS_BLOCKED_CODE) {
    return {
      kind: 'egress_blocked',
      reference: bodyReference(body) ?? headerReference,
      serverMessage: bodyMessage(body),
    };
  }
  return null;
}

/** Map an axios-style error (`err.response.{status,data,headers}`) to a refusal. */
export function aiRefusalOf(err: unknown): AiRefusal | null {
  if (!isRecord(err)) return null;
  const response = err.response;
  if (!isRecord(response)) return null;
  const status = typeof response.status === 'number' ? response.status : null;
  if (status !== 403 && status !== 503) return null;
  return aiRefusalFromHttp(status, response.data, supportReferenceOf(err));
}

/**
 * Map Roman's in-stream error frame code (HTTP 200, `event: error`) to a
 * refusal. The frame carries no status, so the code alone decides; the
 * reference is the stream response's X-Request-ID header.
 */
export function aiRefusalFromStreamCode(
  frame: { code: string; message: string },
  headerReference: string | null,
): AiRefusal | null {
  if (frame.code === AI_CONSENT_REQUIRED_CODE) return { kind: 'consent_required' };
  if (frame.code === AI_EGRESS_BLOCKED_CODE) {
    return { kind: 'egress_blocked', reference: headerReference, serverMessage: frame.message || null };
  }
  return null;
}

/** What each AI surface is, in the words the copy uses. */
export type AiSurface =
  | 'roman' // Roman chat
  | 'guide' // AI Guide (Guidance)
  | 'insight' // AI wearable insight
  | 'draft' // coach AI drafts (program, meal plan, insight, Ask AI)
  | 'triage'; // coach community AI triage

export interface AiRefusalCopy {
  title: string;
  body: string;
  /** The short reference line ("Reference: 1a2b3c4d"), when there is one. */
  referenceLine: string | null;
}

const SURFACE_PHRASE: Record<AiSurface, { name: string; isAre: 'is' | 'are' }> = {
  roman: { name: 'Roman', isAre: 'is' },
  guide: { name: 'AI guidance', isAre: 'is' },
  insight: { name: 'AI insights', isAre: 'are' },
  draft: { name: 'AI drafts', isAre: 'are' },
  triage: { name: 'AI triage', isAre: 'is' },
};

/**
 * User-facing copy for a refusal. Plain, warm, no emojis or exclamation
 * marks, and always says what happened and what to do next.
 */
export function aiRefusalCopy(
  refusal: AiRefusal,
  audience: AiAudience,
  surface: AiSurface,
): AiRefusalCopy {
  const { name: what, isAre } = SURFACE_PHRASE[surface];
  if (refusal.kind === 'consent_required') {
    if (audience === 'client') {
      return {
        title: 'AI help is off',
        body:
          // Neutral on purpose (Opus C-326-2): the 403 does not say whether
          // AI help was never allowed or the wording changed and needs a new
          // OK; the sheet says which once it reads the status.
          `${what} cannot use your information because AI help is not on for your account. ` +
          'Your coach still sees your training information as usual. ' +
          'If you allow it, Roman and your coach’s AI tools can use your information, processed by Anthropic.',
        referenceLine: null,
      };
    }
    return {
      title: 'AI help is off for this client',
      body:
        `${what} ${isAre} off for this client because AI help is not on for their account. ` +
        'You still see their data and can coach them as usual. ' +
        'They can turn AI help on in their app under Settings > Privacy, then you can try again.',
      referenceLine: null,
    };
  }
  const short = shortReference(refusal.reference);
  return {
    title: 'AI help is paused by a service problem',
    body:
      `${what} could not run because of a problem with The Growth Project service. Your account and privacy settings are fine. ` +
      (short
        ? 'Contact support and share the reference below.'
        : 'Contact support and say what you were doing when this happened.'),
    referenceLine: short ? `Reference: ${short}` : null,
  };
}
