import { ROMAN_COMMUNITY_LINES } from '../romanVoice';

// Owner 2026-10-07 10:22/10:35: screens must not make things up. The Today-empty
// line must not claim Roman checked anything ("Everything is in order").
describe('Roman community copy is truthful', () => {
  it('Today-empty states only what is true', () => {
    expect(ROMAN_COMMUNITY_LINES.todayEmpty.straight).toBe(
      'Nothing is waiting for you today, {firstName}. Check back later.',
    );
  });

  it('no community line claims everything is in order', () => {
    const all = JSON.stringify(ROMAN_COMMUNITY_LINES);
    expect(all).not.toMatch(/Everything is in order/);
  });
});
