import type { CreateMacroTargetInput, MacroTarget } from '../../api/macrosApi';
import { errorMessage } from '../../types/common';

/** Text the coach types into the "Set daily targets" form. */
export interface MacroTargetDraft {
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  notes: string;
}

type NumberField = Exclude<keyof MacroTargetDraft, 'notes'>;

// Same limits as the server's CreateMacroTargetDto (backend
// src/macros/macros.dto.ts), so a value the form accepts is never a 400.
export const MACRO_TARGET_LIMITS: Record<NumberField, { label: string; min: number; max: number; unit: string }> = {
  calories: { label: 'Calories', min: 800, max: 7000, unit: 'kcal' },
  protein: { label: 'Protein', min: 0, max: 500, unit: 'g' },
  carbs: { label: 'Carbs', min: 0, max: 900, unit: 'g' },
  fat: { label: 'Fat', min: 0, max: 400, unit: 'g' },
};

export const MACRO_TARGET_NOTE_MAX = 500;

const FIELDS: NumberField[] = ['calories', 'protein', 'carbs', 'fat'];

export function emptyMacroTargetDraft(): MacroTargetDraft {
  return { calories: '', protein: '', carbs: '', fat: '', notes: '' };
}

/** Prefill from the live target so a change starts from today's numbers. */
export function draftFromTarget(target: Pick<MacroTarget, 'calories_kcal' | 'protein_g' | 'carbs_g' | 'fats_g' | 'notes'> | null | undefined): MacroTargetDraft {
  if (!target) return emptyMacroTargetDraft();
  return {
    calories: String(target.calories_kcal),
    protein: String(target.protein_g),
    carbs: String(target.carbs_g),
    fat: String(target.fats_g),
    notes: target.notes ?? '',
  };
}

function parseWhole(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (text === '' || !/^\d+(\.\d+)?$/.test(text)) return null;
  return Math.round(Number(text));
}

export type MacroTargetValidation =
  | { ok: true; input: CreateMacroTargetInput }
  | { ok: false; message: string };

export function validateMacroTargetDraft(draft: MacroTargetDraft): MacroTargetValidation {
  const values: Partial<Record<NumberField, number>> = {};
  for (const field of FIELDS) {
    const { label, min, max, unit } = MACRO_TARGET_LIMITS[field];
    if (draft[field].trim() === '') {
      return { ok: false, message: `Enter ${label.toLowerCase()} in ${unit}.` };
    }
    const value = parseWhole(draft[field]);
    if (value === null) {
      return { ok: false, message: `${label} must be a whole number of ${unit}.` };
    }
    if (value < min || value > max) {
      return { ok: false, message: `${label} must be between ${min} and ${max} ${unit}.` };
    }
    values[field] = value;
  }
  const notes = draft.notes.trim();
  if (notes.length > MACRO_TARGET_NOTE_MAX) {
    return { ok: false, message: `The note can be up to ${MACRO_TARGET_NOTE_MAX} characters.` };
  }
  return {
    ok: true,
    input: {
      calories_kcal: values.calories as number,
      protein_g: values.protein as number,
      carbs_g: values.carbs as number,
      fats_g: values.fat as number,
      ...(notes ? { notes } : {}),
    },
  };
}

/** kcal implied by the grams (4 / 4 / 9), or null until all three are numbers. */
export function kcalFromMacros(draft: MacroTargetDraft): number | null {
  const p = parseWhole(draft.protein);
  const c = parseWhole(draft.carbs);
  const f = parseWhole(draft.fat);
  if (p === null || c === null || f === null) return null;
  return p * 4 + c * 4 + f * 9;
}

/** Specific copy for a failed save; the server rules are mirrored above. */
export function macroTargetSaveError(err: unknown): string {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 404) {
    return 'This client is not on your roster. Return to Clients and open a current client.';
  }
  if (status === 400) {
    return 'The server did not accept these numbers. Calories 800 to 7000 kcal, protein up to 500 g, carbs up to 900 g, fat up to 400 g.';
  }
  if (status === 429) {
    return 'Too many saves in one minute. Wait a moment, then save again.';
  }
  return errorMessage(err, 'The targets were not saved. Check the connection, then save again.');
}
