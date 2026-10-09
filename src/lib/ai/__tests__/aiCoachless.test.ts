/**
 * REFUSAL-COACHLESS-134: the client AI copy reads the signed-in user from the
 * user cache by default, the same read as the AI consent sheet (#592).
 */
import { clearUserCache, setUserCache } from '../../userCache';
import { signedInClientIsCoachless } from '../aiCoachless';
import { aiRefusalCopy } from '../aiRefusal';
import { aiDailyCapBody } from '../aiDailyCap';

const cap = { resetsAt: new Date(2026, 9, 5, 17, 0) };
const local = new Date(2026, 9, 5, 9, 0);

afterEach(async () => {
  await clearUserCache();
});

it('an empty cache reads as coached, so the coached wording is the fallback', async () => {
  await clearUserCache();
  expect(signedInClientIsCoachless()).toBe(false);
  expect(aiRefusalCopy({ kind: 'consent_required' }, 'client', 'roman').body).toContain('Your coach still sees');
});

it('a client with a coach keeps the coach lines', async () => {
  await setUserCache({ id: 'client-1', email: 'a@example.invalid', coach_id: 'coach-1' });
  expect(signedInClientIsCoachless()).toBe(false);
  expect(aiRefusalCopy({ kind: 'consent_required' }, 'client', 'roman').body).toContain('Your coach still sees');
  expect(aiDailyCapBody(cap, 'client', local)).toContain('Your coach is in Messages');
});

it('a client with no coach never reads a coach line', async () => {
  await setUserCache({ id: 'client-2', email: 'b@example.invalid' });
  expect(signedInClientIsCoachless()).toBe(true);
  expect(aiRefusalCopy({ kind: 'consent_required' }, 'client', 'roman').body).not.toMatch(/coach/i);
  expect(aiDailyCapBody(cap, 'client', local)).not.toMatch(/coach/i);
});
