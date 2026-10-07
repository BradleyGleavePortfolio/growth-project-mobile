import React from 'react';
import { Linking } from 'react-native';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { fireEvent, render } from '@testing-library/react-native';
import EducationScreen from '../EducationScreen';
import { lessonFromApi } from '../educationLesson';
import { lessonsApi } from '../../../services/api';
import { markLessonComplete } from '../../../db/educationDb';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../hooks/useCurrentUser', () => {
  const user = { id: 'student_1' };
  return { useCurrentUser: () => user };
});
jest.mock('../../../theme/ThemeProvider', () => {
  const colors = {
    primary: '#4a0404', textPrimary: '#000', textSecondary: '#333',
    textMuted: '#555', background: '#fff', textOnPrimary: '#fff',
  };
  return { useTheme: () => ({ colors, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }) };
});
jest.mock('../../../services/api', () => ({
  lessonsApi: { getAll: jest.fn(), complete: jest.fn() },
}));
jest.mock('../../../db/educationDb', () => ({
  getUserProgress: jest.fn().mockResolvedValue([]),
  markLessonComplete: jest.fn().mockResolvedValue(undefined),
}));

const serverLesson = {
  id: 'lesson-1',
  title: 'Bench press technique',
  description: 'Keep the feet planted and lower the bar under control.',
  video_url: 'https://example.com/bench-video',
  article_url: 'https://example.com/bench-article',
  order_index: 2,
  created_at: '2026-10-01T12:00:00Z',
  completions: [],
};
const getAll = jest.mocked(lessonsApi.getAll);
const complete = jest.mocked(lessonsApi.complete);
function response<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };
}

beforeEach(() => {
  jest.clearAllMocks();
  getAll.mockResolvedValue(response([serverLesson]));
  complete.mockResolvedValue(response({ id: 'completion-1' }));
});

test('maps the actual Prisma lesson payload, including completion records and content links', () => {
  expect(lessonFromApi({ ...serverLesson, completions: [{ id: 'done-1', user_id: 'student_1' }] }))
    .toMatchObject({
      content: serverLesson.description,
      completed: true,
      sortOrder: 2,
      durationMin: 0,
      videoUrl: serverLesson.video_url,
      articleUrl: serverLesson.article_url,
    });
});

test('shows real description and opens both coach-provided lesson links', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const screen = await render(<EducationScreen />);
  await fireEvent.press(await screen.findByText(serverLesson.title));
  expect(screen.getByText(serverLesson.description)).toBeTruthy();
  await fireEvent.press(screen.getByText('Watch lesson'));
  expect(openURL).toHaveBeenCalledWith(serverLesson.video_url);
  await fireEvent.press(screen.getByText('Read article'));
  expect(openURL).toHaveBeenCalledWith(serverLesson.article_url);
  openURL.mockRestore();
});

test('server progress survives a fresh local completion cache', async () => {
  getAll.mockResolvedValue(response([{ ...serverLesson, completions: [{ id: 'done-1' }] }]));
  const screen = await render(<EducationScreen />);
  expect(await screen.findByText('1 of 1 lessons')).toBeTruthy();
});

test('failed loading shows a retry rather than claiming the coach has published nothing', async () => {
  getAll.mockRejectedValueOnce(new Error('Network Error'));
  const screen = await render(<EducationScreen />);
  expect(await screen.findByText('Lessons did not load. Check your connection and try again.')).toBeTruthy();
  expect(screen.queryByText('No lessons yet')).toBeNull();
  await fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByText(serverLesson.title)).toBeTruthy();
});

test('does not claim completion or cache it when the server rejects the save', async () => {
  complete.mockRejectedValueOnce(new Error('Network Error'));
  const screen = await render(<EducationScreen />);
  await fireEvent.press(await screen.findByText(serverLesson.title));
  await fireEvent.press(screen.getByText('Mark as complete'));
  expect(await screen.findByText('Lesson completion did not save. Check your connection and try again.')).toBeTruthy();
  expect(screen.queryByText('Complete.')).toBeNull();
  expect(markLessonComplete).not.toHaveBeenCalled();
});

test('lesson rows are factual, filters and detail back remain reachable, completion saves', async () => {
  const screen = await render(<EducationScreen />);
  await screen.findByText(serverLesson.title);
  expect(screen.queryByText('Featured')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Fitness' }));
  await fireEvent.press(screen.getByRole('button', { name: 'All' }));
  await fireEvent.press(screen.getByText(serverLesson.title));
  await fireEvent.press(screen.getByText('Mark as complete'));
  expect(await screen.findByText('Complete.')).toBeTruthy();
  expect(complete).toHaveBeenCalledWith(serverLesson.id);
  await fireEvent.press(screen.getByRole('button', { name: 'Back to lessons' }));
  expect(await screen.findByText('1 of 1 lessons')).toBeTruthy();
});

test('empty library makes no claim about having a coach', async () => {
  getAll.mockResolvedValue(response([]));
  const screen = await render(<EducationScreen />);
  expect(await screen.findByText('No lessons available. Pull down to refresh.')).toBeTruthy();
});
