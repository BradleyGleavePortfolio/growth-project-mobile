/** LEARN-M5 (flag learnCourses; MOCK-LEARN2 option A): the course reads typed from plan 7.A. GET /v1/client/courses: the courses the client owns;
 * GET /v1/client/courses/:id: weeks, open state, finish-by days, progress and open weeks' page text. The server decides what is open; a lapsed plan locks nothing (#LEARN-LOCK op 1). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import api from '../../../services/api';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { featureFlags } from '../../../config/featureFlags';

export type LessonKind = 'page' | 'video' | 'both';
export interface CourseLesson { id: string; n: string; title: string; kind: LessonKind; minutes: number | null; body: string; note: string; done: boolean; positionSeconds: number }
export interface CourseWeek { id: string; n: number; title: string; note: string; open: boolean; opensOn: string | null; finishBy: string | null; lessons: CourseLesson[] }
export interface Course { id: string; title: string; coach: string | null; startsOn: string | null; weeks: CourseWeek[] }

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : null);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === 'object' && (r as Row).id != null) : []);
const KINDS: LessonKind[] = ['page', 'video', 'both'];

/** Minutes: the page at about 200 words a minute (as Learn) plus the video's length. */
const minutes = (body: string, sec: unknown) => {
  const total = (body ? body.split(/\s+/).length / 200 : 0) + (typeof sec === 'number' && sec > 0 ? sec / 60 : 0);
  return total > 0 ? Math.max(1, Math.round(total)) : null;
};

export function courseFrom(r: Row): Course {
  const weeks = rows(r.modules).sort((a, b) => Number(a.position) - Number(b.position)).map((m, i): CourseWeek => ({
    id: String(m.id), n: i + 1, title: str(m.title), note: str(m.note), open: m.open === true, opensOn: day(m.opens_on), finishBy: day(m.finish_by),
    lessons: rows(m.lessons).map((l, j) => {
      const body = str(l.body_markdown);
      const kind = KINDS.find((k) => k === l.kind) ?? 'page';
      return { id: String(l.id), n: `${i + 1}.${j + 1}`, title: str(l.title) || 'Untitled lesson', kind, minutes: minutes(body, l.duration_sec), body, note: str(l.description), done: l.done === true,
        positionSeconds: Math.max(0, Math.floor(Number(l.position_seconds)) || 0) };
    }),
  }));
  return { id: String(r.id), title: str(r.title), coach: str(r.coach_name).split(/\s+/)[0] || null, startsOn: day(r.starts_on), weeks };
}

export const coursesFrom = (data: unknown) => rows(Array.isArray(data) ? data : (data as Row | null)?.courses).map(courseFrom);

const pad = (n: number) => String(n).padStart(2, '0');
export const today = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sun Oct 18" (or "Oct 18" without the weekday) from a calendar day. */
export function dayLabel(d: string | null, weekday = true): string {
  if (!d) return '';
  const [y, m, n] = d.split('-').map(Number);
  const date = new Date(y, m - 1, n);
  return `${weekday ? `${DAYS[date.getDay()]} ` : ''}${MONTHS[m - 1]} ${n}`;
}

/** This week: the first open week not yet past its finish-by day, else the last open one; `until`: its finish-by day only while that is
 * today or later (as the week rows). Up next: its first lesson not done, else any open one. */
export function courseNow(c: Course, on = today()) {
  const open = c.weeks.filter((w) => w.open);
  const week = open.find((w) => !w.finishBy || w.finishBy >= on) ?? open[open.length - 1] ?? null;
  const all = c.weeks.flatMap((w) => w.lessons);
  const next = week?.lessons.find((l) => !l.done) ?? open.flatMap((w) => w.lessons).find((l) => !l.done) ?? null;
  const nextWeek = next ? open.find((w) => w.lessons.includes(next)) ?? null : null;
  return { week, until: week?.finishBy && week.finishBy >= on ? week.finishBy : null, next, nextWeek, done: all.filter((l) => l.done).length, total: all.length };
}

export const doneIn = (w: CourseWeek) => w.lessons.filter((l) => l.done).length;

export function lessonMeta(l: CourseLesson): string {
  const kind = l.kind === 'page' ? 'Page' : l.kind === 'video' ? 'Video' : 'Video and page';
  return l.minutes ? `${kind} · ${l.minutes} min` : kind;
}

/** Every course sentence, with the coach's first name or "your coach". */
export function courseCopy(coach: string | null) {
  const whose = coach ? `${coach}'s` : "your coach's";
  const Whose = coach ? whose : "Your coach's";
  return {
    banner: `${Whose} videos and short reads, one week at a time, alongside your workouts.`,
    bannerWeek: (n: number, done: number, total: number) => `Week ${n} is open: ${done} of ${total} lessons done.`,
    lessons: (done: number, total: number) => `${done} of ${total} lessons`,
    openUntil: (n: number, d: string | null) => `Week ${n} open until ${dayLabel(d)}`,
    weekOf: (n: number, total: number) => `Week ${n} of ${total}`,
    from: `From ${coach ?? 'your coach'}`,
    loading: `Loading ${whose} course`,
    failed: `${Whose} course did not load.`,
    noAnswer: 'Check the connection and try again.',
    offline: 'You’re offline. Pages in open weeks still read here. Videos and saving progress need a connection.',
  };
}

/** A 402 is never the plans sheet over a course (the reads, the video address and the saved place never lock, #LEARN-LOCK op 1). */
export const quiet: AxiosRequestConfig & { quietPaywall: boolean } = { quietPaywall: true };
const [listKey, courseKey] = [(uid?: string) => ['learn-courses', uid], (uid?: string, id?: string) => ['learn-course', uid, id]];

/** The courses the client owns; nothing is asked while the flag is off. */
export function useCourses() {
  const uid = useCurrentUser()?.id;
  return useQuery({
    queryKey: listKey(uid),
    queryFn: async () => coursesFrom((await api.get('/v1/client/courses', quiet)).data),
    enabled: featureFlags.learnCourses && !!uid,
  });
}

/** One course with its page text; `known` is the banner's copy, so loading still names the course and coach. */
export function useCourse(id?: string) {
  const uid = useCurrentUser()?.id;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: courseKey(uid, id),
    queryFn: async () => courseFrom(((await api.get(`/v1/client/courses/${id}`, quiet)).data ?? {}) as Row),
    enabled: !!uid && !!id,
  });
  const known = query.data ?? qc.getQueryData<Course[]>(listKey(uid))?.find((c) => c.id === id) ?? null;
  const patch = (lessonId: string, p: Partial<CourseLesson>) => {
    const mark = (c: Course): Course => ({ ...c, weeks: c.weeks.map((w) => ({ ...w, lessons: w.lessons.map((l) => (l.id === lessonId ? { ...l, ...p } : l)) })) });
    qc.setQueryData<Course>(courseKey(uid, id), (prev) => prev && mark(prev));
    qc.setQueryData<Course[]>(listKey(uid), (prev) => prev?.map((c) => (c.id === id ? mark(c) : c)));
  };
  return { query, course: query.data ?? null, known, markDone: (lessonId: string) => patch(lessonId, { done: true }), markPosition: (lessonId: string, positionSeconds: number) => patch(lessonId, { positionSeconds }) };
}
