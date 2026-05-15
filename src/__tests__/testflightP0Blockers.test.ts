/**
 * Pre-TestFlight client P0 blockers — regression tests.
 *
 * Every test here ties back to a B-numbered audit item; if these go red
 * we have re-introduced the corresponding ship-blocker.
 */

import { calcMacros, parseQuantityInput, quantityMultiplier } from '../utils/log/macros';
import { mapFoodItem } from '../utils/log/mapFoodItem';
import {
  buildActiveWorkoutExercises,
  prettifyExerciseName,
} from '../utils/workout/buildActiveWorkout';
import {
  manualExerciseId,
  routineExerciseId,
  slugifyExerciseName,
} from '../utils/workout/exerciseId';
import { resolveExerciseMedia } from '../utils/workout/exerciseMedia';
import {
  extractClientAllergies,
  extractClientDietaryRestrictions,
} from '../utils/coach/clientSafetyContext';

// ── B1 ──────────────────────────────────────────────────────────────────────
describe('B1 — coach-assigned workouts can be opened', () => {
  it('builds a session payload from a WorkoutPlan with real ids', () => {
    const plan = {
      exercises: [
        {
          id: 'row-2',
          workout_plan_id: 'p1',
          exercise_external_id: 'seed:back-squat',
          order: 2,
          sets: 5,
          reps_or_duration_seconds: 5,
          weight_lbs: 225,
          rest_seconds: 180,
          superset_group_id: null,
          notes: null,
        },
        {
          id: 'row-1',
          workout_plan_id: 'p1',
          exercise_external_id: 'seed:bench-press',
          order: 1,
          sets: 3,
          reps_or_duration_seconds: 8,
          weight_lbs: null,
          rest_seconds: null,
          superset_group_id: null,
          notes: 'warm up gently',
        },
      ],
    };
    const out = buildActiveWorkoutExercises(plan);
    // sorted by order
    expect(out.map((e) => e.exerciseId)).toEqual([
      'seed:bench-press',
      'seed:back-squat',
    ]);
    // names are prettified, never blank
    expect(out[0].exerciseName).toBe('Bench Press');
    expect(out[1].exerciseName).toBe('Back Squat');
    // rest fallback to 60s when null
    expect(out[0].restSec).toBe(60);
    expect(out[1].restSec).toBe(180);
  });

  it('falls back to a plan-scoped id when external id is missing', () => {
    const out = buildActiveWorkoutExercises({
      exercises: [
        {
          id: 'row-1',
          workout_plan_id: 'p1',
          exercise_external_id: '',
          order: 1,
          sets: 3,
          reps_or_duration_seconds: 10,
          weight_lbs: null,
          rest_seconds: null,
          superset_group_id: null,
          notes: null,
        },
      ],
    });
    expect(out[0].exerciseId).toMatch(/^plan-exercise:row-1$/);
  });

  it('prettifyExerciseName: numeric ExerciseDB ids fall back', () => {
    expect(prettifyExerciseName('0001')).toBe('Exercise');
    expect(prettifyExerciseName('')).toBe('');
    expect(prettifyExerciseName('seed:dumbbell_row')).toBe('Dumbbell Row');
  });
});

// ── B2 ──────────────────────────────────────────────────────────────────────
describe('B2 — empty exerciseId no longer flows into writes', () => {
  it('slugifies safely', () => {
    expect(slugifyExerciseName('Romanian Dead-Lift')).toBe('romanian-dead-lift');
    expect(slugifyExerciseName('  ')).toBe('');
    expect(slugifyExerciseName('Squat')).toBe('squat');
  });

  it('produces stable, prefixed ids for routines and manual entries', () => {
    expect(routineExerciseId('r1', 'Bench Press')).toBe('routine:r1/bench-press');
    expect(manualExerciseId('Bench Press')).toBe('manual:bench-press');
    // Unnamed fallbacks still produce a real id, never ''.
    expect(routineExerciseId('r1', '')).toBe('routine:r1/unnamed');
    expect(manualExerciseId('')).toBe('manual:unnamed');
  });
});

// ── B3 ──────────────────────────────────────────────────────────────────────
describe('B3 — exercise media resolves honestly', () => {
  it('prefers a direct video_url when present', () => {
    const r = resolveExerciseMedia({ video_url: 'https://cdn/demo.mp4', gifUrl: 'g' });
    expect(r).toEqual({ kind: 'video', uri: 'https://cdn/demo.mp4' });
  });

  it('builds the Mux HLS URL from playback id', () => {
    const r = resolveExerciseMedia({ mux_playback_id: 'abc123' });
    expect(r.kind).toBe('video');
    expect(r.uri).toBe('https://stream.mux.com/abc123.m3u8');
  });

  it('falls back to gif, then to none — never fabricates a URL', () => {
    expect(resolveExerciseMedia({ gifUrl: 'g.gif' })).toEqual({ kind: 'gif', uri: 'g.gif' });
    expect(resolveExerciseMedia({})).toEqual({ kind: 'none', uri: null });
    expect(resolveExerciseMedia(null)).toEqual({ kind: 'none', uri: null });
    expect(resolveExerciseMedia({ gifUrl: '   ' })).toEqual({ kind: 'none', uri: null });
  });
});

// ── B4 ──────────────────────────────────────────────────────────────────────
describe('B4 — food logger no longer silently saves zeros', () => {
  it('mapFoodItem leaves macros NaN when every candidate is missing', () => {
    const out = mapFoodItem({ name: 'mystery' });
    expect(Number.isNaN(out.calories)).toBe(true);
    expect(Number.isNaN(out.protein)).toBe(true);
    expect(Number.isNaN(out.carbs)).toBe(true);
    expect(Number.isNaN(out.fat)).toBe(true);
  });

  it('infers PER_SERVING basis from calories_per_serving only', () => {
    expect(mapFoodItem({ name: 'x', calories_per_serving: 150 }).nutrient_basis).toBe(
      'PER_SERVING',
    );
    expect(mapFoodItem({ name: 'x', calories: 150 }).nutrient_basis).toBe('PER_100G');
  });

  it('calcMacros stays NaN-safe on missing inputs', () => {
    const f = mapFoodItem({ name: 'm', calories: NaN as never, protein_g: 10 });
    const bundle = calcMacros(f, 100, 'g');
    expect(Number.isNaN(bundle.calories)).toBe(true);
    expect(bundle.protein).toBeCloseTo(10);
  });

  it('parseQuantityInput accepts comma decimals and rejects garbage', () => {
    expect(parseQuantityInput('1.5')).toBe(1.5);
    expect(parseQuantityInput('0,75')).toBe(0.75);
    expect(parseQuantityInput('  2  ')).toBe(2);
    expect(parseQuantityInput('')).toBeNull();
    expect(parseQuantityInput('abc')).toBeNull();
    expect(parseQuantityInput('-1')).toBeNull();
    expect(parseQuantityInput(0)).toBeNull();
    expect(parseQuantityInput(3)).toBe(3);
  });

  it('quantityMultiplier preserves per-serving semantics', () => {
    // PER_SERVING rows: qty IS the multiplier, full stop.
    const food = { nutrient_basis: 'PER_SERVING' as const };
    expect(quantityMultiplier(food, 2, 'serving')).toBe(2);
    expect(quantityMultiplier(food, 1.5, 'g')).toBe(1.5);
  });
});

// ── B14 ─────────────────────────────────────────────────────────────────────
describe('B14 — allergies / dietary restrictions extraction', () => {
  it('returns undefined for missing profile (unanswered, not "none")', () => {
    expect(extractClientAllergies(null)).toBeUndefined();
    expect(extractClientDietaryRestrictions(undefined)).toBeUndefined();
  });

  it('coerces csv strings and arrays into clean string arrays', () => {
    expect(extractClientAllergies({ allergies: ['peanut', 'shellfish'] })).toEqual([
      'peanut',
      'shellfish',
    ]);
    expect(
      extractClientDietaryRestrictions({ diet_restrictions: 'gluten_free, vegan' }),
    ).toEqual(['gluten_free', 'vegan']);
  });

  it('honors an empty array as "user answered: none"', () => {
    expect(extractClientAllergies({ allergies: [] })).toEqual([]);
    expect(extractClientDietaryRestrictions({ diet_restrictions: '' })).toEqual([]);
  });
});
