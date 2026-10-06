import { aiWorkoutApproveCopy } from '../aiWorkoutApproveCopy';

describe('aiWorkoutApproveCopy (AUDIT-14-125)', () => {
  it('does not claim the program was assigned when the backend only saved it to the library', () => {
    // Production approve response today: the AIDraft row, no assigned_count.
    const copy = aiWorkoutApproveCopy('Sam', { approvedAsId: 'plan-1' } as { assigned_count?: unknown });
    expect(copy.title).toBe('Saved to library');
    expect(copy.body).toBe(
      'The program is saved to your workout library. Sam does not see it until it is assigned.',
    );
    expect(copy.body).not.toMatch(/assigned to Sam/);
  });

  it('says assigned only when the backend reports scheduled workouts', () => {
    expect(aiWorkoutApproveCopy('Sam', { assigned_count: 12 })).toEqual({
      title: 'Assigned',
      body: '12 workouts assigned to Sam.',
    });
    expect(aiWorkoutApproveCopy('Sam', { assigned_count: 1 }).body).toBe('1 workout assigned to Sam.');
  });

  it('treats zero, missing or malformed counts as saved to the library', () => {
    for (const r of [undefined, null, {}, { assigned_count: 0 }, { assigned_count: '3' }, { assigned_count: 2.5 }]) {
      expect(aiWorkoutApproveCopy('Sam', r).title).toBe('Saved to library');
    }
  });

  it('has no first person and no exclamation marks', () => {
    const all = [aiWorkoutApproveCopy('Sam', {}), aiWorkoutApproveCopy('Sam', { assigned_count: 2 })];
    for (const c of all) {
      expect(`${c.title} ${c.body}`).not.toMatch(/!|\bI\b|\bwe\b|\bour\b/i);
    }
  });
});
