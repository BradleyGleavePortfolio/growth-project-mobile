import type { Lesson } from '../../db/educationDb';
import type { JsonRecord } from '../../types/common';

export interface EducationLesson extends Lesson {
  completed: boolean;
  videoUrl: string | null;
  articleUrl: string | null;
}

export function lessonFromApi(lesson: JsonRecord): EducationLesson {
  const text = (key: string) => typeof lesson[key] === 'string' ? lesson[key] as string : '';
  const number = (...keys: string[]) => {
    for (const key of keys) if (typeof lesson[key] === 'number') return lesson[key] as number;
    return 0;
  };
  return {
    id: String(lesson.id),
    title: text('title') || 'Untitled lesson',
    subtitle: text('subtitle'),
    category: text('category') || 'Fitness',
    content: text('content') || text('body') || text('description'),
    durationMin: number('duration_min', 'durationMin'),
    sortOrder: number('order_index', 'sort_order', 'sortOrder'),
    createdAt: text('created_at') || text('createdAt'),
    completed: !!(lesson.completed || lesson.is_completed ||
      (Array.isArray(lesson.completions) && lesson.completions.length > 0)),
    videoUrl: text('video_url') || null,
    articleUrl: text('article_url') || null,
  };
}
