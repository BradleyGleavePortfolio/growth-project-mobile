// LEARN-A (flag learnHub): Learn and the lesson view render the coach's own
// guidelines and lessons, every state, and claim done only after the server.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api, { coachApi, lessonsApi } from '../../../../services/api';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { featureFlags } from '../../../../config/featureFlags';
import LearnScreen from '../LearnScreen';
import LearnLessonScreen from '../LearnLessonScreen';
import { GUIDELINES_PLAN_TITLE, lessonMeta, lessonsFrom } from '../learnData';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(), getParent: jest.fn(), getState: jest.fn() };
let mockParams: { id?: string } = {};
let mockUser: { id: string; coach_id?: string | null } | null = { id: 'me', coach_id: 'c1' };
let mockOnline = true;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
  StackActions: { replace: (name: string, params: object) => ({ type: 'REPLACE', payload: { name, params } }) },
}));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ online: mockOnline }), isEffectivelyOnline: (n: { online: boolean }) => n.online,
}));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  coachApi: { getMyGuidelines: jest.fn() },
  lessonsApi: { getAll: jest.fn(), complete: jest.fn() },
}));

const year = new Date().getFullYear();
const GUIDE = { description: 'Food\n- Protein at every meal, about a palm.\n- A water bottle on your desk.', updated_at: `${year}-10-12T12:00:00Z` };
const row = (id: string, title: string, done: boolean, extra: object = {}) =>
  ({ id, title, description: 'Short read.', video_url: null, article_url: null, completions: done ? [{ id: `x${id}` }] : [], ...extra });
const LESSONS = [row('l1', 'How Sam builds your week', true), row('l2', 'Protein, simply', false), row('l3', 'Sleep and training', false, { description: null, video_url: 'https://v.example.test/3' })];
const ok = <T,>(data: T) => Promise.resolve({ data });
const lessons = jest.mocked(lessonsApi);
const guidelines = jest.mocked(coachApi.getMyGuidelines);

async function show(Comp: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const tree = () => (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      <QueryClientProvider client={client}><Comp /></QueryClientProvider>
    </SafeAreaProvider>
  );
  const view = await render(tree());
  return { ...view, again: () => view.rerender(tree()) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {}; mockUser = { id: 'me', coach_id: 'c1' }; mockOnline = true;
  mockNav.getParent.mockReturnValue(null);
  mockNav.getState.mockReturnValue({ index: 1, routes: [{ name: 'MoreIndex' }, { name: 'Learn' }] });
  jest.mocked(api.get).mockImplementation(() => ok({ name: 'Sam Lee' }) as never);
  lessons.getAll.mockImplementation(() => ok(LESSONS) as never);
  lessons.complete.mockImplementation(() => ok({}) as never);
  guidelines.mockImplementation(() => ok(GUIDE) as never);
});

describe('Learn', () => {
  it('is off in every build until the owner turns it on', () => {
    expect(featureFlags.learnHub).toBe(false);
  });

  it('shows the coach, the guidelines card and the numbered lessons with one next step', async () => {
    await show(LearnScreen);
    expect(await screen.findByText('1 of 3 done')).toBeTruthy();
    expect(screen.getByText('From Sam')).toBeTruthy();
    expect(screen.getByText("Sam's guidelines and lessons for you.")).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Food Protein at every meal, about a palm. A water bottle on your desk.')).toBeTruthy();
    expect(screen.getByText('Updated October 12')).toBeTruthy();
    expect(screen.getByLabelText('1 of 3 lessons complete')).toBeTruthy();
    expect(screen.getByLabelText('Lesson 1, How Sam builds your week, complete')).toBeTruthy();
    expect(screen.getByLabelText('Lesson 2, Protein, simply, not complete')).toBeTruthy();
    expect(screen.getByText('Video')).toBeTruthy();
    expect(guidelines).toHaveBeenCalledWith({ quietPaywall: true });

    await fireEvent.press(screen.getByText('Read all'));
    expect(mockNav.navigate).toHaveBeenLastCalledWith('CoachGuidelines');
    await fireEvent.press(screen.getByLabelText('Lesson 3, Sleep and training, not complete'));
    expect(HapticService.selection).toHaveBeenCalledTimes(1);
    expect(mockNav.navigate).toHaveBeenLastCalledWith('LearnLesson', { id: 'l3' });
    await fireEvent.press(screen.getByText('Read lesson 2'));
    expect(mockNav.navigate).toHaveBeenLastCalledWith('LearnLesson', { id: 'l2' });
  });

  it("says an older server's 402 in today's words with no plans button, and the lessons stay open", async () => {
    guidelines.mockImplementation(() => Promise.reject({ response: { status: 402, data: { error: 'CLIENT_ENTITLEMENT_REQUIRED' } } }));
    await show(LearnScreen);
    expect(await screen.findByText(GUIDELINES_PLAN_TITLE)).toBeTruthy();
    expect(screen.queryByText('View plans')).toBeNull();
    expect(screen.queryByText('Read all')).toBeNull();
    expect(screen.getByText('Read lesson 2')).toBeTruthy();
  });

  it('holds one spoken skeleton while the reads are in flight, with no button', async () => {
    lessons.getAll.mockImplementation(() => new Promise(() => {}) as never);
    await show(LearnScreen);
    expect(await screen.findByLabelText("Loading Sam's guidelines and lessons")).toBeTruthy();
    expect(screen.queryByText(/Read lesson/)).toBeNull();
  });

  it('with nothing written yet says so and offers the coach thread', async () => {
    lessons.getAll.mockImplementation(() => ok([]) as never);
    guidelines.mockImplementation(() => ok(null) as never);
    const parent = { navigate: jest.fn() };
    mockNav.getParent.mockReturnValue(parent);
    await show(LearnScreen);
    expect(await screen.findByText('Nothing from Sam yet')).toBeTruthy();
    expect(screen.getByText('When Sam adds guidelines or a lesson, they show here.')).toBeTruthy();
    expect(screen.queryByText(/Read lesson/)).toBeNull();
    await fireEvent.press(screen.getByText('Message Sam'));
    expect(parent.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', initial: false });
  });

  it('without a coach asks the server nothing and shows no coach thread', async () => {
    mockUser = { id: 'me', coach_id: null };
    await show(LearnScreen);
    expect(await screen.findByText('Nothing from your coach yet')).toBeTruthy();
    expect(screen.queryByText('Message your coach')).toBeNull();
    expect(lessons.getAll).not.toHaveBeenCalled();
    expect(guidelines).not.toHaveBeenCalled();
  });

  it('a failed read is one calm sentence and Try again', async () => {
    lessons.getAll.mockImplementationOnce(() => Promise.reject({ response: { status: 500 } }));
    await show(LearnScreen);
    expect(await screen.findByText("Sam's guidelines and lessons did not load.")).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('1 of 3 done')).toBeTruthy();
  });

  it('names the connection only when there was no answer', async () => {
    lessons.getAll.mockImplementationOnce(() => Promise.reject({ message: 'Network Error' }));
    await show(LearnScreen);
    expect(await screen.findByText("Sam's guidelines and lessons did not load. Check the connection and try again.")).toBeTruthy();
  });

  it('offline on first open is one sentence and loads by itself once back online', async () => {
    mockOnline = false;
    lessons.getAll.mockImplementationOnce(() => Promise.reject({ message: 'Network Error' }));
    const view = await show(LearnScreen);
    expect(await screen.findByText('Guidelines and lessons load when you are back online.')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    mockOnline = true;
    await view.again();
    expect(await screen.findByText('1 of 3 done')).toBeTruthy();
    expect(lessons.getAll).toHaveBeenCalledTimes(2);
  });
});

describe('Learn lesson view', () => {
  it('claims done only after the server saves it, then names the next lesson', async () => {
    mockParams = { id: 'l2' };
    let save: (v: unknown) => void = () => undefined;
    lessons.complete.mockImplementation(() => new Promise((r) => { save = r; }) as never);
    await show(LearnLessonScreen);
    expect(await screen.findByText('Lesson 2 of 3 · from Sam')).toBeTruthy();
    expect(screen.getByText('Protein, simply')).toBeTruthy();
    expect(screen.getByText('Reading · about 1 min')).toBeTruthy();
    await fireEvent.press(screen.getByText('Mark as complete'));
    expect(lessons.complete).toHaveBeenCalledWith('l2');
    expect(screen.queryByText('Lesson 2 of 3 complete.')).toBeNull();
    save({ data: {} });
    expect(await screen.findByText('Lesson 2 of 3 complete.')).toBeTruthy();
    expect(HapticService.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Mark as complete')).toBeNull();
    expect(screen.getByText('Next: Sleep and training')).toBeTruthy();
    expect(screen.getByText('Lesson 3 of 3 · Video')).toBeTruthy();
    await fireEvent.press(screen.getByText('Next: Sleep and training'));
    expect(mockNav.dispatch).toHaveBeenCalledWith({ type: 'REPLACE', payload: { name: 'LearnLesson', params: { id: 'l3' } } });
  });

  it('after the last lesson says all are complete with no next row; a done lesson opens without the button', async () => {
    lessons.getAll.mockImplementation(() => ok([row('l1', 'One', true), row('l2', 'Two', false)]) as never);
    mockParams = { id: 'l2' };
    const first = await show(LearnLessonScreen);
    await fireEvent.press(await screen.findByText('Mark as complete'));
    expect(await screen.findByText("All 2 of Sam's lessons are complete.")).toBeTruthy();
    expect(screen.queryByText(/^Next:/)).toBeNull();
    await first.unmount();
    mockParams = { id: 'l1' };
    await show(LearnLessonScreen);
    expect(await screen.findByText('Lesson 1 of 2 complete.')).toBeTruthy();
    expect(screen.queryByText('Mark as complete')).toBeNull();
  });

  it('a failed save keeps the sentence above the button, with one error haptic', async () => {
    lessons.complete.mockImplementation(() => Promise.reject({ message: 'Network Error' }));
    mockParams = { id: 'l2' };
    await show(LearnLessonScreen);
    await fireEvent.press(await screen.findByText('Mark as complete'));
    expect(await screen.findByText('Lesson completion did not save. Check your connection and try again.')).toBeTruthy();
    expect(HapticService.error).toHaveBeenCalledTimes(1);
    expect(HapticService.success).not.toHaveBeenCalled();
    expect(screen.getByText('Mark as complete')).toBeTruthy();
  });
});

describe('learnData', () => {
  it('reads the server rows and times a lesson at about 200 words a minute', () => {
    const [long, video, bare] = lessonsFrom([
      { id: 1, title: ' Long ', description: Array(450).fill('word').join(' '), completions: [] },
      { id: 2, title: '', video_url: 'https://v.example.test', article_url: 'javascript:alert(1)' },
      { id: 3, title: 'Bare' },
    ]);
    expect(long).toMatchObject({ id: '1', title: 'Long', done: false });
    expect(lessonMeta(long)).toBe('Reading · about 2 min');
    expect(video).toMatchObject({ title: 'Untitled lesson', videoUrl: 'https://v.example.test', articleUrl: null });
    expect(lessonMeta(video)).toBe('Video');
    expect(lessonMeta(bare)).toBeNull();
    expect(lessonsFrom({ lessons: [] })).toEqual([]);
  });
});
