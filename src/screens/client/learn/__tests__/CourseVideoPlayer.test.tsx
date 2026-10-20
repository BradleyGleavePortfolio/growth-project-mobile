// LEARN-M6 (flag learnCourses): a video lesson plays the lesson's address (GET /v1/client/lessons/:id/video), resumes where the server
// saved it, saves the place (PUT /v1/client/lessons/:id/position { position_seconds }), and recovers from a failed or expired video.
// Both routes are OPERATOR RULING 6282886845 items 4 and 5, mocked here until b#1114 lands.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { lightTokens } from '../../../../theme/tokens';
import CourseVideoPlayer from '../CourseVideoPlayer';
import CourseLessonScreen from '../CourseLessonScreen';
import { courseFrom, courseCopy } from '../courseData';

const mockHandlers: Record<string, (p: object) => void> = {};
const mockPlayer = {
  loop: true, timeUpdateEventInterval: 0, currentTime: 0, playing: false, duration: 420,
  addListener: jest.fn((event: string, fn: (p: object) => void) => { mockHandlers[event] = fn; return { remove: jest.fn() }; }),
};
const mockSources: unknown[] = [];
const mockStarts: number[] = [];
let mockOnline = true;
jest.mock('expo-video', () => ({
  // One native player per address, as expo-video makes one per source; each records where it was told to start.
  useVideoPlayer: (src: unknown, setup?: (p: { currentTime: number }) => void) => require('react').useMemo(() => {
    mockSources.push(src); mockPlayer.currentTime = 0; setup?.(mockPlayer); mockStarts.push(mockPlayer.currentTime); return mockPlayer;
  }, [src]),
  VideoView: (props: object) => require('react').createElement(require('react-native').View, props),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), getState: jest.fn() }), useRoute: () => ({ params: { id: 'k1', lesson: 'l1' } }) }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me', coach_id: 'c1' }) }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: mockOnline }), isEffectivelyOnline: (n: { online: boolean }) => n.online }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() }, lessonsApi: { complete: jest.fn() } }));

const [get, put] = [jest.mocked(api.get), jest.mocked(api.put)];
const VIDEO = '/v1/client/lessons/l1/video';
const URL = 'https://stream.example.com/l1.m3u8?token=abc';
const FRESH = 'https://stream.example.com/l1.m3u8?token=new';
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const address = (url = URL, expires_at: string | null = later(3_600_000)) => ({ data: { url, expires_at } });
const base = { id: 'l1', title: 'Stairs without fear', positionSeconds: 0 };
const positionCalls = () => put.mock.calls.filter(([u]) => String(u).endsWith('/position'));
const copy = courseCopy('Sam');
const quiet = { quietPaywall: true };

function player(over: Partial<typeof base> = {}, props: Partial<React.ComponentProps<typeof CourseVideoPlayer>> = {}) {
  return <CourseVideoPlayer lesson={{ ...base, ...over }} online={mockOnline} failed={copy.failed} noAnswer={copy.noAnswer} {...props} />;
}
const playing = () => waitFor(() => expect(screen.getByTestId('course-video')).toBeTruthy());
const fail = (message: string) => act(async () => mockHandlers.statusChange({ status: 'error', error: { message } }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockPlayer, { loop: true, timeUpdateEventInterval: 0, currentTime: 0, playing: false });
  mockSources.length = 0; mockStarts.length = 0; mockOnline = true;
  get.mockResolvedValue(address()); put.mockResolvedValue({ data: {} });
});

describe('CourseVideoPlayer: the address', () => {
  it('asks the lesson route for the address, plays it and starts at the saved place', async () => {
    await render(player({ positionSeconds: 160 }));
    await playing();
    expect(get).toHaveBeenCalledWith(VIDEO, quiet);
    expect(get.mock.calls.some(([u]) => String(u).includes('/media/'))).toBe(false);
    expect(mockSources).toEqual([URL]);
    expect(mockStarts).toEqual([160]);
    expect(mockPlayer.timeUpdateEventInterval).toBe(15);
    expect(screen.getByLabelText('Stairs without fear')).toBeTruthy();
  });

  it('starts at the beginning when nothing is saved', async () => {
    await render(player());
    await playing();
    expect(mockStarts).toEqual([0]);
  });

  it('waits on the dark frame from the first draw, named for screen readers', async () => {
    get.mockReturnValue(new Promise(() => undefined));
    await render(player());
    const frame = screen.getByTestId('course-video-waiting');
    expect(StyleSheet.flatten(frame.props.style).backgroundColor).toBe(lightTokens.surface.masthead);
    expect(frame.props.accessibilityLabel).toBe('Stairs without fear');
    expect(frame.props.accessibilityState).toEqual({ busy: true });
    expect(screen.queryByTestId('course-video')).toBeNull();
  });

  it('an address that is not https is the failed frame with the course sentence, not the connection one; Try again asks again', async () => {
    get.mockResolvedValueOnce(address('http://insecure.example.com/x.mp4'));
    await render(player());
    await waitFor(() => screen.getByText(copy.failed));
    expect(screen.queryByText(copy.noAnswer)).toBeNull();
    expect(screen.queryByTestId('course-video')).toBeNull();
    await fireEvent.press(screen.getByText('Try again'));
    await playing();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a lesson that is not available (404) is the course sentence with Try again; no answer is the connection sentence', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('404'), { response: { status: 404 } }));
    const view = await render(player());
    await waitFor(() => screen.getByText(copy.failed));
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByTestId('course-video')).toBeNull();
    await view.unmount();
    get.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    await render(player());
    await waitFor(() => screen.getByText(copy.noAnswer));
    expect(screen.getByTestId('course-video-failed')).toBeTruthy();
  });

  it('waits offline without asking, then loads when the connection returns, and a dropped signal does not stop it', async () => {
    mockOnline = false;
    const view = await render(player({}, { offline: copy.offline }));
    expect(screen.getByText(copy.offline)).toBeTruthy();
    expect(screen.getByTestId('course-video-waiting').props.accessibilityLabel).toBe(copy.offline);
    expect(get).not.toHaveBeenCalled();
    mockOnline = true;
    await view.rerender(player({}, { offline: copy.offline }));
    await playing();
    mockOnline = false;
    await view.rerender(player({}, { offline: copy.offline }));
    expect(screen.getByTestId('course-video')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('CourseVideoPlayer: a video that fails after it loaded', () => {
  it('shows the connection sentence with Try again, never a dead frame; Try again fetches a fresh address and plays on from the place', async () => {
    await render(player());
    await playing();
    mockPlayer.playing = true;
    await act(async () => mockHandlers.timeUpdate({ currentTime: 42 }));
    get.mockResolvedValueOnce(address(FRESH));
    await fail('The network connection was lost.');
    expect(screen.queryByTestId('course-video')).toBeNull();
    expect(screen.getByTestId('course-video-failed')).toBeTruthy();
    expect(screen.getByText(copy.noAnswer)).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('Try again'));
    await playing();
    expect(get).toHaveBeenCalledTimes(2);
    expect(mockSources).toEqual([URL, FRESH]);
    expect(mockStarts).toEqual([0, 42]);
  });

  it('an expired address is replaced quietly and plays on from the place', async () => {
    get.mockResolvedValueOnce(address(URL, later(-1000)));
    await render(player());
    await playing();
    mockPlayer.currentTime = 75;
    get.mockResolvedValueOnce(address(FRESH));
    await fail('HTTP 400');
    await playing();
    expect(screen.queryByTestId('course-video-failed')).toBeNull();
    expect(mockSources).toEqual([URL, FRESH]);
    expect(mockStarts).toEqual([0, 75]);
  });

  it('an address with no expiry (expires_at null) is never replaced on time alone; an error is Try again, which asks again', async () => {
    get.mockResolvedValueOnce(address(URL, null));
    await render(player());
    await playing();
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T00:00:00Z'));
    await fail('The network connection was lost.');
    now.mockRestore();
    expect(screen.getByTestId('course-video-failed')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('Try again'));
    await playing();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a refused address is replaced once; if the fresh one is refused too, it is Try again, not a loop', async () => {
    await render(player());
    await playing();
    get.mockResolvedValueOnce(address(FRESH));
    await fail('CoreMediaErrorDomain error -12660 - HTTP 403: Forbidden');
    await playing();
    expect(get).toHaveBeenCalledTimes(2);
    await fail('Response code: 403');
    expect(screen.getByTestId('course-video-failed')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('CourseVideoPlayer: saving the place', () => {
  it('PUTs the contract path and body on pause, once per second reached', async () => {
    await render(player());
    await playing();
    mockPlayer.currentTime = 95.7;
    await act(async () => mockHandlers.playingChange({ isPlaying: false }));
    await act(async () => mockHandlers.playingChange({ isPlaying: false }));
    expect(positionCalls()).toEqual([['/v1/client/lessons/l1/position', { position_seconds: 95 }, quiet]]);
  });

  it('saves every 15 seconds while playing, not while paused', async () => {
    await render(player());
    await playing();
    await act(async () => mockHandlers.timeUpdate({ currentTime: 15 }));
    expect(positionCalls()).toHaveLength(0);
    mockPlayer.playing = true;
    await act(async () => mockHandlers.timeUpdate({ currentTime: 30.4 }));
    expect(positionCalls()).toEqual([['/v1/client/lessons/l1/position', { position_seconds: 30 }, quiet]]);
  });

  it('finishing saves 0, so a rewatch starts at the start, and leaving after the end keeps 0', async () => {
    const seen = jest.fn();
    const view = await render(player({ positionSeconds: 300 }, { onPosition: seen }));
    await playing();
    mockPlayer.currentTime = 420;
    await act(async () => mockHandlers.playToEnd({}));
    await act(async () => mockHandlers.playingChange({ isPlaying: false }));
    await view.unmount();
    expect(positionCalls()).toEqual([['/v1/client/lessons/l1/position', { position_seconds: 0 }, quiet]]);
    expect(seen).toHaveBeenLastCalledWith(0);
  });

  it('a stop in the last second saves 0 even before the finish event, and leaving there keeps 0', async () => {
    const view = await render(player({ positionSeconds: 300 }));
    await playing();
    mockPlayer.currentTime = 419.6;
    await act(async () => mockHandlers.playingChange({ isPlaying: false }));
    await view.unmount();
    expect(positionCalls()).toEqual([['/v1/client/lessons/l1/position', { position_seconds: 0 }, quiet]]);
  });

  it('saves the last known place when the lesson closes, even if the native player is gone', async () => {
    const seen = jest.fn();
    const view = await render(player({}, { onPosition: seen }));
    await playing();
    await act(async () => mockHandlers.timeUpdate({ currentTime: 42 }));
    Object.defineProperty(mockPlayer, 'currentTime', { get: () => { throw new Error('released'); }, set: () => undefined, configurable: true });
    await view.unmount();
    Object.defineProperty(mockPlayer, 'currentTime', { value: 0, writable: true, configurable: true });
    expect(positionCalls()).toEqual([['/v1/client/lessons/l1/position', { position_seconds: 42 }, quiet]]);
    expect(seen).toHaveBeenCalledWith(42);
  });

  it('does not save a place it already has, and keeps playing when a save fails', async () => {
    const view = await render(player({ positionSeconds: 160 }));
    await playing();
    await view.unmount();
    expect(positionCalls()).toHaveLength(0);
    put.mockRejectedValue(new Error('offline'));
    await render(player());
    await playing();
    mockPlayer.currentTime = 20;
    await act(async () => mockHandlers.playingChange({ isPlaying: false }));
    await waitFor(() => expect(positionCalls()).toHaveLength(1));
    expect(screen.getByTestId('course-video')).toBeTruthy();
  });
});

describe('CourseLessonScreen with a video', () => {
  const lesson = (extra: object) => ({ id: 'l1', title: 'Stairs without fear', kind: 'video', done: false, duration_sec: 420, ...extra });
  const course = (l: object) => ({ id: 'k1', title: 'Knee Rehab', coach_name: 'Sam Lee', modules: [{ id: 'm1', position: 1, title: 'Start', open: true, lessons: [l] }] });
  const open = async (l: object) => {
    get.mockImplementation((u: string) => Promise.resolve(u === VIDEO ? address() : { data: course(l) }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return await render(<CourseLessonScreen />, { wrapper: ({ children }: { children: React.ReactNode }) => (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </SafeAreaProvider>
    ) });
  };

  it('reads the saved place from the course', () => {
    expect(courseFrom(course(lesson({ position_seconds: 160.9 }))).weeks[0].lessons[0]).toMatchObject({ positionSeconds: 160 });
    expect(courseFrom(course(lesson({ position_seconds: -4 }))).weeks[0].lessons[0]).toMatchObject({ positionSeconds: 0 });
  });

  it('shows the player above the title and Mark as complete below, for video and video-and-page lessons', async () => {
    const view = await open(lesson({ position_seconds: 160 }));
    await playing();
    expect(get).toHaveBeenCalledWith(VIDEO, quiet);
    expect(screen.getByText('Stairs without fear')).toBeTruthy();
    expect(screen.getByTestId('course-lesson-complete')).toBeTruthy();
    expect(mockStarts).toEqual([160]);
    await view.unmount();
    await open(lesson({ kind: 'both', body_markdown: 'Some words.' }));
    await playing();
    expect(screen.getByText('Some words.')).toBeTruthy();
  });

  it('shows no player and asks for no address on a page lesson', async () => {
    await open(lesson({ kind: 'page', body_markdown: 'Some words.' }));
    await waitFor(() => screen.getByText('Some words.'));
    expect(screen.queryByTestId('course-video-waiting')).toBeNull();
    expect(screen.queryByTestId('course-video')).toBeNull();
    expect(get).not.toHaveBeenCalledWith(VIDEO, quiet);
  });
});
