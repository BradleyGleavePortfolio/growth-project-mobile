/**
 * LEARN-A (flag learnHub): the reads behind Learn and its lesson view. The
 * server is the only record. GET /lessons holds the current coach's lessons
 * and this client's completions (a client whose coach deleted their account keeps the single lessons they completed); GET
 * /coach/my-guidelines holds the one guidelines page that coach wrote.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { coachApi, lessonsApi } from '../../../services/api';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { readUserCacheSync } from '../../../lib/userCache';

export interface LearnLesson {
  id: string;
  title: string;
  text: string;
  videoUrl: string | null;
  articleUrl: string | null;
  done: boolean;
}

/** 'plan': a server before LEARN-B still answers a lapsed plan with 402; the page says so in today's words. */
export type LearnGuidelines = { text: string; updatedAt: string | null } | 'plan' | null;

/** Today's words for that 402 (CoachGuidelinesScreen.tsx:23-24), without the plans button. */
export const GUIDELINES_PLAN_TITLE = 'Guidelines open with an active plan';
export const GUIDELINES_PLAN_BODY = "Your coach's guidelines open when your plan with them is active.";

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const link = (v: unknown) => (/^https?:\/\//i.test(str(v)) ? str(v) : null);

export function lessonsFrom(data: unknown): LearnLesson[] {
  return (Array.isArray(data) ? (data as Row[]) : []).filter((r) => r && r.id != null).map((r) => ({
    id: String(r.id),
    title: str(r.title) || 'Untitled lesson',
    text: str(r.description),
    videoUrl: link(r.video_url),
    articleUrl: link(r.article_url),
    done: Array.isArray(r.completions) && r.completions.length > 0,
  }));
}

function planRequired(err: unknown): boolean {
  const res = (err as { response?: { status?: number; data?: { error?: string } } } | null)?.response;
  return res?.status === 402 && res.data?.error === 'CLIENT_ENTITLEMENT_REQUIRED';
}

async function readGuidelines(): Promise<LearnGuidelines> {
  try {
    // quietPaywall: the 402 is said on this page, never as the plans sheet over it.
    const row = ((await coachApi.getMyGuidelines({ quietPaywall: true })).data ?? {}) as Row;
    const text = str(row.description);
    return text ? { text, updatedAt: str(row.updated_at) || str(row.created_at) || null } : null;
  } catch (err) {
    if (planRequired(err)) return 'plan';
    throw err;
  }
}

/** One read set for Learn, the lesson view and the You row. Coach and guidelines need a coach; lessons only need the client, so lessons kept after the coach deleted their account still load. */
export function useLearn() {
  const current = useCurrentUser();
  const user = readUserCacheSync() ?? current;
  const coachId = user?.coach_id ?? null;
  const enabled = !!coachId;
  const hasUser = !!user?.id;
  const lessonsKey = ['learn-lessons', user?.id, coachId];
  const coach = useQuery({
    queryKey: ['you-coach', user?.id, coachId],
    queryFn: async () => (await api.get<{ name?: string }>('/v1/clients/me/coach')).data,
    enabled,
  });
  const lessons = useQuery({ queryKey: lessonsKey, queryFn: async () => lessonsFrom((await lessonsApi.getAll()).data), enabled: hasUser });
  const guidelines = useQuery({ queryKey: ['learn-guidelines', user?.id, coachId], queryFn: readGuidelines, enabled });
  const qc = useQueryClient();
  const known = lessons.data !== undefined && (!enabled || guidelines.data !== undefined);
  return {
    user,
    coachId,
    name: str(coach.data?.name).split(/\s+/)[0] || null,
    lessons: lessons.data ?? [],
    guidelines: guidelines.data ?? null,
    guidelinesQuery: guidelines,
    known,
    error: known ? null : lessons.error ?? guidelines.error,
    hasContent: !!guidelines.data || (lessons.data?.length ?? 0) > 0,
    refetch: () =>
      hasUser
        ? Promise.all([lessons.refetch(), ...(enabled ? [guidelines.refetch(), coach.refetch()] : [])])
        : Promise.resolve(),
    markDone: (id: string) =>
      qc.setQueryData<LearnLesson[]>(lessonsKey, (prev) => prev?.map((l) => (l.id === id ? { ...l, done: true } : l))),
  };
}

/** Minutes from the lesson text at about 200 words a minute (MOCK-LEARN-43). */
export function lessonMeta(l: LearnLesson): string | null {
  if (l.text) return `Reading · about ${Math.max(1, Math.round(l.text.split(/\s+/).length / 200))} min`;
  return l.videoUrl ? 'Video' : null;
}

export function updatedOn(iso: string | null): string | null {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const };
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...year });
}

/** Every Learn sentence, with the coach's first name or "your coach". former: no coach now, but kept lessons (LK-01). */
export function learnCopy(name: string | null, former = false) {
  const who = name ?? 'your coach';
  const whose = name ? `${name}'s` : "your coach's";
  const Whose = name ? whose : "Your coach's";
  return {
    from: former ? 'From your former coach' : `From ${who}`,
    lede: `${Whose} guidelines and lessons for you.`,
    loading: `Loading ${whose} guidelines and lessons`,
    failed: `${Whose} guidelines and lessons did not load.`,
    noAnswer: 'Check the connection and try again.',
    offline: 'Guidelines and lessons load when you are back online.',
    emptyTitle: `Nothing from ${who} yet`,
    emptyBody: `When ${who} adds guidelines or a lesson, they show here.`,
    lessonOf: (n: number, total: number) => `Lesson ${n} of ${total} · from ${who}`,
    allDone: (total: number) => `All ${total} of ${whose} lessons are complete.`,
    message: name ? `Message ${name}` : 'Message your coach',
  };
}
