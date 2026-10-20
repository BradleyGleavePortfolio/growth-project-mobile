// LEARN-M6 (flag learnCourses): a video lesson plays the signed address, resumes where the server saved it, and saves the place.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import CourseVideoPlayer from '../CourseVideoPlayer';
import CourseLessonScreen from '../CourseLessonScreen';
import { courseFrom, courseCopy } from '../courseData';

const mockHandlers: Record<string, (p: object) => void> = {};
const mockPlayer = {
  loop: true, timeUpdateEventInterval: 0, currentTime: 0, playing: false,
  addListener: jest.fn((event: string, fn: (p: object) => void) => { mockHandlers[event] = fn; return { remove: jest.fn() }; }),
};
const mockSources: unknown[] = [];
let mockSetUp = false;
let mockOnline = true;
jest.mock('expo-video', () => ({
  useVideoPlayer: (src: unknown, setup?: (p: object) => void) => { if (!mockSetUp) { mockSetUp = true; mockSources.push(src); setup?.(mockPlayer); } return mockPlayer; },
  VideoView: (props: object) => require('react').createElement(require('react-native').View, props),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), getState: jest.fn() }), useRoute: () => ({ params: { id: 'k1', lesson: 'l1' } }) }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me', coach_id: 'c1' }) }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: mockOnline }), isEffectivelyOnline: (n: { online: boolean }) => n.online }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() }, lessonsApi: { complete: jest.fn() } }));

const [get, put] = [jest.mocked(api.get), jest.mocked(api.put)];
const URL = 'https://stream.example.com/l1.m3u8?token=abc';
const base = { id: 'l1', title: 'Stairs without fear', mediaId: 'm1' as string | null, videoUrl: null as string | null, positionSeconds: 0 };
const positionCalls = () => put.mock.calls.filter(([u]) => String(u).endsWith('/position'));
const copy = courseCopy('Sam');

function player(over: Partial<typeof base> = {}, props: Partial<React.ComponentProps<typeof CourseVideoPlayer>> = {}) {
  return <CourseVideoPlayer lesson={{ ...base, ...over }} online={mockOnline} failed={copy.noAnswer} {...props} />;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockPlayer, { loop: true, timeUpdateEventInterval: 0, currentTime: 0, playing: false });
  mockSources.length = 0; mockSetUp = false; mockOnline = true;
  get.mockResolvedValue({ data: { url: URL } }); put.mockResolvedValue({ data: {} });
});

describe('CourseVideoPlayer', () => {
  it('plays the signed address and starts at the saved place', async () => {
    render(player({ positionSeconds: 160 }));
    expect(screen.getByTestId('course-video-waiting')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('course-video')).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/v1/client/media/m1/signed-url');
    expect(mockSources).toEqual([URL]);
    expect(mockPlayer.currentTime).toBe(160);
    expect(mockPlayer.timeUpdateEventInterval).toBe(15);
    expect(screen.getByLabelText('Stairs without fear')).toBeTruthy();
  });

  it('starts at the beginning when nothing is saved', async () => {
    render(player());
    await waitFor(() => screen.getByTestId('course-video'));
    expect(mockPlayer.currentTime).toBe(0);
  });

  it('saves the place on pause, once per second reached', async () => {
    render(player());
    await waitFor(() => screen.getByTestId('course-video'));
    mockPlayer.currentTime = 95.7;
    act(() => mockHandlers.playingChange({ isPlaying: false }));
    act(() => mockHandlers.playingChange({ isPlaying: false }));
    expect(positionCalls()).toEqual([['/v1/client/lessons/l1/position', { position_seconds: 95 }]]);
  });

  it('saves every 15 seconds while playing, not while paused', async () => {
    render(player());
    await waitFor(() => screen.getByTestId('course-video'));
    act(() => mockHandlers.timeUpdate({ currentTime: 15 }));
    expect(positionCalls()).toHaveLength(0);
    mockPlayer.playing = true;
    act(() => mockHandlers.timeUpdate({ currentTime: 30.4 }));
    expect(positionCalls()).toEqual([['/v1/client/lessons/l1/position', { position_seconds: 30 }]]);
  });

  it('saves the last known place when the lesson closes, even if the native player is gone', async () => {
    const seen = jest.fn();
    const view = render(player({}, { onPosition: seen }));
    await waitFor(() => screen.getByTestId('course-video'));
    act(() => mockHandlers.timeUpdate({ currentTime: 42 }));
    Object.defineProperty(mockPlayer, 'currentTime', { get: () => { throw new Error('released'); }, set: () => undefined, configurable: true });
    view.unmount();
    Object.defineProperty(mockPlayer, 'currentTime', { value: 0, writable: true, configurable: true });
    expect(positionCalls()).toEqual([['/v1/client/lessons/l1/position', { position_seconds: 42 }]]);
    expect(seen).toHaveBeenCalledWith(42);
  });

  it('does not save a place it already has', async () => {
    const view = render(player({ positionSeconds: 160 }));
    await waitFor(() => screen.getByTestId('course-video'));
    view.unmount();
    expect(positionCalls()).toHaveLength(0);
  });

  it('keeps playing when a save fails', async () => {
    put.mockRejectedValue(new Error('offline'));
    render(player());
    await waitFor(() => screen.getByTestId('course-video'));
    mockPlayer.currentTime = 20;
    act(() => mockHandlers.playingChange({ isPlaying: false }));
    await waitFor(() => expect(positionCalls()).toHaveLength(1));
    expect(screen.getByTestId('course-video')).toBeTruthy();
  });

  it('falls back to the lesson video address when signing fails', async () => {
    get.mockRejectedValue(new Error('404'));
    render(player({ videoUrl: 'https://cdn.example.com/own.mp4' }));
    await waitFor(() => screen.getByTestId('course-video'));
    expect(mockSources).toEqual(['https://cdn.example.com/own.mp4']);
  });

  it('plays a lesson with only a video address without asking for a signed one', async () => {
    render(player({ mediaId: null, videoUrl: 'https://cdn.example.com/own.mp4' }));
    await waitFor(() => screen.getByTestId('course-video'));
    expect(get).not.toHaveBeenCalled();
  });

  it('refuses a signed address that is not https, then retries on request', async () => {
    get.mockResolvedValueOnce({ data: { url: 'http://insecure.example.com/x.mp4' } });
    render(player());
    await waitFor(() => screen.getByText(copy.noAnswer));
    expect(screen.queryByTestId('course-video')).toBeNull();
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => screen.getByTestId('course-video'));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('waits offline without asking, then loads when the connection returns', async () => {
    mockOnline = false;
    const view = render(player({}, { offline: copy.offline }));
    expect(screen.getByText(copy.offline)).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    mockOnline = true;
    view.rerender(player({}, { offline: copy.offline }));
    await waitFor(() => screen.getByTestId('course-video'));
    mockOnline = false;
    view.rerender(player({}, { offline: copy.offline }));
    expect(screen.getByTestId('course-video')).toBeTruthy(); // a dropped signal does not stop a lesson that is playing
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('CourseLessonScreen with a video', () => {
  const lesson = (extra: object) => ({ id: 'l1', title: 'Stairs without fear', kind: 'video', done: false, duration_sec: 420, ...extra });
  const course = (l: object) => ({ id: 'k1', title: 'Knee Rehab', coach_name: 'Sam Lee', modules: [{ id: 'm1', position: 1, title: 'Start', open: true, lessons: [l] }] });
  const open = async (l: object) => {
    get.mockImplementation((u: string) => Promise.resolve({ data: u.includes('/media/') ? { url: URL } : course(l) }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<CourseLessonScreen />, { wrapper: ({ children }: { children: React.ReactNode }) => (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </SafeAreaProvider>
    ) });
  };

  it('reads the media, address and saved place from the course', () => {
    const [l] = courseFrom(course(lesson({ media_asset_id: 'm1', video_url: 'https://cdn.example.com/a.mp4', position_seconds: 160.9 }))).weeks[0].lessons;
    expect(l).toMatchObject({ mediaId: 'm1', videoUrl: 'https://cdn.example.com/a.mp4', positionSeconds: 160 });
    expect(courseFrom(course(lesson({ position_seconds: -4 }))).weeks[0].lessons[0]).toMatchObject({ mediaId: null, videoUrl: null, positionSeconds: 0 });
  });

  it('shows the player above the title and Mark as complete below', async () => {
    await open(lesson({ media_asset_id: 'm1', position_seconds: 160 }));
    await waitFor(() => screen.getByTestId('course-video'));
    expect(screen.getByText('Stairs without fear')).toBeTruthy();
    expect(screen.getByTestId('course-lesson-complete')).toBeTruthy();
    expect(mockPlayer.currentTime).toBe(160);
  });

  it('shows no player on a page lesson', async () => {
    await open(lesson({ kind: 'page', body_markdown: 'Some words.' }));
    await waitFor(() => screen.getByText('Some words.'));
    expect(screen.queryByTestId('course-video-waiting')).toBeNull();
    expect(screen.queryByTestId('course-video')).toBeNull();
  });
});
