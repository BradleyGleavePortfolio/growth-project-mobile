// B-HC12-121 — Health Connect: what a refresh posts from the late-data
// look-back (C-370-2), and one sleep session per night (C-370-3).
//
// Every read starts a day behind a type's saved progress (`../syncWindows.ts`)
// so data written late is read. Posting that whole day again on every Health
// open cost about 70 ingest requests for a watch that writes heart rate every
// 5 seconds, over the backend's 60 per minute. A record that the last
// completed read of its type already saw is skipped here, so a refresh posts
// only what was written or changed since.

/**
 * Margin behind the saved progress inside which a record still counts as
 * possibly unseen. A record changed within this long before the last read
 * completed is posted again (harmless: the backend skips duplicates), so a
 * write that became visible just after the read began is never skipped.
 */
export const CHANGED_SINCE_MARGIN_MS = 15 * 60_000;

function field(obj: unknown, key: string): unknown {
  return obj != null && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

function timeMs(obj: unknown, key: string): number | null {
  const v = field(obj, key);
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** A record's span: [startTime, endTime] for interval records, [time, time] otherwise. */
export function recordSpan(record: unknown): { start: number; end: number } | null {
  const start = timeMs(record, 'startTime');
  const end = timeMs(record, 'endTime');
  if (start != null && end != null && end >= start) return { start, end };
  const at = timeMs(record, 'time');
  return at != null ? { start: at, end: at } : null;
}

/** When Health Connect last wrote the record (`metadata.lastModifiedTime`). */
export function lastModifiedMs(record: unknown): number | null {
  return timeMs(field(record, 'metadata'), 'lastModifiedTime');
}

/** The read the look-back filter compares against. */
export interface LookBackBounds {
  /** Start of this read (never earlier than the last completed read's start). */
  windowStart: number;
  /** The saved progress: the end of the last completed read of this type. */
  completedThrough: number;
}

/**
 * True when the last completed read of this type already read and posted the
 * record: it lies wholly inside that read (between this read's start and the
 * saved progress) and Health Connect last wrote it more than
 * {@link CHANGED_SINCE_MARGIN_MS} before that read's end. That read began
 * after its end, so the record was there to be read, and its progress was
 * saved only after every page was posted. A record with no readable
 * modification time or span is never skipped.
 */
export function wasPostedByLastRead(record: unknown, bounds: LookBackBounds): boolean {
  const modified = lastModifiedMs(record);
  const span = recordSpan(record);
  if (modified == null || span == null) return false;
  return (
    modified <= bounds.completedThrough - CHANGED_SINCE_MARGIN_MS &&
    span.start >= bounds.windowStart &&
    span.end < bounds.completedThrough
  );
}

function stageCount(record: unknown): number {
  const stages = field(record, 'stages');
  return Array.isArray(stages) ? stages.length : 0;
}

function recordId(record: unknown): string {
  const id = field(field(record, 'metadata'), 'id');
  return typeof id === 'string' ? id : '';
}

/**
 * Which of two overlapping sleep sessions stands for the night when none was
 * posted yet: the one with more stages, then the longer one, then the earlier
 * one, then the lower record id, so every read picks the same session.
 */
function nightOrder(a: unknown, b: unknown): number {
  const sa = stageCount(a);
  const sb = stageCount(b);
  if (sa !== sb) return sb - sa;
  const pa = recordSpan(a);
  const pb = recordSpan(b);
  const la = pa ? pa.end - pa.start : 0;
  const lb = pb ? pb.end - pb.start : 0;
  if (la !== lb) return lb - la;
  const start = (pa?.start ?? 0) - (pb?.start ?? 0);
  if (start !== 0) return start;
  return recordId(a) < recordId(b) ? -1 : recordId(a) > recordId(b) ? 1 : 0;
}

/**
 * C-370-3: one sleep session per night. Several apps can each write the same
 * night into Health Connect (a watch app and a phone app, or a tail written
 * again after waking), and each session posted on its own adds its minutes
 * to the night's total. Sessions whose times overlap form one night. A night
 * one of whose sessions the last read already posted ({@link isPosted}) posts
 * nothing more, so a session that arrives later never counts the night twice;
 * otherwise only the session {@link nightOrder} puts first is posted. Records
 * without a readable span are kept (the normalizer drops them). Order is kept.
 */
export function sleepSessionsToPost(records: unknown[], isPosted: (record: unknown) => boolean): unknown[] {
  const spans = records.map((r) => recordSpan(r));
  const keep = new Set<number>();
  const order: number[] = [];
  records.forEach((_, i) => (spans[i] == null ? keep.add(i) : order.push(i)));
  order.sort((x, y) => spans[x]!.start - spans[y]!.start || spans[x]!.end - spans[y]!.end);
  let night: number[] = [];
  let nightEnd = -Infinity;
  const close = () => {
    if (night.length === 0 || night.some((i) => isPosted(records[i]))) return;
    keep.add(night.reduce((b, i) => (nightOrder(records[i], records[b]) < 0 ? i : b), night[0]));
  };
  for (const i of order) {
    const span = spans[i]!;
    if (night.length > 0 && span.start >= nightEnd) {
      close();
      night = [];
      nightEnd = -Infinity;
    }
    night.push(i);
    nightEnd = Math.max(nightEnd, span.end);
  }
  close();
  return records.filter((_, i) => keep.has(i));
}
