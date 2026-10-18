/**
 * LEARN-B (#LEARN-LESSONS op 1): the coach Lessons editor. Every tap path:
 * open from Programs, add, edit, clear the video link, delete (confirm, keep),
 * move up and down, back with unsaved changes, and the load, empty, save,
 * delete and order failures. Flag off, Programs shows nothing new.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFlags = { coachLessons: true };
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockApi = { getAll: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
jest.mock('../../../services/api', () => ({ lessonsApi: mockApi }));
const mockHaptic = { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), warning: jest.fn(), error: jest.fn() };
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: mockHaptic }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import type { CoachLesson } from '../CoachLessons';

// Required after the mock objects exist (imports are hoisted above them).
const { CoachLessonsEntry, LessonsSheet, moveLesson, videoLink } = require('../CoachLessons') as typeof import('../CoachLessons');

const lesson = (id: string, order_index: number, over: Partial<CoachLesson> = {}): CoachLesson => ({
  id, title: `Lesson ${id}`, description: `Text ${id}`, video_url: null, order_index, ...over,
});
const A = lesson('a', 0, { video_url: 'https://youtu.be/abc' });
const B = lesson('b', 1);
const C = lesson('c', 2);
const ok = <T,>(data: T) => Promise.resolve({ data });
/** The server's lessons: reads come back sorted by order, writes land here. */
let server: CoachLesson[] = [];
const read = () => ok([...server].sort((x, y) => x.order_index - y.order_index));

function renderQ(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const sheet = () => renderQ(<LessonsSheet visible onClose={jest.fn()} />);
/** Presses the button with this text in the last Alert. */
const tapAlert = (text: string) => {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1][2] as Array<{ text: string; onPress?: () => void }>;
  buttons.find((b) => b.text === text)?.onPress?.();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.coachLessons = true;
  server = [A, B, C];
  mockApi.getAll.mockImplementation(read);
  mockApi.create.mockImplementation((body: CoachLesson) => {
    server = [...server, { ...body, id: 'n' }];
    return ok(server[server.length - 1]);
  });
  mockApi.update.mockImplementation((id: string, body: Partial<CoachLesson>) => {
    server = server.map((l) => (l.id === id ? { ...l, ...body } : l));
    return ok(server.find((l) => l.id === id));
  });
  mockApi.remove.mockImplementation((id: string) => {
    server = server.filter((l) => l.id !== id);
    return Promise.resolve({ status: 204 });
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('pure helpers', () => {
  it('videoLink keeps http(s) links, adds https:// to a bare link, refuses other schemes and junk', () => {
    expect(videoLink('')).toBe('');
    expect(videoLink(' https://vimeo.com/1 ')).toBe('https://vimeo.com/1');
    expect(videoLink('youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(videoLink('javascript:alert(1)')).toBeNull();
    expect(videoLink('not a link')).toBeNull();
    expect(videoLink(`https://a.co/${'x'.repeat(500)}`)).toBeNull();
  });

  it('moveLesson swaps neighbours and writes only the order values that change', () => {
    expect(moveLesson([A, B, C], 0, -1)).toBeNull();
    expect(moveLesson([A, B, C], 2, 1)).toBeNull();
    const next = moveLesson([A, B, C], 1, 1)!;
    expect(next.ordered.map((l) => [l.id, l.order_index])).toEqual([['a', 0], ['c', 1], ['b', 2]]);
    expect(next.writes.map((l) => [l.id, l.order_index])).toEqual([['c', 1], ['b', 2]]);
    // Lessons that all share 0 (written elsewhere) get distinct positions.
    const flat = moveLesson([lesson('x', 0), lesson('y', 0), lesson('z', 0)], 0, 1)!;
    expect(flat.writes.map((l) => [l.id, l.order_index])).toEqual([['x', 1], ['z', 2]]);
  });
});

describe('Programs row', () => {
  it('flag off: renders nothing and asks the server for nothing', async () => {
    mockFlags.coachLessons = false;
    const r = await renderQ(<CoachLessonsEntry />);
    expect(r.queryByTestId('coach-lessons-entry')).toBeNull();
    expect(mockApi.getAll).not.toHaveBeenCalled();
  });

  it('flag on: shows the lesson count and opens the editor', async () => {
    const r = await renderQ(<CoachLessonsEntry />);
    await waitFor(() => expect(r.getByLabelText('Lessons, Your clients read these in Learn., 3')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lessons-entry'));
    expect(mockHaptic.selection).toHaveBeenCalled();
    expect(r.getByTestId('coach-lesson-open-a')).toBeTruthy();
  });
});

describe('Lessons sheet', () => {
  it('lists the lessons numbered in server order, with Add lesson; Close closes', async () => {
    let answer: (v: unknown) => void = () => undefined;
    mockApi.getAll.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const onClose = jest.fn();
    const r = await renderQ(<LessonsSheet visible onClose={onClose} />);
    expect(r.getByLabelText('Loading lessons')).toBeTruthy();
    expect(r.queryByTestId('coach-lessons-add')).toBeNull();
    answer({ data: [A, B, C] });
    await waitFor(() => expect(r.getByLabelText('1. Lesson a')).toBeTruthy());
    expect(r.getByLabelText('3. Lesson c')).toBeTruthy();
    // Ends have no arrow past the edge.
    expect(r.queryByTestId('coach-lesson-up-a')).toBeNull();
    expect(r.queryByTestId('coach-lesson-down-c')).toBeNull();
    expect(r.getByTestId('coach-lessons-add')).toBeTruthy();
    await fireEvent.press(r.getByTestId('coach-lessons-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('no lessons: says so and offers Add lesson', async () => {
    server = [];
    const r = await sheet();
    await waitFor(() => expect(r.getByText('No lessons yet.')).toBeTruthy());
    expect(r.getByTestId('coach-lessons-add')).toBeTruthy();
  });

  it('a failed load says so without Add lesson; Try again loads', async () => {
    mockApi.getAll.mockImplementationOnce(() => Promise.reject({ response: { status: 500 } }));
    const r = await sheet();
    await waitFor(() => expect(r.getByText('Your lessons could not load. Try again in a moment.')).toBeTruthy());
    expect(r.queryByTestId('coach-lessons-add')).toBeNull();
    await fireEvent.press(r.getByTestId('coach-lessons-error-retry'));
    await waitFor(() => expect(r.getByLabelText('1. Lesson a')).toBeTruthy());
  });

  it('Add lesson: checks the title and link, then saves at the end of the list', async () => {
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lessons-add')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lessons-add'));
    expect(r.getByText('New lesson')).toBeTruthy();
    await fireEvent.press(r.getByTestId('coach-lesson-save'));
    expect(r.getByText('Add a title.')).toBeTruthy();
    expect(mockHaptic.warning).toHaveBeenCalled();
    await fireEvent.changeText(r.getByLabelText('Title'), '  Sleep first  ');
    await fireEvent.changeText(r.getByLabelText('Text'), 'Eight hours.');
    await fireEvent.changeText(r.getByLabelText('Video link (optional)'), 'ftp://x');
    await fireEvent.press(r.getByTestId('coach-lesson-save'));
    expect(r.getByText('That video link does not look right. Check it, or leave it empty.')).toBeTruthy();
    expect(mockApi.create).not.toHaveBeenCalled();
    await fireEvent.changeText(r.getByLabelText('Video link (optional)'), 'youtu.be/sleep');
    await fireEvent.press(r.getByTestId('coach-lesson-save'));
    await waitFor(() => expect(mockApi.create).toHaveBeenCalledWith({
      title: 'Sleep first', description: 'Eight hours.', video_url: 'https://youtu.be/sleep', order_index: 3,
    }));
    await waitFor(() => expect(r.getByLabelText('4. Sleep first')).toBeTruthy());
    expect(mockHaptic.success).toHaveBeenCalled();
  });

  it('edit: saves the changed fields; an emptied link clears it', async () => {
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lesson-open-a')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lesson-open-a'));
    expect(r.getByText('Edit lesson')).toBeTruthy();
    expect(r.getByLabelText('Title').props.value).toBe('Lesson a');
    await fireEvent.changeText(r.getByLabelText('Video link (optional)'), '');
    await fireEvent.press(r.getByTestId('coach-lesson-save'));
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('a', { title: 'Lesson a', description: 'Text a', video_url: null }));
  });

  it('a failed save keeps the form and says so', async () => {
    mockApi.update.mockImplementationOnce(() => Promise.reject(new Error('down')));
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lesson-open-b')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lesson-open-b'));
    await fireEvent.press(r.getByTestId('coach-lesson-save'));
    await waitFor(() => expect(r.getByText('The lesson did not save. Try again.')).toBeTruthy());
    expect(r.getByTestId('coach-lesson-editor')).toBeTruthy();
    expect(mockHaptic.error).toHaveBeenCalled();
  });

  it('Delete lesson asks first; Keep does nothing, Delete calls DELETE /lessons/:id and returns to the list', async () => {
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lesson-open-b')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lesson-open-b'));
    await fireEvent.press(r.getByTestId('coach-lesson-delete'));
    expect(Alert.alert).toHaveBeenLastCalledWith('Delete this lesson?', 'Your clients will no longer see it.', expect.any(Array));
    expect(mockHaptic.warning).toHaveBeenCalled();
    tapAlert('Keep');
    expect(mockApi.remove).not.toHaveBeenCalled();
    tapAlert('Delete');
    await waitFor(() => expect(mockApi.remove).toHaveBeenCalledWith('b'));
    await waitFor(() => expect(r.getByLabelText('2. Lesson c')).toBeTruthy());
    expect(r.queryByTestId('coach-lesson-open-b')).toBeNull();
  });

  it('a failed delete keeps the lesson open and says so', async () => {
    mockApi.remove.mockImplementationOnce(() => Promise.reject(new Error('down')));
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lesson-open-b')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lesson-open-b'));
    await fireEvent.press(r.getByTestId('coach-lesson-delete'));
    tapAlert('Delete');
    await waitFor(() => expect(r.getByText('The lesson was not deleted. Try again.')).toBeTruthy());
  });

  it('a new lesson has no Delete', async () => {
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lessons-add')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lessons-add'));
    expect(r.queryByTestId('coach-lesson-delete')).toBeNull();
  });

  it('Back with changes asks; Keep editing stays, Discard changes returns; Back with none returns at once', async () => {
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lesson-open-a')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lesson-open-a'));
    await fireEvent.press(r.getByTestId('coach-lesson-editor-bar-back'));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(r.getByTestId('coach-lessons')).toBeTruthy();
    await fireEvent.press(r.getByTestId('coach-lesson-open-a'));
    await fireEvent.changeText(r.getByLabelText('Title'), 'Changed');
    await fireEvent.press(r.getByTestId('coach-lesson-editor-bar-back'));
    expect(Alert.alert).toHaveBeenLastCalledWith('Discard lesson changes?', undefined, expect.any(Array));
    tapAlert('Keep editing');
    expect(r.getByTestId('coach-lesson-editor')).toBeTruthy();
    tapAlert('Discard changes');
    await waitFor(() => expect(r.getByTestId('coach-lessons')).toBeTruthy());
    expect(mockApi.update).not.toHaveBeenCalled();
  });

  it('a move shows the new order before the server answers, and holds the arrows until it does', async () => {
    mockApi.update.mockImplementation(() => new Promise(() => undefined));
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lesson-down-a')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lesson-down-a'));
    await waitFor(() => expect(r.getByLabelText('1. Lesson b')).toBeTruthy());
    expect(server.map((l) => l.order_index)).toEqual([0, 1, 2]);
    expect(r.getByTestId('coach-lesson-down-b').props.accessibilityState).toEqual({ disabled: true });
  });

  it('move down and up write only the changed order values', async () => {
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lesson-down-a')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lesson-down-a'));
    // React Query tells the screen on its next tick, so wait for the new order.
    await waitFor(() => expect(r.getByLabelText('1. Lesson b')).toBeTruthy());
    expect(r.getByLabelText('2. Lesson a')).toBeTruthy();
    expect(mockHaptic.selection).toHaveBeenCalled();
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledTimes(2));
    expect(mockApi.update).toHaveBeenCalledWith('b', { order_index: 0 });
    expect(mockApi.update).toHaveBeenCalledWith('a', { order_index: 1 });
    await waitFor(() => expect(r.getByTestId('coach-lesson-up-c')).toBeTruthy());
    mockApi.update.mockClear();
    await fireEvent.press(r.getByTestId('coach-lesson-up-c'));
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('c', { order_index: 1 }));
    expect(mockApi.update).toHaveBeenCalledWith('a', { order_index: 2 });
    await waitFor(() => expect(r.getByLabelText('3. Lesson a')).toBeTruthy());
    expect(r.getByLabelText('2. Lesson c')).toBeTruthy();
  });

  it('a failed move says so and shows the server order again', async () => {
    mockApi.update.mockImplementation(() => Promise.reject(new Error('down')));
    const r = await sheet();
    await waitFor(() => expect(r.getByTestId('coach-lesson-down-a')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-lesson-down-a'));
    await waitFor(() => expect(r.getByText('The new order did not save. Try again.')).toBeTruthy());
    await waitFor(() => expect(r.getByLabelText('1. Lesson a')).toBeTruthy());
    expect(mockHaptic.error).toHaveBeenCalled();
  });
});
