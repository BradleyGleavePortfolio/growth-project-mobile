/**
 * LessonCard — render + behavioral-design regression tests (v3-2).
 *
 * Pins the card's design contract (DESIGN_INTELLIGENCE Part III):
 *   - ONE clear affordance per card (Hick's Law): tapping the card opens the
 *     lesson; there is no competing secondary control.
 *   - A pinned lesson carries a calm "Pinned" wayfinding cue (a LINE pin icon),
 *     folded into the a11y label — never a ranking/badge-theater reward (§3.7).
 *   - A release-locked lesson renders the LessonReleaseLockBadge and reads as
 *     "on its way" (§3.4 — no punitive states), while staying tappable.
 *   - The media summary headline ("Video · 3 items") tells the student what
 *     kind of lesson this is before they commit a tap.
 *   - The a11y label folds the full state (title + pinned + locked + media)
 *     into a single read for a screen-reader user.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

// Ionicons -> a Text node that forwards name/testID so the line icons are
// observable without loading font assets (repo pattern).
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, testID }: { name: string; testID?: string }) =>
      React.createElement(
        Text,
        { testID: testID ?? `icon-${name}` },
        `icon:${name}`,
      ),
  };
});

import LessonCard, { mediaSummary, primaryMediaKind } from '../LessonCard';
import type {
  ClassroomPost,
  ClassroomMedia,
} from '../../../api/communityClassroomApi';

const WS = '11111111-1111-4111-8111-111111111111';
const COACH = '22222222-2222-4222-8222-222222222222';

function media(overrides: Partial<ClassroomMedia> = {}): ClassroomMedia {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    post_id: '44444444-4444-4444-8444-444444444444',
    kind: 'video',
    url: 'https://signed.example/object',
    duration_sec: 120,
    bytes: 1024,
    mime_type: 'video/mp4',
    width: 1280,
    height: 720,
    created_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function lesson(overrides: Partial<ClassroomPost> = {}): ClassroomPost {
  return {
    id: 'lesson-1',
    workspace_id: WS,
    cohort_id: null,
    coach_id: COACH,
    title: 'Week 1 — Foundations',
    body_markdown: 'Lesson body.',
    status: 'published',
    pinned: false,
    pinned_order: null,
    release_at: null,
    release_locked: false,
    published_at: '2026-03-01T00:00:00.000Z',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    media: [],
    ...overrides,
  };
}

describe('LessonCard — pure helpers', () => {
  it('primaryMediaKind returns the first attachment kind, null when text-only', () => {
    expect(primaryMediaKind([])).toBeNull();
    expect(
      primaryMediaKind([media({ kind: 'audio' }), media({ kind: 'video' })]),
    ).toBe('audio');
  });

  it('mediaSummary is empty for text-only, singular for one, counted for many', () => {
    expect(mediaSummary([])).toBe('');
    expect(mediaSummary([media({ kind: 'pdf' })])).toBe('PDF');
    expect(
      mediaSummary([media({ kind: 'video' }), media({ kind: 'image' })]),
    ).toBe('Video · 2 items');
  });
});

describe('LessonCard — happy path render', () => {
  it('renders the title and a media summary headline cue', async () => {
    await render(
      <LessonCard
        lesson={lesson({
          title: 'Mobility primer',
          media: [media({ kind: 'video' }), media({ kind: 'pdf' })],
        })}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(screen.getByText('Mobility primer')).toBeTruthy();
    // "Video · 2 items" — the primary media kind headlines the summary.
    expect(screen.getByTestId('card-media')).toBeTruthy();
    expect(screen.getByText('Video · 2 items')).toBeTruthy();
    // The video line icon is rendered, never an emoji.
    expect(screen.getByTestId('icon-videocam-outline')).toBeTruthy();
  });

  it('renders no media row and no lock badge for a plain text-only lesson', async () => {
    await render(
      <LessonCard lesson={lesson({ media: [] })} onPress={jest.fn()} testID="card" />,
    );
    expect(screen.queryByTestId('card-media')).toBeNull();
    expect(screen.queryByTestId('card-lock')).toBeNull();
    expect(screen.queryByTestId('card-pinned-icon')).toBeNull();
  });

  it('fires onPress with the lesson (the single affordance)', async () => {
    const onPress = jest.fn();
    await render(
      <LessonCard lesson={lesson({ id: 'lesson-9' })} onPress={onPress} testID="card" />,
    );
    await fireEvent.press(screen.getByTestId('card'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lesson-9' }),
    );
  });

  it('surfaces a pinned wayfinding cue (line pin icon) when pinned', async () => {
    await render(
      <LessonCard lesson={lesson({ pinned: true })} onPress={jest.fn()} testID="card" />,
    );
    expect(screen.getByTestId('card-pinned-icon')).toBeTruthy();
  });
});

describe('LessonCard — release-locked variant', () => {
  it('renders the LessonReleaseLockBadge and stays tappable', async () => {
    const onPress = jest.fn();
    await render(
      <LessonCard
        lesson={lesson({
          release_locked: true,
          release_at: '2026-03-04T00:00:00.000Z',
        })}
        onPress={onPress}
        now={new Date('2026-03-01T00:00:00.000Z')}
        testID="card"
      />,
    );
    // The lock badge renders (passed the card testID prefix).
    expect(screen.getByTestId('card-lock')).toBeTruthy();
    // It reads as "on its way" (3 days out), never "denied".
    expect(screen.getByText('Unlocks in 3 days')).toBeTruthy();
    // Locked lessons stay tappable so the student can open the unlock context.
    await fireEvent.press(screen.getByTestId('card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows the calm fallback "Unlocks soon" when no release time is known', async () => {
    await render(
      <LessonCard
        lesson={lesson({ release_locked: true, release_at: null })}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(screen.getByText('Unlocks soon')).toBeTruthy();
  });
});

describe('LessonCard — accessibility label folds full state into one read', () => {
  it('a plain lesson reads "Open lesson <title>."', async () => {
    await render(
      <LessonCard
        lesson={lesson({ title: 'Sleep hygiene', media: [] })}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(screen.getByTestId('card').props.accessibilityLabel).toBe(
      'Open lesson Sleep hygiene.',
    );
    expect(screen.getByTestId('card').props.accessibilityRole).toBe('button');
  });

  it('folds pinned + locked + media into the label, in that order', async () => {
    await render(
      <LessonCard
        lesson={lesson({
          title: 'Deload week',
          pinned: true,
          release_locked: true,
          release_at: '2026-03-04T00:00:00.000Z',
          media: [media({ kind: 'video' }), media({ kind: 'video' })],
        })}
        onPress={jest.fn()}
        now={new Date('2026-03-01T00:00:00.000Z')}
        testID="card"
      />,
    );
    expect(screen.getByTestId('card').props.accessibilityLabel).toBe(
      'Open lesson Deload week. Pinned. Unlocks later. Video · 2 items.',
    );
  });
});
