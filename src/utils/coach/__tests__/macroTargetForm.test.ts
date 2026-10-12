import { macroTargetSaveError, validateMacroTargetDraft } from '../macroTargetForm';

const draft = (over: Partial<Record<'calories' | 'protein' | 'carbs' | 'fat' | 'notes', string>> = {}) => ({
  calories: '2200', protein: '180', carbs: '220', fat: '70', notes: '', ...over,
});

describe('coach macro target form', () => {
  it('turns typed numbers into the POST body the server accepts', () => {
    expect(validateMacroTargetDraft(draft({ notes: '  Keep protein high on rest days. ' }))).toEqual({
      ok: true,
      input: {
        calories_kcal: 2200, protein_g: 180, carbs_g: 220, fats_g: 70,
        notes: 'Keep protein high on rest days.',
      },
    });
  });

  it('rounds decimals to whole numbers (the server takes integers) and omits an empty note', () => {
    const r = validateMacroTargetDraft(draft({ protein: '182.6', fat: '69,4' }));
    expect(r).toEqual({ ok: true, input: { calories_kcal: 2200, protein_g: 183, carbs_g: 220, fats_g: 69 } });
  });

  it('names the field and the allowed range instead of failing on the server', () => {
    expect(validateMacroTargetDraft(draft({ calories: '' }))).toEqual({ ok: false, message: 'Enter calories in kcal.' });
    const msg = (over: Parameters<typeof draft>[0]) => (validateMacroTargetDraft(draft(over)) as { message: string }).message;
    expect(msg({ calories: '650' })).toBe('Calories must be between 1200 and 7000 kcal.');
    expect(msg({ calories: '800' })).toBe('Calories must be between 1200 and 7000 kcal.');
    expect(msg({ calories: '1199' })).toBe('Calories must be between 1200 and 7000 kcal.');
    expect(validateMacroTargetDraft(draft({ calories: '1200' }))).toMatchObject({ ok: true, input: { calories_kcal: 1200 } });
    expect(msg({ fat: '450' })).toBe('Fat must be between 0 and 400 g.');
    expect(msg({ carbs: 'lots' })).toBe('Carbs must be a whole number of g.');
  });

  it('gives specific save-failure copy', () => {
    expect(macroTargetSaveError({ response: { status: 404 } })).toMatch(/not on your roster/);
    expect(macroTargetSaveError({ response: { status: 400, data: { message: ['calories_kcal must not be less than 800'] } } }))
      .toMatch(/did not accept these numbers/);
    expect(macroTargetSaveError({ response: { status: 400 } })).toMatch(/did not accept these numbers/);
    expect(macroTargetSaveError({ response: { status: 400, data: { message: '  ' } } })).toMatch(/did not accept these numbers/);
    expect(macroTargetSaveError({ response: { status: 429 } })).toMatch(/Too many saves/);
    expect(macroTargetSaveError({ message: 'Network Error' })).toMatch(/Check your connection/);
  });

  it("shows the server's calorie floor message on a 400", () => {
    const floorError = (message: string) => ({ response: { status: 400, data: { statusCode: 400, message, error: 'Bad Request' } } });
    expect(macroTargetSaveError(floorError("Calorie targets can't go below 1,200 for this client.")))
      .toBe("Calorie targets can't go below 1,200 for this client.");
    expect(macroTargetSaveError(floorError("Calorie targets can't go below 1,500 for this client.")))
      .toBe("Calorie targets can't go below 1,500 for this client.");
  });
});
