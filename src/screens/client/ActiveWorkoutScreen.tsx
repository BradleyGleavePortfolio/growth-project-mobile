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
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, NavigationProp, ParamListBase } from '@react-navigation/native';

import { getAllExercises } from '../../db/workoutDb';
import { useCreateWorkout } from '../../hooks/useApi';
import ExerciseLogModal, { ExerciseLogSaveData } from '../../components/ExerciseLogModal';
import { track } from '../../lib/analytics';
import { HapticService } from '../../ui/haptics/haptics.service';
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
// Offline-first write path (audit fix H-5: comments were left
// referencing the deleted WatermelonDB stack — current implementation
// is built on expo-sqlite, see src/offline/database.ts and
// docs/offline-architecture.md).
//
// The workout is saved to the local expo-sqlite store first with
// sync_status='pending'. The sync engine pushes it to the server when
// connectivity allows.
import {
  writeWorkoutLog,
  triggerSync,
  markSessionSyncedBySessionName,
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
import { featureFlags } from '../../config/featureFlags';
import { logger } from '../../utils/logger';
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

export default function ActiveWorkoutScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const muscleColors = useMemo(() => makeMuscleColors(colors), [colors]);
  const route = useRoute<RouteProp<RouteParams, 'ActiveWorkout'>>();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { routineName, exercises: exercisesJson, assignmentId } = route.params;
  // Per-R15 the persisted session key is scoped to the current user
  // (`active_workout_session:<userId>`). The user id resolves
  // asynchronously on cold start (useCurrentUser reads from MMKV/Async),
  // so the persistence effect and the restore-on-mount effect both
  // wait on it before touching storage.
  const currentUser = useCurrentUser();
  const userId = currentUser?.id ?? '';

  const [sessionExercises, setSessionExercises] = useState<SessionExercise[]>([]);
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
  const idempotencyKeyRef = useRef<string>(
    assignmentId ? `${assignmentId}:${Date.now()}` : ''
  );
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
  const [restTotal, setRestTotal] = useState(0);
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredExercises, setFilteredExercises] = useState<Exercise[]>([]);
  const [selectedMuscle, setSelectedMuscle] = useState('All');
  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const createWorkout = useCreateWorkout();

  // Default (fresh) session exercises derived from the routine param.
  // Pulled out so the restore effect can fall back to it cleanly when
  // no stored session is found.
  const defaultSessionExercises = useMemo<SessionExercise[]>(() => {
    try {
      const routineExs: RoutineExercise[] = JSON.parse(exercisesJson);
      return routineExs.map((re) => ({
        exerciseId: re.exerciseId,
        exerciseName: re.exerciseName,
        sets: Array.from({ length: re.sets }, () => ({ reps: re.reps, weight: 0, completed: false })),
        restSec: re.restSec,
        workoutPlanExerciseId: re.workoutPlanExerciseId,
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
      const { session, isStale } = result;
      const promptTitle = isStale ? 'Resume earlier workout?' : 'Resume workout?';
      const promptBody = isStale
        ? `Found an unfinished workout from over 12 hours ago${
            session.routineName ? ` ("${session.routineName}")` : ''
          }. Resume it, or start fresh?`
        : `Found an unfinished workout${
            session.routineName ? ` ("${session.routineName}")` : ''
          }. Resume it, or start fresh?`;
      Alert.alert(
        promptTitle,
        promptBody,
        [
          {
            text: 'Start Fresh',
            style: 'destructive',
            onPress: async () => {
              // Await the clear before enabling persistence: a slow native
              // removeItem can otherwise race the very first debounced save
              // for the fresh session and delete the new payload after it
              // lands. See audit #6.
              try {
                await clearActiveWorkoutSession(userId);
              } catch {
                /* best-effort */
              }
              setSessionExercises(defaultSessionExercises);
              setHydrated(true);
            },
          },
          {
            text: 'Resume',
            onPress: () => {
              adoptPersistedSession(session);
              setHydrated(true);
            },
          },
        ],
        { cancelable: false },
      );
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
  }, [hydrated, sessionExercises, routineName, exercisesJson, assignmentId, userId]);

  // Rest timer cleanup.
  useEffect(() => {
    return () => {
      if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    };
  }, []);

  const startRest = (seconds: number) => {
    if (seconds <= 0) return;
    if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    setRestTotal(seconds);
    setRestSeconds(seconds);
    setRestActive(true);
    restIntervalRef.current = setInterval(() => {
      setRestSeconds((prev) => {
        if (prev <= 1) {
          if (restIntervalRef.current) clearInterval(restIntervalRef.current);
          restIntervalRef.current = null;
          setRestActive(false);
          HapticService.heavyImpact();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
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
      startRest(rest);
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
    setSessionExercises((prev) => prev.filter((_, i) => i !== exIdx));
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

  const openAddExercise = async () => {
    setShowAddModal(true);
    setSearchQuery('');
    setSelectedMuscle('All');
    const all = await getAllExercises();
    setAllExercises(all);
    setFilteredExercises(all);
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
    // Open ExerciseLogModal to capture weight/reps/sets before adding to session
    setSelectedExercise(exercise);
    setShowLogModal(true);
  };

  const handleExerciseLogSave = (data: ExerciseLogSaveData) => {
    // Add the exercise to the active session with the logged sets. Persistence
    // happens once at the end via useCreateWorkout — we no longer dual-write
    // to a local SQLite volume table.
    setSessionExercises((prev) => [
      ...prev,
      {
        exerciseId: data.exerciseId,
        exerciseName: data.exerciseName,
        sets: data.sets.map((s) => ({
          reps: s.reps,
          weight: s.weight,
          completed: true, // pre-logged sets are already complete
        })),
      },
    ]);

    // Close both the log modal and the add-exercise picker modal
    setShowLogModal(false);
    setShowAddModal(false);
    setSelectedExercise(null);
  };

  const handleExerciseLogClose = () => {
    setShowLogModal(false);
    setSelectedExercise(null);
  };

  const finishWorkout = () => {
    const completedSets = sessionExercises.reduce((sum, ex) => sum + ex.sets.filter((s) => s.completed).length, 0);
    if (completedSets === 0) {
      Alert.alert('No sets completed', 'Complete at least one set before finishing.');
      return;
    }
    Alert.alert('Finish Workout?', `${completedSets} sets completed`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        // Offline-first write (audit fix H-5: comments were left
        // describing the deleted WatermelonDB stack — current
        // implementation is built on expo-sqlite via src/offline,
        // see docs/offline-architecture.md):
        //   1. Write each exercise group as a row in the local
        //      expo-sqlite store with sync_status='pending'.
        //   2. Attempt the server POST via createWorkout.mutate
        //      (network-optional).
        //   3. If the network call succeeds the sync engine marks
        //      the row 'synced'.
        //   4. If offline the rows stay 'pending' and triggerSync()
        //      fires on reconnect via NetInfo.
        onPress: async () => {
          // Suppress the debounced persistence write that would
          // otherwise race the post-durable-write clear() and re-create
          // the entry. Also null the pending payload ref so the
          // background-flush path can't write between this tap and the
          // clear completing.
          finishingRef.current = true;
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

          // Write each exercise as a separate row in the local
          // expo-sqlite store (one row per exercise group). A
          // workout session that spans multiple exercises produces N
          // rows — the sync engine batches them together via
          // session_name when pushing to the server. Schema stays
          // flat; no nested JSON blob in a single row.
          try {
            for (const ex of completedExercises) {
              // B2: never write an empty exerciseId — fall back to a stable
              // session-scoped slug derived from the exercise name. The
              // server route will still receive the human-readable name via
              // the createWorkout payload below.
              const slug = (ex.exerciseName || 'exercise')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'exercise';
              const exerciseId =
                (ex.exerciseId && ex.exerciseId.trim()) ||
                `session:${routineName || 'workout'}/${slug}`;
              await writeWorkoutLog({
                exerciseId,
                setsData: JSON.stringify(ex.sets),
                sessionName: routineName,
                durationMinutes,
              });
            }
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
            logger.warn('mwb.completion.local-write', { error: localErr });
          }

          // Analytics — unchanged from before.
          track('workout_logged', {
            duration_minutes: durationMinutes,
            sets_completed: completedSets,
            exercise_count: completedExercises.length,
          });

          // Attempt server sync. If offline, the pending WDB records will be
          // pushed by the sync engine on the next network-available event.
          createWorkout.mutate(
            {
              date: new Date().toISOString(),
              workout_name: routineName || 'Workout',
              workout_type: 'strength',
              duration_minutes: durationMinutes,
              notes: routineName,
              exercises: completedExercises.map((e) => ({
                exercise_name: e.exerciseName,
                muscle_group: 'full_body',
                sets_completed: e.sets.filter((s) => s.completed).length,
                weight_per_set: e.sets.filter((s) => s.completed).map((s) => s.weight),
                reps_per_set: e.sets.filter((s) => s.completed).map((s) => s.reps),
              })),
            },
            {
              onSuccess: (data: unknown) => {
                if (timerRef.current) clearInterval(timerRef.current);
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
                    logger.warn('mwb.completion.clear-recovery-session', { error });
                  });
                }
                // Phase 11 / Track 3: heavy haptic on workout completion
                HapticService.heavyImpact();
                // Psych Report #4: Analytics — workout_logged
                track(AnalyticsEvents.WORKOUT_COMPLETED, {
                  duration_minutes: Math.round(timer / 60),
                  sets_completed: completedSets,
                  exercise_count: sessionExercises.filter((e) => e.sets.some((s) => s.completed)).length,
                });
                // W-1 fix: the parent mutate just succeeded, so the N
                // pending local rows we wrote in the loop above must be
                // marked synced — otherwise the next `triggerSync()` cycle
                // re-POSTs each of them as an additional single-exercise
                // workout on the server. Correlate by `session_name`
                // (= routineName, which both write paths share).
                const d = (data ?? {}) as { id?: string; workout?: { id?: string } };
                const serverId = String(d?.id ?? d?.workout?.id ?? '');
                if (serverId && routineName) {
                  markSessionSyncedBySessionName(routineName, serverId).catch((error: unknown) => {
                    // Best-effort; pending rows will reconcile on the next pull.
                    // Surfaced (not swallowed) so a persistent mismatch is
                    // diagnosable rather than silent.
                    logger.warn('mwb.completion.mark-session-synced', { error });
                  });
                }
                // Trigger sync so the newly created server record is
                // pulled back. Pending rows have been marked above so this
                // is now a one-way pull.
                triggerSync().catch((error: unknown) => {
                  // Non-fatal: the server record exists; the next sync cycle
                  // will pull it. Surfaced for diagnosis.
                  logger.warn('mwb.completion.trigger-sync', { error });
                });

                // If this workout is linked to a coach assignment, call the
                // assignment completion endpoint with the full exercise/set
                // payload. Non-fatal — the generic workout is already saved.
                if (assignmentId) {
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
                  workoutBuilderApi.completeMyAssignment(assignmentId, {
                    completion_payload: completionPayload,
                    idempotency_key: idempotencyKeyRef.current,
                    started_at: sessionStartTimeRef.current.toISOString(),
                  }).catch((error: unknown) => {
                    // Non-fatal: generic workout already saved above.
                    logger.warn('mwb.completion.assignment-sync', { error });
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
                navigation.navigate(
                  'WorkoutMain',
                  serverId ? { justCompletedId: serverId } : undefined,
                );
              },
              onError: (err) => {
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
                  }).catch((error: unknown) => {
                    // Best-effort re-save so the session stays recoverable after
                    // a failed server save. Surfaced for diagnosis.
                    logger.warn('mwb.completion.resave-on-error', { error });
                  });
                }
                // API failed (offline). Records are already in WDB as 'pending'.
                // Navigate back — the sync badge will show on the history list.
                Alert.alert(
                  'Save failed',
                  errorMessage(err) || 'Please try again.',
                );
              },
            },
          );
        },
      },
    ]);
  };

  const cancelWorkout = () => {
    Alert.alert('Cancel Workout?', 'Progress will not be saved.', [
      { text: 'Keep Going', style: 'cancel' },
      {
        text: 'Cancel',
        style: 'destructive',
        onPress: async () => {
          // User explicitly abandoned the session — drop the persisted
          // copy so it doesn't show up as a "Resume?" prompt later.
          //
          // We set finishingRef synchronously so any concurrent effect
          // tick (debounce fire, AppState background flush) bails out,
          // then await the clear so the next mount cannot race a still-
          // in-flight removeItem and read the just-deleted entry back.
          finishingRef.current = true;
          if (persistDebounceRef.current) {
            clearTimeout(persistDebounceRef.current);
            persistDebounceRef.current = null;
          }
          pendingPersistPayloadRef.current = null;
          try {
            if (userId) await clearActiveWorkoutSession(userId);
          } catch {
            // Best-effort — if clearing fails the next mount still has
            // the "Resume?" prompt to safely back out of.
          }
          if (timerRef.current) clearInterval(timerRef.current);
          navigation.goBack();
        },
      },
    ]);
  };

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
        <HapticPressable intent="warning" onPress={cancelWorkout}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <View style={styles.topCenter}>
          <Text style={styles.topTitle}>{routineName}</Text>
          <Text style={styles.timerText}>{formatTime(timer)}</Text>
        </View>
        <HapticPressable intent="success" onPress={finishWorkout} style={styles.finishBtn}>
          <Text style={styles.finishBtnText}>Finish</Text>
        </HapticPressable>
      </View>

      {/* Progress */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%' }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
          />
        ))}

        <HapticPressable intent="medium" style={styles.addExerciseBtn} onPress={openAddExercise}>
          <Ionicons name="add-circle" size={22} color={colors.primary} />
          <Text style={styles.addExerciseText}>Add Exercise</Text>
        </HapticPressable>
      </ScrollView>

      {/* Exercise Log Modal — opens after selecting an exercise to capture sets/weight/reps */}
      <ExerciseLogModal
        visible={showLogModal}
        exercise={selectedExercise}
        onSave={handleExerciseLogSave}
        onClose={handleExerciseLogClose}
      />

      {/* Add Exercise Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <HapticPressable intent="light" onPress={() => setShowAddModal(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </HapticPressable>
            <Text style={styles.modalTitle}>Add Exercise</Text>
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
          <TouchableOpacity
            onPress={() => {
              if (restIntervalRef.current) clearInterval(restIntervalRef.current);
              restIntervalRef.current = null;
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
