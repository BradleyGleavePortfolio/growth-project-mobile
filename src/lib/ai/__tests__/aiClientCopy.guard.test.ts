/**
 * 114-S pre-push checklist (d): client-facing AI copy added by #326 never
 * speaks as "we/us/our", never uses an exclamation mark or emoji, and every
 * failure names what happened plus a working next step.
 */
import { AI_CONSENT_SHEET_COPY } from '../../../components/ai/AiConsentSheet';
import { aiRefusalCopy, type AiAudience, type AiRefusal, type AiSurface } from '../aiRefusal';
import * as fs from 'fs';
import * as path from 'path';

const FIRST_PERSON = /\b(we|we're|we've|we'll|us|our|ours)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function expectQuiet(text: string) {
  expect(text).not.toMatch(FIRST_PERSON);
  expect(text).not.toContain('!');
  expect(text).not.toMatch(EMOJI);
}

describe('AI client copy (checklist d)', () => {
  it('every consent sheet line', () => {
    for (const line of Object.values(AI_CONSENT_SHEET_COPY)) expectQuiet(line);
  });

  it('every refusal title and body, for each audience and surface', () => {
    const refusals: AiRefusal[] = [
      { kind: 'consent_required' },
      { kind: 'egress_blocked', reference: '7f3a9c21-aaaa-bbbb', serverMessage: null },
      { kind: 'egress_blocked', reference: null, serverMessage: null },
    ];
    const audiences: AiAudience[] = ['client', 'coach'];
    const surfaces: AiSurface[] = ['guide', 'insight', 'roman', 'draft', 'triage'];
    for (const r of refusals)
      for (const a of audiences)
        for (const s of surfaces) {
          const copy = aiRefusalCopy(r, a, s);
          expectQuiet(copy.title);
          expectQuiet(copy.body);
          // A consent refusal's next step is the notice's Allow button; a
          // service failure names the support path in the text.
          if (r.kind === 'egress_blocked') expect(copy.body).toContain('Contact support');
        }
  });

  it('the AI guide degraded reply', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../screens/client/AIGuideScreen.tsx'), 'utf8');
    const start = src.indexOf("'Guidance could not answer this time");
    expect(start).toBeGreaterThan(-1);
    const reply = src.slice(start, src.indexOf(';', start));
    expectQuiet(reply);
    expect(reply).toContain('contact support');
  });
});
