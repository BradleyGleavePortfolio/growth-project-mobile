export interface SessionExercise {
  exerciseId: string;
  exerciseName: string;
  sets: SessionSet[];
  restSec?: number;
  workoutPlanExerciseId?: string;
  /** Server MuscleGroup value saved with the workout (defaults to full_body). */
  muscleGroup?: string;
  notes?: string;
  /** The coach's note on a coach-assigned exercise, shown while training. */
  coachNote?: string;
}

export interface SessionSet {
  reps: number;
  weight: number;
  completed: boolean;
}

export interface RoutineExercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  restSec: number;
  workoutPlanExerciseId?: string;
  /** Coach target weight (lb) for coach-assigned workouts. */
  weightLbs?: number;
  /** Server MuscleGroup value for routine exercises. */
  muscleGroup?: string;
  /** The coach's note on a coach-assigned exercise. */
  coachNote?: string;
}

export interface Exercise {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  imageUrl?: string;
}

export type RouteParams = {
  ActiveWorkout: {
    routineId?: string;
    routineName: string;
    exercises: string;
    assignmentId?: string;
  };
};
