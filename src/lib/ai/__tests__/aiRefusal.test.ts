/**
 * aiRefusal: the R2b refusal mapping shared by every AI surface.
 *
 * Pins: status AND machine code must both match (never message text), the
 * reference comes from the body, then the X-Request-ID header, then the
 * request ID this app sent; Roman's in-stream frame maps by code; and the
 * copy follows the owner rules (what happened + what to do next, no
 * emojis, no exclamation marks, never "Something went wrong" alone).
 */
import {
  AI_CONSENT_REQUIRED_CODE,
  AI_EGRESS_BLOCKED_CODE,
  aiRefusalCopy,
  aiRefusalFromHttp,
  aiRefusalFromStreamCode,
  aiRefusalOf,
  type AiAudience,
  type AiRefusal,
  type AiSurface,
} from '../aiRefusal';

const CONSENT_MESSAGE = "You haven't allowed AI help yet. You can turn it on in Settings > Privacy.";
const EGRESS_MESSAGE =
  'AI help is turned off for this request because of a problem on our side. Your account and privacy settings are fine. Contact support at support@example.com and include the reference shown with this message so we can fix it.';

function axiosError(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
  sentHeaders: Record<string, string> = {},
) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, data, headers },
    config: { headers: sentHeaders },
  };
}

describe('aiRefusalOf (axios errors)', () => {
  it('403 + ai_consent_required -> consent_required', () => {
    expect(
      aiRefusalOf(axiosError(403, { statusCode: 403, code: AI_CONSENT_REQUIRED_CODE, message: CONSENT_MESSAGE })),
    ).toEqual({ kind: 'consent_required' });
  });

  it('503 + ai_egress_blocked -> egress_blocked with the body requestId and the server message', () => {
    expect(
      aiRefusalOf(
        axiosError(
          503,
          { statusCode: 503, code: AI_EGRESS_BLOCKED_CODE, message: EGRESS_MESSAGE, requestId: 'body-ref-123456' },
          { 'x-request-id': 'header-ref' },
        ),
      ),
    ).toEqual({ kind: 'egress_blocked', reference: 'body-ref-123456', serverMessage: EGRESS_MESSAGE });
  });

  it('503 egress without a body reference falls back to X-Request-ID, then to the id this app sent', () => {
    const fromHeader = aiRefusalOf(
      axiosError(503, { code: AI_EGRESS_BLOCKED_CODE, message: EGRESS_MESSAGE }, { 'x-request-id': 'hdr-7f3a9c' }),
    );
    expect(fromHeader).toMatchObject({ kind: 'egress_blocked', reference: 'hdr-7f3a9c' });
    const fromSent = aiRefusalOf(
      axiosError(503, { code: AI_EGRESS_BLOCKED_CODE, message: EGRESS_MESSAGE }, {}, { 'X-Request-Id': 'sent-0042' }),
    );
    expect(fromSent).toMatchObject({ kind: 'egress_blocked', reference: 'sent-0042' });
  });

  it('needs the status AND the code: a mismatched pair or message-only body is not a refusal', () => {
    expect(aiRefusalOf(axiosError(403, { code: AI_EGRESS_BLOCKED_CODE, message: 'x' }))).toBeNull();
    expect(aiRefusalOf(axiosError(503, { code: AI_CONSENT_REQUIRED_CODE, message: 'x' }))).toBeNull();
    expect(aiRefusalOf(axiosError(403, { message: CONSENT_MESSAGE }))).toBeNull();
    expect(aiRefusalOf(axiosError(500, { code: AI_EGRESS_BLOCKED_CODE, message: 'x' }))).toBeNull();
    expect(aiRefusalOf(axiosError(403, { code: 'not_coach', message: 'x' }))).toBeNull();
    expect(aiRefusalOf(new Error('Network Error'))).toBeNull();
    expect(aiRefusalOf(null)).toBeNull();
  });
});

describe('aiRefusalFromHttp / aiRefusalFromStreamCode', () => {
  it('maps a raw fetch status + body (Roman non-stream refusals)', () => {
    expect(aiRefusalFromHttp(403, { code: AI_CONSENT_REQUIRED_CODE, message: CONSENT_MESSAGE })).toEqual({
      kind: 'consent_required',
    });
    expect(aiRefusalFromHttp(503, { code: AI_EGRESS_BLOCKED_CODE, message: EGRESS_MESSAGE }, 'hdr-1')).toEqual({
      kind: 'egress_blocked',
      reference: 'hdr-1',
      serverMessage: EGRESS_MESSAGE,
    });
    expect(aiRefusalFromHttp(403, null)).toBeNull();
  });

  it("maps Roman's in-stream {code, message} frame by code, with the header reference", () => {
    expect(aiRefusalFromStreamCode({ code: AI_CONSENT_REQUIRED_CODE, message: CONSENT_MESSAGE }, 'r1')).toEqual({
      kind: 'consent_required',
    });
    expect(aiRefusalFromStreamCode({ code: AI_EGRESS_BLOCKED_CODE, message: EGRESS_MESSAGE }, 'r2')).toEqual({
      kind: 'egress_blocked',
      reference: 'r2',
      serverMessage: EGRESS_MESSAGE,
    });
    expect(aiRefusalFromStreamCode({ code: 'ROMAN_UNAVAILABLE', message: 'x' }, 'r3')).toBeNull();
  });
});

describe('aiRefusalCopy (owner copy rules)', () => {
  const surfaces: AiSurface[] = ['roman', 'guide', 'insight', 'draft', 'triage'];
  const audiences: AiAudience[] = ['client', 'coach'];
  const refusals: AiRefusal[] = [
    { kind: 'consent_required' },
    { kind: 'egress_blocked', reference: '7f3a9c21-aaaa-bbbb', serverMessage: EGRESS_MESSAGE },
    { kind: 'egress_blocked', reference: null, serverMessage: null },
  ];
  // Emoji ranges (pictographs, symbols, dingbats, flags).
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;

  for (const refusal of refusals) {
    for (const audience of audiences) {
      for (const surface of surfaces) {
        it(`${refusal.kind}${refusal.kind === 'egress_blocked' && !refusal.reference ? ' (no ref)' : ''} / ${audience} / ${surface}: specific, calm, actionable`, () => {
          const copy = aiRefusalCopy(refusal, audience, surface);
          const all = `${copy.title} ${copy.body} ${copy.referenceLine ?? ''}`;
          expect(all).not.toMatch(/!/);
          expect(all).not.toMatch(EMOJI);
          expect(all.toLowerCase()).not.toContain('something went wrong');
          expect(all.toLowerCase()).not.toContain('please try again');
          expect(copy.title.length).toBeGreaterThan(0);
          expect(copy.body.length).toBeGreaterThan(40);
        });
      }
    }
  }

  it('client consent: AI help is not on (neutral: never allowed OR wording changed, C-326-2), and the coach still sees their data', () => {
    const copy = aiRefusalCopy({ kind: 'consent_required' }, 'client', 'roman');
    expect(copy.title).toBe('AI help is off');
    expect(copy.body).toContain('because AI help is not on for your account');
    expect(copy.body).not.toContain('you have not allowed');
    expect(copy.body).toContain('Your coach still sees your training information as usual');
    expect(copy.body).toContain('Anthropic');
    expect(copy.referenceLine).toBeNull();
  });

  it('coach consent: the client has not allowed it, the coach still coaches, where the client turns it on', () => {
    const copy = aiRefusalCopy({ kind: 'consent_required' }, 'coach', 'draft');
    expect(copy.title).toBe('AI help is off for this client');
    expect(copy.body).toContain('AI drafts are off for this client because AI help is not on for their account');
    expect(copy.body).toContain('You still see their data and can coach them as usual');
    expect(copy.body).toContain('Settings > Privacy');
    expect(aiRefusalCopy({ kind: 'consent_required' }, 'coach', 'insight').body).toContain('AI insights are off');
    expect(aiRefusalCopy({ kind: 'consent_required' }, 'coach', 'roman').body).toContain('Roman is off');
  });

  it('egress: server-side, support path with the short reference, never a consent prompt', () => {
    const copy = aiRefusalCopy(
      { kind: 'egress_blocked', reference: '7f3a9c21-aaaa-bbbb', serverMessage: null },
      'client',
      'guide',
    );
    expect(copy.title).toBe('AI help is paused by a service problem');
    expect(copy.body).toContain('problem with The Growth Project service');
    expect(copy.body).toContain('Contact support');
    expect(copy.body).not.toContain('Settings');
    expect(copy.body).not.toMatch(/allow/i);
    expect(copy.referenceLine).toBe('Reference: 7f3a9c21');
    const noRef = aiRefusalCopy({ kind: 'egress_blocked', reference: null, serverMessage: null }, 'coach', 'draft');
    expect(noRef.referenceLine).toBeNull();
    expect(noRef.body).not.toContain('reference below');
    expect(noRef.body).toContain('Contact support');
  });
});
