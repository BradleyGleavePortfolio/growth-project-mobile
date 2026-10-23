/**
 * BLOCK-ALL-M: the shared "this conversation is closed" rule (owner 10-22 "hide ALL messaging entirely, dont even let
 * the banned person type!"; #168-4 op 1). Closed when I blocked the other person, or when the server answers a read or
 * a send with one of its existing refusals; an unblock opens it again; the closed line names nobody.
 */
import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';

const mockWarning = jest.fn(async () => undefined);
jest.mock('../../../ui/haptics/haptics.service', () => ({
  get HapticService() {
    return { warning: mockWarning, softImpact: jest.fn(async () => undefined) };
  },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { CommunityApiError } from '../../../api/apiCall';
import { NavigationContext } from '@react-navigation/native';
import { fireEvent } from '@testing-library/react-native';
import {
  BLOCKED_BY_ME_LINE, CLOSED_LINE, ConversationClosedLine, dmRowFor, isClosedRefusal, useConversationClosed,
} from '../ConversationClosed';

const axiosErr = (status: number, data: Record<string, unknown>) => ({ isAxiosError: true, response: { status, data } });
const COACHING_BLOCKED = { error: 'BLOCKED', message: 'Messages cannot be sent to blocked users' };

beforeEach(() => {
  mockWarning.mockClear();
  useBlockedUsersStore.setState({ blocked: [] });
});

describe('isClosedRefusal', () => {
  it.each([
    ['coaching send, block either way (403 BLOCKED)', axiosErr(403, COACHING_BLOCKED)],
    ['coaching edit / pin (messaging.blocked)', axiosErr(403, { error: 'messaging.blocked', code: 'messaging.blocked' })],
    ['DM to someone I blocked', axiosErr(403, { error: 'forbidden', code: 'community.dm.blocked_by_you' })],
    ['DM with someone who blocked me (not disclosed)', axiosErr(404, { error: 'not_found', code: 'community.dm.not_found' })],
    ['banned from the space', axiosErr(403, { code: 'community.workspace.no_access' })],
    ['banned from the cohort', axiosErr(403, { code: 'community.cohort.no_access' })],
    ['Hall posts after a ban', axiosErr(404, { code: 'community.post.not_found' })],
    ['challenge notes after a ban', axiosErr(404, { code: 'community.challenge.not_found' })],
    ['MessagingApiError with the code', { status: 403, code: 'messaging.blocked' }],
    ['CommunityApiError from the community API (axios error kept as cause)',
      new CommunityApiError('unknown', 404, 'community request failed (404)', axiosErr(404, { code: 'community.post.not_found' }))],
    ['MessagingApiError with only the server text', { status: 403, code: null, userMessage: COACHING_BLOCKED.message }],
  ])('%s -> closed', (_label, err) => {
    expect(isClosedRefusal(err)).toBe(true);
  });

  it.each([
    ['network error', new Error('Network Error')],
    ['content filter', axiosErr(422, { code: 'community.content.rejected' })],
    ['coach read-only space (not a ban)', axiosErr(403, { code: 'community.space.read_only' })],
    ['plain 403 without the block text', axiosErr(403, { error: 'Forbidden', message: 'Nope' })],
    ['nothing', null],
    ['CommunityApiError for a server failure', new CommunityApiError('server', 500, 'community request failed (500)', axiosErr(500, {}))],
  ])('%s -> open', (_label, err) => {
    expect(isClosedRefusal(err)).toBe(false);
  });
});

describe('useConversationClosed', () => {
  it('open by default; closed when I blocked them; an unblock opens it again', async () => {
    const { result } = await renderHook(() => useConversationClosed('coach-1'));
    expect(result.current.closed).toBe(false);
    await act(async () => useBlockedUsersStore.setState({ blocked: [{ id: 'coach-1', displayName: 'Roman', blockedAt: '2026-10-22T00:00:00Z' }] }));
    expect(result.current.closed).toBe(true);
    await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
    expect(result.current.closed).toBe(false);
  });

  it('a block on someone else leaves this conversation open', async () => {
    useBlockedUsersStore.setState({ blocked: [{ id: 'other', displayName: 'X', blockedAt: '2026-10-22T00:00:00Z' }] });
    expect((await renderHook(() => useConversationClosed('coach-1'))).result.current.closed).toBe(false);
  });

  it('a refused send closes it at once with a warning haptic; other failures leave it open', async () => {
    const { result } = await renderHook(() => useConversationClosed('coach-1'));
    let r = true;
    await act(async () => { r = result.current.close(new Error('Network Error')); });
    expect(r).toBe(false);
    expect(result.current.closed).toBe(false);
    expect(mockWarning).not.toHaveBeenCalled();
    await act(async () => { r = result.current.close(axiosErr(403, COACHING_BLOCKED)); });
    expect(r).toBe(true);
    expect(result.current.closed).toBe(true);
    expect(mockWarning).toHaveBeenCalledTimes(1);
  });

  it('a server refusal the screen already holds (blocked by them, banned) closes it', async () => {
    const { result, rerender } = await renderHook(({ errs }: { errs: unknown[] }) => useConversationClosed(null, errs), {
      initialProps: { errs: [null] as unknown[] },
    });
    expect(result.current.closed).toBe(false);
    await rerender({ errs: [axiosErr(404, { code: 'community.dm.not_found' })] });
    expect(result.current.closed).toBe(true);
  });

  it('closed by my block, then I unblock: a refusal from before the unblock no longer holds it closed', async () => {
    useBlockedUsersStore.setState({ blocked: [{ id: 'coach-1', displayName: 'Roman', blockedAt: '2026-10-22T00:00:00Z' }] });
    const { result } = await renderHook(() => useConversationClosed('coach-1'));
    await act(async () => { result.current.close(axiosErr(403, COACHING_BLOCKED)); });
    expect(result.current.closed).toBe(true);
    await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
    expect(result.current.closed).toBe(false);
  });
});

describe('ConversationClosedLine', () => {
  it('says the conversation is closed, names nobody, and is announced', async () => {
    const view = await render(<ConversationClosedLine testID="closed" />);
    const line = view.getByTestId('closed');
    expect(view.getByText(CLOSED_LINE)).toBeTruthy();
    expect(line.props.accessibilityLabel).toBe('This conversation is closed');
    expect(line.props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('#169-5 CLOSED-LINE: who closed a one-to-one conversation', () => {
  const byOf = async (other: string | null, errs: unknown[] = [], row?: { closed?: boolean; blocked_by_me?: boolean }) =>
    (await renderHook(() => useConversationClosed(other, errs, row))).result.current;

  it('BAM-2a when I blocked them: my block list, the row, or blocked_by_you', async () => {
    expect((await byOf(null, [axiosErr(403, { code: 'community.dm.blocked_by_you' })])).by).toBe('me');
    expect(await byOf('x', [], { closed: true, blocked_by_me: true })).toMatchObject({ closed: true, by: 'me' });
    useBlockedUsersStore.setState({ blocked: [{ id: 'x', displayName: 'Sam', blockedAt: '2026-10-22T00:00:00Z' }] });
    expect((await byOf('x', [axiosErr(403, COACHING_BLOCKED)])).by).toBe('me');
  });

  it('BAM-2b when they blocked me: the row, blocked_by_them, or a coaching refusal with no block of mine', async () => {
    expect(await byOf('x', [], { closed: true, blocked_by_me: false })).toMatchObject({ closed: true, by: 'them' });
    expect((await byOf(null, [axiosErr(403, { error: 'forbidden', code: 'community.dm.blocked_by_them' })])).by).toBe('them');
    expect((await byOf('x', [axiosErr(403, COACHING_BLOCKED)])).by).toBe('them');
  });

  it('BAM-1 for a ban or a member who left; an open row stays open', async () => {
    expect(await byOf(null, [axiosErr(404, { code: 'community.dm.not_found' })])).toMatchObject({ closed: true, by: null });
    expect(await byOf(null, [axiosErr(403, { code: 'community.workspace.no_access' })])).toMatchObject({ closed: true, by: null });
    expect(await byOf('x', [], { closed: false, blocked_by_me: false })).toMatchObject({ closed: false, by: null });
  });

  it('dmRowFor reads the DM-list row of that member only', () => {
    const rows = [{ other_user_id: 'x', closed: true, blocked_by_me: false, other_display_name: 'Sam' }, { other_user_id: 'y' }];
    expect(dmRowFor(rows, 'x')).toEqual({ closed: true, blocked_by_me: false, name: 'Sam' });
    expect(dmRowFor(rows, 'y')).toEqual({ closed: false, blocked_by_me: false, name: undefined });
    expect(dmRowFor(rows, 'z')).toBeNull();
    expect(dmRowFor(undefined, 'x')).toBeNull();
  });

  it('the lines: BAM-2a, BAM-2b with the name, BAM-1 when there is no name', async () => {
    expect((await render(<ConversationClosedLine by="me" />)).getByLabelText(BLOCKED_BY_ME_LINE)).toBeTruthy();
    expect((await render(<ConversationClosedLine by="them" name=" Sam Lee " />)).getByText('Sam Lee has blocked you')).toBeTruthy();
    expect((await render(<ConversationClosedLine by="them" name="" />)).getByText(CLOSED_LINE)).toBeTruthy();
  });

  it.each([
    ['client (You stack)', 'MoreTab'],
    ['coach (Settings stack)', 'SettingsStack'],
  ])('"Settings" opens the blocked-people list: %s', async (_who, tab) => {
    const navigate = jest.fn();
    const stack = { getState: () => ({ routeNames: ['Messages'] }), navigate: jest.fn(), getParent: () => tabs };
    const tabs = { getState: () => ({ routeNames: ['Home', tab] }), navigate, getParent: () => undefined };
    const view = await render(
      <NavigationContext.Provider value={stack as never}>
        <ConversationClosedLine by="me" testID="closed" />
      </NavigationContext.Provider>,
    );
    expect(view.getByTestId('closed').props.accessibilityRole).toBe('link');
    expect(view.getByText('Settings')).toBeTruthy();
    await fireEvent.press(view.getByTestId('closed'));
    expect(navigate).toHaveBeenCalledWith(tab, { screen: 'BlockedUsers', initial: false });
  });

  it('with no blocked-people list in reach, BAM-2a is plain text (no dead link)', async () => {
    const view = await render(<ConversationClosedLine by="me" testID="closed" />);
    expect(view.getByTestId('closed').props.accessibilityRole).toBe('text');
  });
});
