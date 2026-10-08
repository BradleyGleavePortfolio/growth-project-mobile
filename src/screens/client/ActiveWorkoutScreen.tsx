import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  FlatList,
  AppState,
  AppStateStatus,
  ActivityIndicator,
  type AlertButton,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';

import { getAllExercises } from '../../db/workoutDb';
import { useCreateWorkout } from '../../hooks/useApi';
import { track } from '../../lib/analytics';
import { HapticService } from '../../ui/haptics/haptics.service';
import * as Notifications from 'expo-notifications';
import { AnalyticsEvents } from '../../analytics/events';
import { useTheme } from '../../theme/ThemeProvider';
import { workoutBuilderApi } from '../../api/workoutBuilderApi';
import {
  loadActiveWorkoutSession,
  saveActiveWorkoutSession,
  clearActiveWorkoutSession,
  type PersistedActiveWorkoutSession,
} from '../../storage/activeWorkoutSession';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { errorMessage } from '../../types/common';
import { randomUuid } from '../../utils/idempotency';
import { toServerMuscleGroup } from '../../utils/workout/muscleGroup';
import { assignmentIdempotencyKey, localCalendarDate, resumedSessionRouteParams } from '../../utils/workout/workoutLogging';
// Offline-first write path (audit fix H-5: comments were left
// referencing the deleted WatermelonDB stack — current implementation
// is built on expo-sqlite, see src/offline/database.ts and
// docs/offline-architecture.md).
//
// The workout is saved to the local expo-sqlite store first with
// sync_status='pending'. The sync engine pushes it to the server when
// connectivity allows.
import {
  queueWorkout,
  settleQueuedWorkout,
  releaseQueuedWorkout,
  triggerSync,
} from '../../offline';

// NB: the local exercise_logs SQLite table (logExerciseWithVolume) is
// no longer written to. Volume aggregation now happens on the server
// from the workouts created by useCreateWorkout, so HomeScreen and the
// coach dashboard stay in sync. The exercise *catalog* (getAllExercises)
// is still local because it is static reference data, not per-user state.
//
// Sync sequence: createWorkout.mutate() is called after the local
// expo-sqlite write. If the API call fails (offline), the row stays as
// 'pending' and the sync engine retries on reconnect via NetInfo. Other
// surfaces (food logs, habits, body weight) are follow-ups.

import { makeStyles } from './active-workout/styles';
import type {
  Exercise,
  RouteParams,
  RoutineExercise,
  SessionExercise,
  SessionSet,
} from './active-workout/types';
import { ExerciseImage, MUSCLES, lookupMuscleColor, makeMuscleColors } from './active-workout/ExerciseImage';
import { ExerciseCard } from './active-workout/ExerciseCard';
import WorkoutFinishSummary from './active-workout/WorkoutFinishSummary';
import { workoutApi } from '../../services/api';
import { completedExercisePayload, moveExercise, newSessionExercise, previousSets, swapExercise, workoutSummary, type LoggedWorkout } from './active-workout/sessionQuality';
import { featureFlags } from '../../config/featureFlags';
import { logger } from '../../utils/logger';
import { buildCompletionLogBase, normalizeError } from './_completionLogging';
import { setWorkoutLeaveGuard } from '../../navigation/workoutLeaveGuard';
// §2.9 Voice-log confirmation — Roman reads back the most recently completed
// set in his voice, beside his face (RomanVoiceLogReadback co-locates
// <RomanAvatar />). No dedicated voice-capture screen exists in the app yet;
// per the builder brief this wires to the closest real surface — the live
// set-logging flow on ActiveWorkoutScreen (documented in the report). Gated
// behind featureFlags.romanChat (default OFF).
import RomanVoiceLogReadback from '../../components/roman/RomanVoiceLogReadback';

// Debounce window for persistence writes. Mutations happen rapidly while
// the user is logging sets; coalescing them into a single AsyncStorage
// write keeps the storage layer cheap while never losing more than
// ~500ms of state if the process is killed mid-set.
const PERSIST_DEBOUNCE_MS = 500;

// The app always mounts a QueryClientProvider; a few host-wiring tests
// render this screen without one. useContext runs on every render either
// way, so hook order is stable.
function useOptionalQueryClient() {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

// R11 D-002: the completion-path logger requires a structured error
// (name/message/stack). `normalizeError` now lives in ./_completionLogging so
// the producer and the WorkoutScreen consumer share one normaliser and log an
// identically-shaped `error` field.

/** DES-R-127: rest-end alert copy. Names the next unlogged set from the exercise just rested on. */
function restOverMessage(exercises: SessionExercise[], fromExercise: number): string {
  for (let k = 0; k < exercises.length; k++) {
    const exercise = exercises[(fromExercise + k) % exercises.length];
    const setIndex = exercise.sets.findIndex((s) => !s.completed);
    if (setIndex >= 0) return `Rest over. Next: ${exercise.exerciseName}, set ${setIndex + 1}.`;
  }
  return 'Rest over.';
}

function dropRestAlert(id: string): void {
  Notifications.cancelScheduledNotificationAsync(id).catch((error: unknown) => {
    logger.warn('workout.rest-alert.cancel', { error: normalizeError(error) });
  });
}

export default function ActiveWorkoutScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const muscleColors = useMemo(() => makeMuscleColors(colors), [colors]);
  const route = useRoute<RouteProp<RouteParams, 'ActiveWorkout'>>();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { routineName, exercises: exercisesJson, assignmentId } = route.params;
  // Set by the Workouts tab "Resume workout" card: adopt the saved session
  // without asking again.
  const resumeRequested = (route.params as { resume?: boolean }).resume === true;
  // Per-R15 the persisted session key is scoped to the current user
  // (`active_workout_session:<userId>`). The user id resolves
  // asynchronously on cold start (useCurrentUser reads from MMKV/Async),
  // so the persistence effect and the restore-on-mount effect both
  // wait on it before touching storage.
  const currentUser = useCurrentUser();
  const userId = currentUser?.id ?? '';

  const [sessionExercises, setSessionExercises] = useState<SessionExercise[]>([]);
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [history, setHistory] = useState<LoggedWorkout[]>([]);
  const [historyState, setHistoryState] = useState<'loading' | 'loaded' | 'unavailable'>('loading');
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  // Elapsed seconds is always recomputed from a wallclock anchor — the
  // setInterval tick only forces a re-render. This is what makes the
  // timer robust to JS-thread suspension when the app is backgrounded.
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wallclock anchor for the running timer. A resumed session carries
  // forward the original start instant; a fresh session anchors to now.
  const sessionStartMsRef = useRef<number>(Date.now());
  // Tracks the most recently computed elapsed value (in milliseconds) so
  // we can re-anchor `sessionStartMsRef` if the device wallclock moves
  // backwards (NTP correction, manual user change) while the screen is
  // mounted. Without this, `Date.now() - sessionStartMsRef.current` would
  // clamp to 0 via Math.max and the timer would appear to freeze until
  // real time catches back up. See the AppState 'active' handler for the
  // re-anchor branch.
  const lastKnownElapsedMsRef = useRef<number>(0);
  // Track session start time for assignment completion payload.
  const sessionStartTimeRef = useRef<Date>(new Date());
  // Stable idempotency key generated once at session start. Held in a
  // ref so it can be swapped on resume without re-rendering.
  const idempotencyKeyRef = useRef<string>(assignmentId ? randomUuid() : '');
  // Offline queue key for this workout session. Fixed at the first Finish so
  // tapping Finish again updates the one queued copy instead of adding one.
  const queueKeyRef = useRef<string>('');
  // Gates the persistence effect until we've decided whether we are
  // creating a fresh session or restoring a stored one. Without this
  // gate the initial empty `sessionExercises` value would overwrite a
  // real stored session before we got a chance to load it.
  const [hydrated, setHydrated] = useState(false);
  // Suppresses the persistence write between the user tapping "Finish"
  // (where we clear the stored session) and the navigation completing.
  const finishingRef = useRef(false);
  // Debounce timer for the persistence write effect.
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest payload the debounced persistence effect would have written.
  // Refreshed at the top of every persistence-effect run; consumed by
  // the background-flush path so backgrounding the app immediately writes
  // the most recent mutation to AsyncStorage instead of losing it if the
  // OS kills the process before the debounce fires.
  const pendingPersistPayloadRef = useRef<Parameters<typeof saveActiveWorkoutSession>[1] | null>(null);
  // StrictMode hygiene — under React 18 dev double-invoke the mount-time
  // restore effect would run twice and stack two "Resume?" prompts on
  // first foreground. The ref short-circuits the second invocation. No
  // effect in production (StrictMode does not ship), but the dev surface
  // is cleaner and the guard is essentially free.
  const promptShownRef = useRef(false);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restActive, setRestActive] = useState(false);
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restEndsAtRef = useRef(0);
  const [showAddModal, setShowAddModal] = useState(false);
  // True from the Finish confirmation until the server answers. Blocks a
  // second Finish (which logged the workout twice) and shows progress.
  const [saving, setSaving] = useState(false);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredExercises, setFilteredExercises] = useState<Exercise[]>([]);
  const [selectedMuscle, setSelectedMuscle] = useState('All');
  const createWorkout = useCreateWorkout();
  const summary = useMemo(() => workoutSummary(sessionExercises, history), [sessionExercises, history]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setHistory([]);
    setHistoryState('loading');
    workoutApi.getAll(50).then(({ data }) => {
      if (!active) return;
      setHistory(Array.isArray(data) ? data : []);
      setHistoryState('loaded');
    }).catch(() => { if (active) setHistoryState('unavailable'); });
    return () => { active = false; };
  }, [userId]);
  const queryClient = useOptionalQueryClient();

  // Default (fresh) session exercises derived from the routine param.
  // Pulled out so the restore effect can fall back to it cleanly when
  // no stored session is found.
  const defaultSessionExercises = useMemo<SessionExercise[]>(() => {
    try {
      const routineExs: RoutineExercise[] = JSON.parse(exercisesJson);
      return routineExs.map((re) => ({
        exerciseId: re.exerciseId,
        exerciseName: re.exerciseName,
        sets: Array.from({ length: re.sets }, () => ({
          reps: re.reps,
          // Coach-assigned workouts carry the coach's target weight; start
          // each set at it so the client only edits what changed.
          weight: re.weightLbs && re.weightLbs > 0 ? re.weightLbs : 0,
          completed: false,
        })),
        restSec: re.restSec,
        workoutPlanExerciseId: re.workoutPlanExerciseId,
        muscleGroup: re.muscleGroup,
        // FU-WORKLOG-126: the coach's cue stays visible mid-workout.
        ...(re.coachNote ? { coachNote: re.coachNote } : {}),
      }));
    } catch (err) {
      // Best-effort parse of the routine JSON on screen mount. An empty
      // list lets the user add exercises manually instead of crashing
      // the screen.
      console.error('ActiveWorkoutScreen: routine exercises parse failed', err);
      return [];
    }
  }, [exercisesJson]);

  // Recompute elapsed seconds from the wallclock anchor. Called by the
  // interval tick AND on every foreground transition — the anchor is
  // the source of truth, the `timer` state is just a render trigger.
  // Also caches the latest elapsed-ms value so the AppState 'active'
  // handler can re-anchor if the wallclock has moved backwards.
  const recomputeElapsed = useCallback(() => {
    const elapsedMs = Math.max(0, Date.now() - sessionStartMsRef.current);
    lastKnownElapsedMsRef.current = elapsedMs;
    setTimer(Math.floor(elapsedMs / 1000));
  }, []);

  // Adopt a persisted session into local state.
  const adoptPersistedSession = useCallback(
    (session: PersistedActiveWorkoutSession) => {
      sessionStartMsRef.current = session.startedAtMs;
      sessionStartTimeRef.current = new Date(session.startedAtMs);
      idempotencyKeyRef.current = session.idempotencyKey;
      setSessionExercises(session.sessionExercises);
      setWorkoutNotes(session.workoutNotes ?? '');
      const elapsedMs = Math.max(0, Date.now() - session.startedAtMs);
      lastKnownElapsedMsRef.current = elapsedMs;
      setTimer(Math.floor(elapsedMs / 1000));
    },
    [],
  );

  // Restore-on-mount. Decides between three states:
  //   1. No stored session → start a fresh one.
  //   2. Stored session, fresh (< 12h) → prompt the user to resume.
  //   3. Stored session, stale (>= 12h) → still prompt, but make it
  //      explicit so they don't accidentally resume a workout from
  //      yesterday with mismatched timing.
  useEffect(() => {
    // Wait for the userId to resolve before reading from storage —
    // the persisted key is scoped to the current user (R15). On cold
    // start useCurrentUser is async; we re-run when it resolves.
    if (!userId) return;
    // StrictMode double-invoke guard: the dev runtime re-runs mount-time
    // effects twice, which without this short-circuit would stack two
    // copies of the "Resume?" Alert. The first invocation gets to do the
    // load + prompt; subsequent invocations exit immediately. No effect
    // in production builds. Placed after the userId gate so the guard
    // isn't burned by an early empty-userId render.
    if (promptShownRef.current) return;
    promptShownRef.current = true;
    let cancelled = false;
    (async () => {
      let result: Awaited<ReturnType<typeof loadActiveWorkoutSession>> = null;
      try {
        result = await loadActiveWorkoutSession(userId);
      } catch {
        // Even on a load failure we still mount a usable screen.
        result = null;
      }
      if (cancelled) return;
      if (!result) {
        setSessionExercises(defaultSessionExercises);
        setHydrated(true);
        return;
      }
      const { session } = result;
      // TRAIN-GATE-128 (owner 15:03 10-07): an unfinished workout is never
      // deleted from the return path. Opening the workout screen goes straight
      // back into it, with its own name, coach assignment and sets; there is
      // no prompt and no "start fresh" choice.
      if (!resumeRequested) {
        // FU-WORKLOG2-126: opened from Quick Workout, a routine or another
        // coach workout, carry the saved workout's own name and assignment.
        const carried = resumedSessionRouteParams(session, {
          routineName,
          exercises: exercisesJson,
          assignmentId,
        });
        if (carried) navigation.setParams(carried);
      }
      adoptPersistedSession(session);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // Re-runs when userId resolves on cold start. Other inputs
    // (route params, defaultSessionExercises) are stable for the
    // lifetime of the navigator entry; the promptShownRef guard
    // above makes the body idempotent regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // (Fix #2) Removed AsyncStorage user_data read — the backend resolves the
  // current user from the JWT, so we don't need a local user_id to write
  // workouts anymore.

  // Foreground tick. The interval is purely a render driver — the
  // actual elapsed value is always derived from the wallclock anchor,
  // so any drift from background suspension is corrected on the next
  // tick.
  const startTimerInterval = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(recomputeElapsed, 1000);
  }, [recomputeElapsed]);

  const stopTimerInterval = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    startTimerInterval();
    return () => stopTimerInterval();
  }, [startTimerInterval, stopTimerInterval]);

  // Force-flush the pending debounced persistence write. Called from the
  // AppState background branch so the last mutation reaches AsyncStorage
  // before the OS gets a chance to kill the process — without this, a
  // user logging a set and then immediately backgrounding the app loses
  // that set if the OS reclaims the process within the 500ms debounce
  // window. Idempotent: clears the debounce timer either way, no-ops if
  // there is no pending payload.
  const flushPendingPersist = useCallback(() => {
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = null;
    }
    const payload = pendingPersistPayloadRef.current;
    if (!payload || finishingRef.current || !userId) return;
    saveActiveWorkoutSession(userId, payload).catch((err) => {
      if (__DEV__) console.warn('[ActiveWorkout] background flush failed', err);
    });
  }, [userId]);

  // AppState handling.
  //   - background / inactive: flush any pending debounced write, then
  //     drop the interval. RN already throttles JS timers in the
  //     background, but freeing the interval is explicit and avoids
  //     burning a wakeup on iOS.
  //   - active: detect a wallclock rollback (NTP correction, manual user
  //     change moving the clock backwards) and re-anchor so the timer
  //     doesn't appear to freeze; recompute elapsed; restart the tick.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        // Clock-rollback detection: if Date.now() is earlier than our
        // anchor the elapsed math would clamp to 0 and the timer would
        // look frozen. Re-anchor to "now minus last known elapsed" so
        // the displayed value is continuous from the user's POV.
        if (Date.now() < sessionStartMsRef.current) {
          sessionStartMsRef.current = Date.now() - lastKnownElapsedMsRef.current;
        }
        recomputeElapsed();
        startTimerInterval();
      } else if (next === 'background' || next === 'inactive') {
        flushPendingPersist();
        stopTimerInterval();
      }
    });
    return () => sub.remove();
  }, [recomputeElapsed, startTimerInterval, stopTimerInterval, flushPendingPersist]);

  // Debounced persistence. Fires on every mutation of working state.
  // We re-arm the timer on every change so several mutations within
  // the PERSIST_DEBOUNCE_MS window collapse into a single write that
  // captures the latest value. The "pending payload" is captured into
  // a ref synchronously at the top of each effect run so the
  // background-flush path always has the latest mutation to write
  // even if it fires between debounce-arm and debounce-fire.
  useEffect(() => {
    if (!hydrated || finishingRef.current || !userId) return;
    const payload = {
      startedAtMs: sessionStartMsRef.current,
      routineName,
      exercisesJson,
      assignmentId,
      idempotencyKey: idempotencyKeyRef.current,
      sessionExercises,
      workoutNotes,
    };
    pendingPersistPayloadRef.current = payload;
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    persistDebounceRef.current = setTimeout(() => {
      saveActiveWorkoutSession(userId, payload).catch((err) => {
        if (__DEV__) console.warn('[ActiveWorkout] persistence write failed', err);
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistDebounceRef.current) {
        clearTimeout(persistDebounceRef.current);
        persistDebounceRef.current = null;
      }
    };
  }, [hydrated, sessionExercises, workoutNotes, routineName, exercisesJson, assignmentId, userId]);

  // DES-R-127: one local rest-end alert, set when the app goes to the background during a rest and only
  // if notification permission is already granted (never prompts). Cancelled on return to the app, Skip,
  // +30s, a new rest, Finish, Discard and leaving the screen.
  const restAlertIdRef = useRef<string | null>(null);
  const restAlertGenRef = useRef(0); // bumped on every cancel
  const restFromExerciseRef = useRef(0);
  const sessionExercisesRef = useRef(sessionExercises);
  useEffect(() => {
    sessionExercisesRef.current = sessionExercises;
  }, [sessionExercises]);

  const cancelRestAlert = useCallback(() => {
    restAlertGenRef.current += 1;
    if (restAlertIdRef.current) dropRestAlert(restAlertIdRef.current);
    restAlertIdRef.current = null;
  }, []);

  const scheduleRestAlert = useCallback(async () => {
    cancelRestAlert();
    if (finishingRef.current) return;
    const gen = restAlertGenRef.current;
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const seconds = Math.floor((restEndsAtRef.current - Date.now()) / 1000);
      if (status !== 'granted' || seconds < 1 || gen !== restAlertGenRef.current) return;
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          body: restOverMessage(sessionExercisesRef.current, restFromExerciseRef.current),
          sound: true,
          data: { type: 'rest_over' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
      });
      // Back in the app before the schedule finished: drop it.
      if (gen === restAlertGenRef.current) restAlertIdRef.current = id;
      else dropRestAlert(id);
    } catch (error) {
      logger.warn('workout.rest-alert.schedule', { error: normalizeError(error) });
    }
  }, [cancelRestAlert]);

  // Rest timer cleanup.
  useEffect(() => {
    return () => {
      if (restIntervalRef.current) clearInterval(restIntervalRef.current);
      cancelRestAlert();
    };
  }, [cancelRestAlert]);

  const refreshRest = useCallback(() => {
    const seconds = Math.max(0, Math.ceil((restEndsAtRef.current - Date.now()) / 1000));
    setRestSeconds(seconds);
    if (seconds === 0) {
      if (restIntervalRef.current) clearInterval(restIntervalRef.current);
      restIntervalRef.current = null;
      setRestActive(false);
      HapticService.heavyImpact();
    }
  }, []);

  useEffect(() => {
    if (!restActive) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        cancelRestAlert();
        refreshRest();
      } else if (state === 'background') {
        void scheduleRestAlert();
      }
    });
    return () => subscription.remove();
  }, [restActive, refreshRest, cancelRestAlert, scheduleRestAlert]);

  const startRest = (seconds: number, fromExercise = 0) => {
    if (seconds <= 0) return;
    if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    cancelRestAlert();
    restFromExerciseRef.current = fromExercise;
    setRestSeconds(seconds);
    setRestActive(true);
    restEndsAtRef.current = Date.now() + seconds * 1000;
    restIntervalRef.current = setInterval(refreshRest, 1000);
  };

  const formatTime = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const updateSet = <K extends keyof SessionSet>(exIdx: number, setIdx: number, field: K, value: SessionSet[K]) => {
    setSessionExercises((prev) => {
      const updated = [...prev];
      const sets = [...updated[exIdx].sets];
      sets[setIdx] = { ...sets[setIdx], [field]: value };
      updated[exIdx] = { ...updated[exIdx], sets };
      return updated;
    });
  };

  const toggleSetComplete = (exIdx: number, setIdx: number) => {
    const wasCompleted = sessionExercises[exIdx].sets[setIdx].completed;
    updateSet(exIdx, setIdx, 'completed', !wasCompleted);
    if (!wasCompleted) {
      // Set just marked complete — start rest timer.
      const rest = sessionExercises[exIdx].restSec ?? 0;
      startRest(rest, exIdx);
    } else {
      // Toggling back to incomplete — cancel rest timer.
      if (restActive) {
        if (restIntervalRef.current) clearInterval(restIntervalRef.current);
        restIntervalRef.current = null;
        setRestActive(false);
      }
    }
  };

  const addSet = (exIdx: number) => {
    setSessionExercises((prev) => {
      const updated = [...prev];
      const lastSet = updated[exIdx].sets[updated[exIdx].sets.length - 1];
      updated[exIdx] = {
        ...updated[exIdx],
        sets: [...updated[exIdx].sets, { reps: lastSet?.reps || 10, weight: lastSet?.weight || 0, completed: false }],
      };
      return updated;
    });
  };

  const removeExercise = (exIdx: number) => {
    const target = sessionExercises[exIdx];
    if (!target) return;
    const drop = () => setSessionExercises((prev) => prev.filter((_, i) => i !== exIdx));
    // A mis-tap on the trash icon used to delete an exercise and every set
    // already logged for it, with no undo. Ask first when there is logged work.
    if (!target.sets.some((s) => s.completed)) {
      drop();
      return;
    }
    Alert.alert(
      `Remove ${target.exerciseName}?`,
      'The sets logged for this exercise will be removed from this workout.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: drop },
      ],
    );
  };

  const openExerciseDetail = (exercise: SessionExercise) => {
    // W-5 fix: prefer the catalog id when the upstream
    // routine carries it (coach-assigned workouts always
    // do; legacy local routines may not). Falling back to a
    // slug derived from the human-readable name only when
    // no id is present — the slug hit the "Exercise not
    // found" path for almost every entry because the
    // backend catalog is keyed on the real exercise id, not
    // a name slug.
    const idOrSlug =
      (exercise.exerciseId && exercise.exerciseId.trim()) ||
      exercise.exerciseName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).navigate('ExerciseDetail', {
      idOrSlug,
    });
  };

  const openAddExercise = async (index: number | null = null) => {
    setSwapIndex(index);
    setShowAddModal(true);
    setSearchQuery('');
    setSelectedMuscle('All');
    try {
      const all = await getAllExercises();
      setAllExercises(all);
      setFilteredExercises(all);
    } catch {
      setShowAddModal(false);
      // FU-WORKLOG2-126: a failed Swap used to say "try Add Exercise again".
      Alert.alert('Exercise list unavailable', `The exercise list did not load. Keep this workout open and try ${index === null ? 'Add Exercise' : 'Swap'} again.`);
    }
  };

  const filterExercises = (query: string, muscle: string) => {
    let results = allExercises;

    // Apply muscle filter — case-insensitive comparison, 'All' returns everything
    if (muscle !== 'All') {
      results = results.filter(
        (e) => e.muscle.toLowerCase() === muscle.toLowerCase()
      );
    }

    // Apply text search (no minimum length restriction — even 1 char is valid)
    if (query.trim().length > 0) {
      const q = query.toLowerCase().trim();
      results = results.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.muscle.toLowerCase().includes(q) ||
          e.equipment.toLowerCase().includes(q)
      );
    }

    setFilteredExercises(results);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    filterExercises(query, selectedMuscle);
  };

  const handleMuscleFilter = (muscle: string) => {
    setSelectedMuscle(muscle);
    filterExercises(searchQuery, muscle);
  };

  const addExerciseToSession = (exercise: Exercise) => {
    setSessionExercises((prev) => swapIndex === null
      ? [...prev, newSessionExercise(exercise)]
      : swapExercise(prev, swapIndex, exercise));
    setShowAddModal(false);
    setSwapIndex(null);
  };

  const requestSwap = (index: number) => {
    const exercise = sessionExercises[index];
    if (!exercise.sets.some((s) => s.completed)) {
      void openAddExercise(index);
      return;
    }
    Alert.alert('Swap remaining sets?', `Logged sets stay under ${exercise.exerciseName}. The replacement starts with unlogged sets.`, [
      { text: 'Keep exercise', style: 'cancel' },
      { text: 'Choose replacement', onPress: () => { void openAddExercise(index); } },
    ]);
  };

  const finishWorkout = (confirmed = false) => {
    if (saving) return;
    const completedSets = sessionExercises.reduce((sum, ex) => sum + ex.sets.filter((s) => s.completed).length, 0);
    if (completedSets === 0) {
      Alert.alert('No sets completed', 'Complete at least one set before finishing.');
      return;
    }
    const recordLines = summary.records.map((r) => `Recent best: ${r.name} · ${r.weight} lb`).join('\n');
    const finishMessage = `${completedSets} sets completed · ${summary.exercises} exercises · ${summary.volume.toLocaleString()} lb volume${recordLines ? `\n${recordLines}\nCompared with the last 50 saved workouts.` : ''}${completedSets < sessionExercises.reduce((n, ex) => n + ex.sets.length, 0) ? '\nUnfinished sets will not be saved.' : ''}`;
    const finishButtons: AlertButton[] = [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        // Offline-first write (audit fix H-5: comments were left
        // describing the deleted WatermelonDB stack — current
        // implementation is built on expo-sqlite via src/offline,
        // see docs/offline-architecture.md):
        //   1. Queue the whole workout (the exact POST body) as one
        //      row in the local expo-sqlite store, keyed by session.
        //   2. Attempt the server POST via createWorkout.mutate
        //      (network-optional).
        //   3. If the network call succeeds the row is marked 'synced'.
        //   4. With no answer the row stays 'pending', the client is
        //      told it is saved, and the sync engine sends it (and any
        //      coach assignment completion) on reconnect / foreground.
        onPress: async () => {
          // Suppress the debounced persistence write that would
          // otherwise race the post-durable-write clear() and re-create
          // the entry. Also null the pending payload ref so the
          // background-flush path can't write between this tap and the
          // clear completing.
          finishingRef.current = true;
          cancelRestAlert();
          setSaving(true);
          if (persistDebounceRef.current) {
            clearTimeout(persistDebounceRef.current);
            persistDebounceRef.current = null;
          }
          pendingPersistPayloadRef.current = null;
          if (timerRef.current) clearInterval(timerRef.current);
          const durationMinutes = Math.round(timer / 60);
          const completedExercises = sessionExercises.filter((e) =>
            e.sets.some((s) => s.completed),
          );

          // R18: do NOT clear the recovery session before a durable
          // replacement save has completed. We clear only after the
          // local SQLite write loop finishes successfully (first
          // durable checkpoint) — or, if local writes failed, after
          // the server mutation succeeds.
          let localWriteSucceeded = false;

          // R11 D-002 / R15 F1: shared diagnostic context for every
          // completion-path logger call. In a mixed coach/client app a
          // durability failure is useless without route + acting role + the
          // keys needed to segment it. The canonical base (route, userRole,
          // userKey, assignmentId, justCompletedId) is built via the shared
          // `buildCompletionLogBase` so the producer and the WorkoutScreen
          // consumer log an identically-shaped payload. `justCompletedId` is
          // the durable server id of the workout the producer is about to
          // hand off — it is the same value the §2.8 one-shot latches on, so
          // it is supplied per-call once the server mutation resolves. Before
          // that point (e.g. the pre-server local-write failure) it is not yet
          // knowable and is logged as the string 'unknown' rather than
          // undefined/null. `extraContext` carries the producer-only diagnostic
          // fields; `sessionId` is the local session_name correlation key
          // (= routineName). `checkpoint` is set by each call site to name
          // which durable checkpoint failed.
          const completionLogBaseCtx = {
            route: 'ActiveWorkout' as const,
            userRole: currentUser?.role ?? 'unknown',
            userKey: userId || undefined,
            assignmentId: assignmentId ?? undefined,
          };
          const completionLogExtra = {
            userId: userId || undefined,
            routineName: routineName ?? undefined,
            sessionId: routineName ?? undefined,
            completedSetCount: completedSets,
          };

          // The exact POST /workouts body. Queued on the phone first (one row
          // for the whole workout) and sent as-is, now or by the background
          // sync once there is signal.
          const workoutPayload = {
            // The server keeps a calendar date (@db.Date). Sending the
            // client's own calendar day keeps the history card on the day
            // the client trained instead of the UTC day.
            date: localCalendarDate(new Date()),
            workout_name: routineName || 'Workout',
            workout_type: 'strength',
            duration_minutes: durationMinutes,
            notes: workoutNotes,
            exercises: completedExercises.map(completedExercisePayload),
          };
          // Coach assignment completion (full exercise/set detail).
          const completionPayload = {
            exercises: sessionExercises.map((ex) => ({
              exerciseName: ex.exerciseName,
              workoutPlanExerciseId: ex.workoutPlanExerciseId ?? null,
              sets: ex.sets.map((s, i) => ({
                set_index: i + 1,
                status: s.completed ? 'completed' : 'skipped',
                actual_reps: s.reps,
                actual_weight_lbs: s.weight,
              })),
            })),
          };
          if (assignmentId) {
            idempotencyKeyRef.current = assignmentIdempotencyKey(idempotencyKeyRef.current);
          }
          if (!queueKeyRef.current) {
            queueKeyRef.current = `${userId || 'local'}:${sessionStartMsRef.current}`;
          }
          const queueKey = queueKeyRef.current;
          let queued = false;

          try {
            const result = await queueWorkout({
              clientKey: queueKey,
              payload: workoutPayload,
              userId: userId || null,
              sessionName: routineName,
              durationMinutes,
              assignment: assignmentId
                ? {
                    assignmentId,
                    input: {
                      completion_payload: completionPayload,
                      idempotency_key: idempotencyKeyRef.current,
                      started_at: sessionStartTimeRef.current.toISOString(),
                    },
                  }
                : null,
            });
            if (result.alreadySynced) {
              // This session already reached the server (saved earlier, then
              // the app was closed before the screen cleared). Never send it
              // a second time.
              if (userId) await clearActiveWorkoutSession(userId);
              setSaving(false);
              navigation.goBack();
              return;
            }
            queued = true;
            localWriteSucceeded = true;
            // R18: local SQLite write is the first durable checkpoint.
            // Now that at least one durable replacement save has
            // completed, it's safe to clear the recovery session.
            if (userId) await clearActiveWorkoutSession(userId);
          } catch (localErr) {
            // Non-fatal: still attempt the server call below. Recovery
            // session is intentionally NOT cleared here — it will be
            // cleared on server onSuccess as a fallback durable
            // checkpoint, or preserved on onError for retry. Surfaced through
            // the shared structured logger (not a raw dev-only console call)
            // so a persistently failing local durable write is diagnosable
            // rather than swallowed, matching the surrounding completion-path
            // catches.
            logger.warn('mwb.completion.local-write', {
              ...buildCompletionLogBase({
                ...completionLogBaseCtx,
                // Pre-server-write failure: the durable server id does not
                // exist yet, so the latch id is genuinely unknowable here.
                justCompletedId: 'unknown',
              }),
              ...completionLogExtra,
              checkpoint: 'local-sqlite-write',
              error: normalizeError(localErr),
            });
          }

          // Analytics — unchanged from before.
          track('workout_logged', {
            duration_minutes: durationMinutes,
            sets_completed: completedSets,
            exercise_count: completedExercises.length,
          });

          // Attempt the server save now. Without signal the queued row is
          // sent by the sync engine on the next reconnect / foreground.
          createWorkout.mutate(
            workoutPayload,
            {
              onSuccess: (data: unknown) => {
                if (timerRef.current) clearInterval(timerRef.current);
                // Resolve the durable server id up-front: it is both the
                // §2.8 one-shot latch payload and the `justCompletedId` every
                // post-write completion warn site must carry, so it has to be
                // in scope before the first warn below. Correlate by
                // `session_name` (= routineName, which both write paths share).
                const d = (data ?? {}) as { id?: string; workout?: { id?: string } };
                const serverId = String(d?.id ?? d?.workout?.id ?? '');
                // When the server returned no usable id the workout is durable
                // but un-keyable; log 'unknown' rather than an empty string so
                // the latch id is never blank.
                const justCompletedId = serverId || 'unknown';
                // R18 fallback: if the local SQLite write failed above,
                // the recovery session was not cleared yet. The server
                // mutation just succeeded — it's now durable on the
                // server, so clear the recovery session here.
                if (!localWriteSucceeded && userId) {
                  clearActiveWorkoutSession(userId).catch((error: unknown) => {
                    // Best-effort: the server save already succeeded, so the
                    // workout is durable; failing to clear the local recovery
                    // session is non-fatal (it reconciles on next pull). Still
                    // surfaced for diagnosis rather than swallowed silently.
                    logger.warn('mwb.completion.clear-recovery-session', {
                      ...buildCompletionLogBase({ ...completionLogBaseCtx, justCompletedId }),
                      ...completionLogExtra,
                      checkpoint: 'clear-recovery-session',
                      serverId: serverId || undefined,
                      error: normalizeError(error),
                    });
                  });
                }
                // DES-R-127: the finish moment is one success haptic.
                HapticService.success();
                // Psych Report #4: Analytics — workout_logged
                track(AnalyticsEvents.WORKOUT_COMPLETED, {
                  duration_minutes: Math.round(timer / 60),
                  sets_completed: completedSets,
                  exercise_count: sessionExercises.filter((e) => e.sets.some((s) => s.completed)).length,
                });
                // The queued copy of this workout is now on the server: mark it
                // sent so the background sync never posts it a second time.
                if (queued) {
                  Promise.resolve()
                    .then(() => settleQueuedWorkout(queueKey, serverId))
                    .catch((error: unknown) => {
                      logger.warn('mwb.completion.mark-session-synced', {
                        ...buildCompletionLogBase({ ...completionLogBaseCtx, justCompletedId }),
                        ...completionLogExtra,
                        checkpoint: 'mark-session-synced',
                        serverId: serverId || undefined,
                        error: normalizeError(error),
                      });
                    });
                }
                // Trigger sync so the newly created server record is
                // pulled back. Pending rows have been marked above so this
                // is now a one-way pull.
                triggerSync().catch((error: unknown) => {
                  // Non-fatal: the server record exists; the next sync cycle
                  // will pull it. Surfaced for diagnosis.
                  logger.warn('mwb.completion.trigger-sync', {
                    ...buildCompletionLogBase({ ...completionLogBaseCtx, justCompletedId }),
                    ...completionLogExtra,
                    checkpoint: 'trigger-sync',
                    serverId: serverId || undefined,
                    error: normalizeError(error),
                  });
                });

                // If this workout is linked to a coach assignment, call the
                // assignment completion endpoint with the full exercise/set
                // payload. Non-fatal — the generic workout is already saved.
                if (assignmentId) {
                  workoutBuilderApi.completeMyAssignment(assignmentId, {
                    completion_payload: completionPayload,
                    idempotency_key: idempotencyKeyRef.current,
                    started_at: sessionStartTimeRef.current.toISOString(),
                  }).then(() => {
                    // Refresh the "From your coach" card and the assignment
                    // detail so a finished workout stops being offered again.
                    queryClient?.invalidateQueries({ queryKey: ['assignments'] }).catch(() => undefined);
                  }).catch((error: unknown) => {
                    // Non-fatal: generic workout already saved above.
                    logger.warn('mwb.completion.assignment-sync', {
                      ...buildCompletionLogBase({ ...completionLogBaseCtx, justCompletedId }),
                      ...completionLogExtra,
                      checkpoint: 'assignment-sync',
                      serverId: serverId || undefined,
                      error: normalizeError(error),
                    });
                  });
                }

                // §2.8 one-shot completion signal: returning to WorkoutMain with
                // `justCompletedId` set to the DURABLE server id of the workout
                // just saved tells WorkoutScreen this is a REAL just-finished
                // workout (not a historical session) so Roman's "Workout
                // complete." line renders exactly once. The target is the same
                // screen goBack() would land on (WorkoutMain is directly beneath
                // ActiveWorkout in WorkoutStack), so this preserves the existing
                // back behaviour while carrying the id. Keying on the concrete
                // id (not a boolean) lets WorkoutScreen latch "already seen this
                // workout" durably, so a re-delivered param cannot re-fire the
                // celebration (P1-C-01). When the server did not return a usable
                // id we navigate WITHOUT the signal rather than fabricate one —
                // an un-keyable completion is not eligible for the one-shot.
                //
                // R11 D-001: this is the PRODUCER half of the P3 completion
                // signal and must be gated by the same master flag as the
                // consumer. With `romanChat` off we take the exact pre-P3 path
                // — `navigation.goBack()` with no `justCompletedId` param — so
                // no Roman signal is ever emitted, mirrored, latched, or
                // cleared while the feature is disabled.
                if (featureFlags.romanChat && serverId) {
                  navigation.navigate('WorkoutMain', { justCompletedId: serverId });
                } else {
                  navigation.goBack();
                }
              },
              onError: (err) => {
                setSaving(false);
                const status = (err as { response?: { status?: number } } | null)?.response?.status;
                const noAnswer = typeof status !== 'number' || status >= 500;
                if (queued && noAnswer) {
                  // No signal (or the server did not answer): the whole
                  // workout is already stored on the phone and the sync
                  // engine sends it, with the coach assignment, once the
                  // phone is back online. Nothing for the client to redo.
                  Promise.resolve()
                    .then(() => releaseQueuedWorkout(queueKey))
                    .catch(() => undefined);
                  HapticService.success();
                  navigation.goBack();
                  Alert.alert(
                    'Saved on this phone',
                    'No connection right now. The workout will be sent to your coach automatically once the phone is back online.',
                  );
                  return;
                }
                if (queued) {
                  // The server refused this body; park the queued copy so it is
                  // not retried. Tapping Finish again re-queues the same row.
                  Promise.resolve()
                    .then(() => releaseQueuedWorkout(queueKey, { rejected: true }))
                    .catch(() => undefined);
                }
                // Phase 11 / Track 3: error haptic on failed API action
                HapticService.error();
                // The Finish path cleared the persisted session and disabled
                // future writes by setting finishingRef. If the server save
                // fails the user is told to retry, but without resetting
                // these the next attempt has no recovery state — a force-
                // kill during the retry alert would lose the workout. Flip
                // persistence back on and re-save the current state so the
                // session is recoverable. See audit #4 / R7 / R18.
                finishingRef.current = false;
                if (userId) {
                  saveActiveWorkoutSession(userId, {
                    startedAtMs: sessionStartMsRef.current,
                    routineName,
                    exercisesJson,
                    assignmentId,
                    idempotencyKey: idempotencyKeyRef.current,
                    sessionExercises,
                    workoutNotes,
                  }).catch((error: unknown) => {
                    // Best-effort re-save so the session stays recoverable after
                    // a failed server save. Surfaced for diagnosis.
                    logger.warn('mwb.completion.resave-on-error', {
                      ...buildCompletionLogBase({
                        ...completionLogBaseCtx,
                        // The server save failed, so no durable id was minted;
                        // the latch id is unknowable on this path.
                        justCompletedId: 'unknown',
                      }),
                      ...completionLogExtra,
                      checkpoint: 'resave-on-error',
                      error: normalizeError(error),
                    });
                  });
                }
                // API failed (offline). Records are already persisted locally as
                // 'pending' and will sync on reconnect. Stay on this screen and
                // surface a 'Save failed' alert so the user can retry the finish;
                // we do NOT navigate away here.
                const reason = (err as { response?: unknown } | null)?.response
                  ? errorMessage(err, 'The server did not accept the workout.')
                  : 'No connection.';
                Alert.alert(
                  'Workout not saved yet',
                  `${reason.replace(/\.?$/, '.')} The sets stay on this screen. Check the connection, then tap Finish again.`,
                );
              },
            },
          );
        },
      },
    ];
    // TRAIN-GATE-128: "Finish and log" on the leave question already confirmed.
    if (confirmed) {
      void finishButtons[1].onPress?.();
      return;
    }
    Alert.alert('Finish Workout?', finishMessage, finishButtons);
  };

  // TRAIN-GATE-128 (owner 15:03 10-07): leaving a live workout never deletes
  // it. With sets logged, the client is asked to log the workout or keep
  // training. With nothing entered (no ticked set, no notes, no edits) there
  // is nothing to save: leaving the screen releases the empty session; a
  // draft with notes or edits is kept for the next open; a tab switch keeps
  // it open.
  const releaseEmptySession = async () => {
      // Nothing was logged in this session, so there is nothing to keep:
      // drop the empty persisted copy so the next workout opens clean.
      //
      // We set finishingRef synchronously so any concurrent effect
      // tick (debounce fire, AppState background flush) bails out,
      // then await the clear so the next mount cannot race a still-
      // in-flight removeItem and read the just-deleted entry back.
      finishingRef.current = true;
      cancelRestAlert();
      if (persistDebounceRef.current) {
        clearTimeout(persistDebounceRef.current);
        persistDebounceRef.current = null;
      }
      pendingPersistPayloadRef.current = null;
      try {
        if (userId) await clearActiveWorkoutSession(userId);
      } catch (error) {
        // Best-effort — if clearing fails the next mount reopens the empty
        // session, which is harmless. Surfaced for diagnosis
        // rather than swallowed (R69) so a persistent clear failure is
        // visible instead of silent.
        logger.warn('mwb.activeWorkout.cancel-clear', {
          ...buildCompletionLogBase({
            route: 'ActiveWorkout',
            userRole: currentUser?.role,
            userKey: userId || undefined,
            // No completion id exists on an explicit-cancel clear path; use the documented sentinel.
            justCompletedId: 'unknown',
          }),
          checkpoint: 'cancel-clear',
          error: normalizeError(error),
        });
      }
      if (timerRef.current) clearInterval(timerRef.current);
  };

  const askBeforeLeaving = (leave: () => void, releaseIfEmpty: boolean) => {
    if (finishingRef.current) {
      leave();
      return;
    }
    const logged = sessionExercises.reduce((sum, ex) => sum + ex.sets.filter((s) => s.completed).length, 0);
    if (logged === 0) {
      // m#521 Sol B: notes, edited sets or added exercises are the client's
      // work before the first ticked set; only a session exactly as it opened
      // is released. Anything else is written now and reopens next time.
      const untouched =
        !workoutNotes.trim() && JSON.stringify(sessionExercises) === JSON.stringify(defaultSessionExercises);
      if (!releaseIfEmpty || !untouched) {
        flushPendingPersist();
        leave();
        return;
      }
      void releaseEmptySession().then(leave);
      return;
    }
    const unfinished = sessionExercises.reduce((n, ex) => n + ex.sets.length, 0) > logged;
    Alert.alert(
      'Log this workout?',
      `${logged} ${logged === 1 ? 'set' : 'sets'} logged so far. Finish to save ${logged === 1 ? 'it' : 'them'}, or keep training.${
        unfinished ? ' Unfinished sets will not be saved.' : ''
      }`,
      [
        { text: 'Keep training', style: 'cancel' },
        { text: 'Finish and log', onPress: () => finishWorkout(true) },
      ],
    );
  };
  const askBeforeLeavingRef = useRef(askBeforeLeaving);
  askBeforeLeavingRef.current = askBeforeLeaving;

  // Back button, back gesture and any in-app navigation that removes this
  // screen ask first; the Finish paths set finishingRef and pass through.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (finishingRef.current) return;
        e.preventDefault();
        askBeforeLeavingRef.current(() => navigation.dispatch(e.data.action), true);
      }),
    [navigation],
  );
  // A press on another tab asks the same question (ClientNavigator).
  useEffect(() => setWorkoutLeaveGuard((leave) => askBeforeLeavingRef.current(leave, false)), []);

  const totalSets = sessionExercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  const completedSets = sessionExercises.reduce((sum, ex) => sum + ex.sets.filter((s) => s.completed).length, 0);

  // §2.9 most recently completed set (last completed set, scanning exercises in
  // order). Drives Roman's readback with the real logged weight/reps. A set
  // with a zero weight (e.g. bodyweight) is still a valid readback, so the only
  // gate is `completed`.
  const lastCompletedSet: SessionSet | null = (() => {
    let found: SessionSet | null = null;
    for (const ex of sessionExercises) {
      for (const s of ex.sets) {
        if (s.completed) found = s;
      }
    }
    return found;
  })();

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <HapticPressable
          intent="warning"
          onPress={() => askBeforeLeaving(() => navigation.goBack(), true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Leave workout"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <View style={styles.topCenter}>
          <Text style={styles.topTitle} numberOfLines={2}>{routineName}</Text>
          <Text style={styles.timerText}>{formatTime(timer)}</Text>
        </View>
        <HapticPressable
          intent="success"
          onPress={() => finishWorkout()}
          disabled={saving}
          style={[styles.finishBtn, saving && { opacity: 0.6 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={saving ? 'Saving workout' : 'Finish workout'}
          accessibilityState={{ disabled: saving, busy: saving }}
          testID="finish-workout"
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.finishBtnText}>Finish</Text>
          )}
        </HapticPressable>
      </View>

      {/* Progress */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%' }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={[styles.previousSetText, { marginHorizontal: 20, marginBottom: 12 }]}>{completedSets} of {totalSets} sets completed</Text>
        {/* §2.9 Roman voice-log readback — voiced beside his face, reading back
            the most recently completed set. Only when the Roman flag is on AND
            at least one set has been completed. Default mode: a per-set PR
            signal is not tracked in the live session, so no celebration is
            fabricated (documented in the report). */}
        {featureFlags.romanChat && lastCompletedSet ? (
          <RomanVoiceLogReadback
            weight={lastCompletedSet.weight}
            reps={lastCompletedSet.reps}
            mode="default"
            testID="roman-voicelog-card"
          />
        ) : null}

        {sessionExercises.map((exercise, exIdx) => (
          <ExerciseCard
            key={`${exercise.exerciseId}-${exIdx}`}
            exercise={exercise}
            exIdx={exIdx}
            onUpdateSet={updateSet}
            onToggleSetComplete={toggleSetComplete}
            onAddSet={addSet}
            onRemoveExercise={removeExercise}
            onOpenExerciseDetail={openExerciseDetail}
            colors={colors}
            styles={styles}
            previous={previousSets(history, exercise.exerciseName)}
            isLast={exIdx === sessionExercises.length - 1}
            disabled={saving}
            onMove={(index, direction) => setSessionExercises((prev) => moveExercise(prev, index, direction))}
            onSwap={requestSwap}
            onChangeNotes={(index, notes) => setSessionExercises((prev) => prev.map((e, i) => i === index ? { ...e, notes } : e))}
            onChangeRest={(index, restSec) => setSessionExercises((prev) => prev.map((e, i) => i === index ? { ...e, restSec } : e))}
          />
        ))}

        <HapticPressable intent="medium" style={styles.addExerciseBtn} disabled={saving} onPress={() => { void openAddExercise(); }}>
          <Ionicons name="add-circle" size={22} color={colors.primary} />
          <Text style={styles.addExerciseText}>Add Exercise</Text>
        </HapticPressable>
        <View style={[styles.exerciseCard, { marginTop: 16 }]}>
          <TextInput style={styles.notesInput} value={workoutNotes} onChangeText={setWorkoutNotes} placeholder="Workout notes" accessibilityLabel="Workout notes" placeholderTextColor={colors.textMuted} multiline maxLength={2000} editable={!saving} />
        </View>
        {completedSets > 0 && <WorkoutFinishSummary summary={summary} styles={styles} historyState={historyState} elapsed={formatTime(timer)} />}
      </ScrollView>

      {/* Add Exercise Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <HapticPressable intent="light" onPress={() => setShowAddModal(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </HapticPressable>
            <Text style={styles.modalTitle}>{swapIndex === null ? 'Add Exercise' : 'Choose replacement'}</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={handleSearchChange}
            />
            {searchQuery.length > 0 && (
              <HapticPressable intent="light" onPress={() => handleSearchChange('')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </HapticPressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.muscleFilter}
            contentContainerStyle={styles.muscleFilterContent}
          >
            {MUSCLES.map((m) => (
              <HapticPressable
                key={m}
                intent="light"
                style={[styles.muscleChip, selectedMuscle === m && styles.muscleChipActive]}
                onPress={() => handleMuscleFilter(m)}
              >
                <Text style={[styles.muscleChipText, selectedMuscle === m && styles.muscleChipTextActive]}>
                  {m === 'All' ? 'All' : m.charAt(0).toUpperCase() + m.slice(1)}
                </Text>
              </HapticPressable>
            ))}
          </ScrollView>

          <FlatList
            keyboardShouldPersistTaps="handled"
            data={filteredExercises}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.exerciseList}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="barbell-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyStateText}>No exercises found</Text>
                <Text style={styles.emptyStateSubtext}>
                  {searchQuery.length > 0
                    ? `No results for "${searchQuery}"`
                    : selectedMuscle !== 'All'
                    ? `No ${selectedMuscle} exercises`
                    : 'Try a different search'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <HapticPressable
                intent="medium"
                style={styles.exerciseListItem}
                onPress={() => addExerciseToSession(item)}
              >
                {/* Thumbnail image */}
                <ExerciseImage imageUrl={item.imageUrl} muscle={item.muscle} size={80} />

                {/* Info */}
                <View style={styles.exerciseListInfo}>
                  <Text style={styles.exerciseListName}>{item.name}</Text>

                  {/* Muscle badge */}
                  <View
                    style={[
                      styles.muscleBadge,
                      { backgroundColor: lookupMuscleColor(muscleColors, item.muscle, colors.textSecondary) + '22', borderColor: lookupMuscleColor(muscleColors, item.muscle, colors.textSecondary) + '66' },
                    ]}
                  >
                    <Text style={[styles.muscleBadgeText, { color: lookupMuscleColor(muscleColors, item.muscle, colors.textSecondary) }]}>
                      {item.muscle.charAt(0).toUpperCase() + item.muscle.slice(1)}
                    </Text>
                  </View>

                  {/* Equipment */}
                  <Text style={styles.exerciseListEquipment}>{item.equipment}</Text>
                </View>

                <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
              </HapticPressable>
            )}
          />
        </View>
      </Modal>

      {/* Rest Timer Overlay */}
      {restActive && (
        <View style={styles.restOverlay}>
          <View style={styles.restLeft}>
            <Ionicons name="timer-outline" size={20} color={colors.primary} />
            <Text style={styles.restLabel}>Rest</Text>
          </View>
          <Text style={styles.restCountdown}>
            {Math.floor(restSeconds / 60).toString().padStart(2, '0')}
            :{(restSeconds % 60).toString().padStart(2, '0')}
          </Text>
          <HapticPressable intent="light" style={styles.toolButton} onPress={() => { restEndsAtRef.current += 30_000; cancelRestAlert(); refreshRest(); }} accessibilityLabel="Add 30 seconds to rest timer">
            <Text style={styles.restSkip}>+30s</Text>
          </HapticPressable>
          <TouchableOpacity
            style={styles.toolButton}
            onPress={() => {
              if (restIntervalRef.current) clearInterval(restIntervalRef.current);
              restIntervalRef.current = null;
              cancelRestAlert();
              setRestActive(false);
              HapticService.softImpact();
            }}
            accessibilityRole="button"
            accessibilityLabel="Skip rest timer"
          >
            <Text style={styles.restSkip}>Skip</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
