export interface SessionExercise {
  exerciseId: string;
  exerciseName: string;
  sets: SessionSet[];
  restSec?: number;
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
  };
};
