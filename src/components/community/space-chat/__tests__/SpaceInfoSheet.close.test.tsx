/**
 * W897-CLOSE (agent 185, owner "#181-W2 - option 1"): the Space info sheet's visible Close. In every state the sheet
 * can show (member, coach, loading, offline, failed with Try again, a long purpose, many people with Show more, people
 * closed) the header leads with one Close: a button named "Close" (no new words), 44 pt square, the X in forest, first
 * for VoiceOver, outside the list so it never scrolls away. It closes as the scrim, Android Back and the VoiceOver escape
 * do (onClose, once), and the sheet stays modal for a screen reader, so the Close is the one Close it can reach.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { forestPop as fp } from '../../../../theme/tokens';
import SpaceInfoSheet, { type SpacePeopleAccess } from '../SpaceInfoSheet';
import type { SpaceMember } from '../spaceMembers';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
type MembersState = {
  data?: { pages: { members: SpaceMember[]; next_cursor: string | null }[] };
  error: unknown;
  hasNextPage: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
  isFetching: boolean;
  refetch: jest.Mock;
  fetchNextPage: jest.Mock;
};
const mockMembers: { current: MembersState } = { current: {} as MembersState };
jest.mock('../spaceMembers', () => ({
  ...jest.requireActual('../spaceMembers'),
  useSpaceMembers: () => mockMembers.current,
}));

const person = (user_id: string, display_name: string, role = 'student'): SpaceMember => ({ user_id, display_name, role });
const PEOPLE = [person('coach-1', 'Sam', 'coach'), person('team-1', 'Casey', 'co_coach'), person('me-1', 'Dana'), person('m-2', 'Avery')];
const MANY = [...PEOPLE, ...Array.from({ length: 46 }, (_, i) => person(`m-${i + 3}`, `Member ${i + 3}`))];
const LONG_PURPOSE = 'Ten minutes of mobility every weekday at 7 AM. '.repeat(12).trim();

const membersState = (over: Partial<MembersState> = {}): MembersState => ({
  data: undefined, error: null, hasNextPage: false, isFetchNextPageError: false, isFetchingNextPage: false, isFetching: false,
  refetch: jest.fn(), fetchNextPage: jest.fn(), ...over,
});
const loaded = (members: SpaceMember[], next_cursor: string | null = null) => ({ data: { pages: [{ members, next_cursor }] } });

type Case = { name: string; people: SpacePeopleAccess; viewerId: string; purpose?: string; offline?: boolean; error?: unknown; members: Partial<MembersState> };
const CASES: Case[] = [
  { name: 'loaded, member', people: 'open', viewerId: 'me-1', members: loaded(PEOPLE) },
  { name: 'loaded, coach', people: 'open', viewerId: 'coach-1', members: loaded(PEOPLE) },
  { name: 'loading (people asked for)', people: 'open', viewerId: 'me-1', members: { isFetching: true } },
  { name: 'loading (waiting on the server)', people: 'wait', viewerId: 'me-1', members: {} },
  { name: 'offline before the people loaded', people: 'wait', viewerId: 'me-1', offline: true, members: {} },
  { name: 'failed, with Try again', people: 'failed', viewerId: 'me-1', error: new Error('500'), members: {} },
  { name: 'people could not load', people: 'open', viewerId: 'me-1', members: { error: new Error('500') } },
  { name: 'long purpose', people: 'open', viewerId: 'me-1', purpose: LONG_PURPOSE, members: loaded(PEOPLE) },
  { name: 'many people, Show more', people: 'open', viewerId: 'me-1', members: { ...loaded(MANY, 'cursor-50'), hasNextPage: true } },
  { name: 'people closed', people: 'closed', viewerId: 'me-1', members: {} },
];

async function open(c: Case) {
  mockMembers.current = membersState(c.members);
  const onClose = jest.fn();
  const onRetry = jest.fn();
  await render(
    <SpaceInfoSheet cohortId="c-every" name="Everyone" members="24 members" description={c.purpose ?? 'Say hi and share your wins.'}
      people={c.people} viewerId={c.viewerId} offline={c.offline ?? false} error={c.error} onRetry={onRetry} onClose={onClose} />,
  );
  return { onClose, onRetry, sheet: screen.getByTestId('space-info-sheet'), close: screen.getByTestId('space-info-close') };
}

/** What a screen reader steps through inside the sheet, in reading order: accessible elements and loose text. */
function readingOrder(root: TestInstance): TestInstance[] {
  const out: TestInstance[] = [];
  const walk = (n: TestInstance) => {
    if (n.props.accessibilityElementsHidden || n.props.importantForAccessibility === 'no-hide-descendants') return;
    if (typeof n.type === 'string' && (n.props.accessible === true || n.type === 'Text')) { out.push(n); return; }
    n.children.forEach((child) => { if (typeof child !== 'string') walk(child); });
  };
  walk(root);
  return out;
}

describe('SpaceInfoSheet Close (W897-CLOSE)', () => {
  it.each(CASES)('$name: the header leads with one visible Close, first for VoiceOver', async (c) => {
    const { sheet, close } = await open(c);
    expect(close.props.accessibilityRole).toBe('button');
    expect(close.props.accessibilityLabel).toBe('Close'); // the word the sheet already speaks (C6-S-137), nothing new
    // The one Close a screen reader can reach: the scrim behind is hidden by the modal sheet.
    expect(screen.getAllByRole('button', { name: 'Close' })).toEqual([close]);
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBe(close);
    const order = readingOrder(sheet);
    expect(order[0]).toBe(close);
    expect(order[1].props.accessibilityRole).toBe('header'); // then "# Everyone"
    // Header, not list: it stays on screen however far the people scroll.
    expect(within(screen.getByTestId('space-info-scroll')).queryByTestId('space-info-close')).toBeNull();
    const box = StyleSheet.flatten(close.props.style);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(within(close).queryByText(/[A-Za-z]{2,}/)).toBeNull(); // an X, no visible words
  });

  it.each(CASES)('$name: Close closes the sheet once, as the scrim does', async (c) => {
    const { onClose, onRetry, close } = await open(c);
    await fireEvent.press(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('space-info-scrim', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Android Back and the VoiceOver escape still close it; the sheet is modal for a screen reader', async () => {
    const { onClose, sheet } = await open(CASES[0]);
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    await fireEvent(sheet, 'requestClose'); // the Modal's onRequestClose: Android Back
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent(sheet, 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('the X is the community sheets\u2019 close glyph in forest, so it reads on the white sheet', async () => {
    const { close } = await open(CASES[0]);
    const texts: TestInstance[] = [];
    const walk = (n: TestInstance) => {
      if (n.type === 'Text') texts.push(n);
      n.children.forEach((child) => { if (typeof child !== 'string') walk(child); });
    };
    walk(close);
    expect(texts).toHaveLength(1); // the icon font's glyph
    expect(StyleSheet.flatten(texts[0].props.style)).toEqual(expect.objectContaining({ color: fp.forest, fontSize: 22 }));
  });

  it('failed: Try again still reloads and Close is a separate action that only closes', async () => {
    const { onClose, onRetry, sheet, close } = await open(CASES[5]);
    await fireEvent.press(within(sheet).getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.press(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('many people: Show more still asks for the next page, and Close stays first with Show more last', async () => {
    const { sheet, close } = await open(CASES[8]);
    const order = readingOrder(sheet);
    expect(order[0]).toBe(close);
    expect(order[order.length - 1].props.accessibilityLabel).toBe('Show more people');
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Show more people' }));
    expect(mockMembers.current.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
