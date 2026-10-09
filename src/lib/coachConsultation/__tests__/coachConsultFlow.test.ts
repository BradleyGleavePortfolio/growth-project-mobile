import {
  STEP_ORDER,
  cardValid,
  eyebrowFor,
  firstNameOf,
  missingRequired,
  nextStep,
  previousStep,
  progressFor,
  resumeStep,
  sanitizeAnswers,
  segmentFill,
  toggleSpecialty,
  visibleSteps,
  wireAnswers,
  type FlowContext,
} from '../flow';

const all: FlowContext = { built: new Set(STEP_ORDER), importOn: false };
const pr1: FlowContext = { built: new Set(['K0', 'K1', 'K2'] as const), importOn: false };

describe('coach consultation flow registry (prototype 77-85)', () => {
  it('runs K0-K8 with K7 hidden while the importer flag is off', () => {
    expect(visibleSteps({ clients_today: '1_10' }, all)).toEqual(['K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K8']);
  });

  it('shows K7 only with the importer flag on and clients today', () => {
    const on = { ...all, importOn: true };
    expect(visibleSteps({ clients_today: 'none' }, on)).not.toContain('K7');
    expect(visibleSteps({ clients_today: '11_25' }, on)).toContain('K7');
  });

  it('skips steps that have no component, so the last built step completes', () => {
    expect(nextStep('K1', {}, pr1)).toBe('K2');
    expect(nextStep('K2', {}, pr1)).toBeNull();
    expect(previousStep('K1', {}, pr1)).toBe('K0');
    expect(previousStep('K0', {}, pr1)).toBeNull();
  });

  it('fills the five-segment bar like the prototype (K4 and K5 share chapter 4)', () => {
    expect(progressFor('K0', {}, all)).toBeNull();
    expect(progressFor('K8', {}, all)).toBeNull();
    const k4 = progressFor('K4', {}, all);
    expect(k4).toEqual({ chapter: 4, position: 1, count: 2, total: 5 });
    expect(segmentFill(k4!)).toEqual([1, 1, 1, 0.5, 0]);
    expect(segmentFill(progressFor('K5', {}, all)!)).toEqual([1, 1, 1, 1, 0]);
    expect(eyebrowFor(progressFor('K2', {}, all))).toBe('Your practice · 2 of 5');
    expect(eyebrowFor(null)).toBe('Your practice');
  });

  it('requires a name of 1-80 on the card and caps specialties at five', () => {
    expect(cardValid({ display_name: '  ' })).toBe(false);
    expect(cardValid({ display_name: 'Jordan Reyes' })).toBe(true);
    expect(cardValid({ display_name: 'x'.repeat(81) })).toBe(false);
    let list = toggleSpecialty([], 'strength');
    for (const v of ['fat_loss', 'muscle', 'beginners', 'older', 'sports'] as const) list = toggleSpecialty(list, v);
    expect(list).toHaveLength(5);
    expect(toggleSpecialty(list, 'strength')).not.toContain('strength');
  });

  it('names what completion still needs and where it is asked', () => {
    expect(missingRequired({ display_name: 'Jordan' })).toEqual(['clients_today']);
    expect(missingRequired({ display_name: 'Jordan', clients_today: 'none' })).toEqual([]);
  });

  it('keeps only known keys from a draft and sends only backend keys', () => {
    const a = sanitizeAnswers({ display_name: 'Jordan', specialties: ['strength', 'nope', 'strength'], extra: 1, link_shared: true });
    expect(a).toEqual({ display_name: 'Jordan', specialties: ['strength'], link_shared: true });
    const body = wireAnswers({ ...a, business_name: ' ', clients_today: 'none', import_choice: 'later' });
    expect(body).toEqual({
      display_name: 'Jordan',
      business_name: null,
      bio: null,
      specialties: ['strength'],
      clients_today: 'none',
      coaching_touch: null,
      programming_style: null,
    });
  });

  it('resumes on the saved step, or the nearest earlier visible one', () => {
    expect(resumeStep('K2', {}, pr1)).toBe('K2');
    expect(resumeStep('K4', {}, pr1)).toBe('K2');
    expect(resumeStep(null, {}, pr1)).toBe('K0');
  });

  it('greets by first name', () => {
    expect(firstNameOf({ name: 'Jordan Reyes' })).toBe('Jordan');
    expect(firstNameOf({ firstName: 'Jo', name: 'Jordan Reyes' })).toBe('Jo');
    expect(firstNameOf(null)).toBe('');
  });
});
