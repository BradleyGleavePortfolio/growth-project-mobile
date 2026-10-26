/**
 * REMOVED-BY-M2 (agent 175): who reads which line on a row the coach removed (b#1165 CONTRACT 6405215872 section 2),
 * the voice and message nouns (RB-W8), the name fallback, and the author's link only where it can open.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import SpaceRemovedPlaceholder, { isCoachRemoved, spaceRemovedLine } from '../SpaceRemovedPlaceholder';

const BY = { role: 'coach', user_id: 'coach-1', name: ' Sam Okafor ' };
const row = (extra: Record<string, unknown> = {}) => ({ kind: 'text', sender_user_id: 'u-2', deleted: true, removed_by: BY, ...extra });

it('only a deleted row with removed_by is a coach removal', () => {
  expect(isCoachRemoved(row())).toBe(true);
  expect(isCoachRemoved(row({ removed_by: undefined }))).toBe(false);
  expect(isCoachRemoved(row({ removed_by: null }))).toBe(false);
  expect(isCoachRemoved(row({ deleted: false }))).toBe(false);
  expect(spaceRemovedLine(row({ removed_by: undefined }), 'u-2')).toBeNull();
});

it('remover, author and everyone else, for a message and a voice note', () => {
  expect(spaceRemovedLine(row(), 'coach-1')).toEqual({ who: 'remover', text: 'You removed this message' });
  expect(spaceRemovedLine(row(), 'u-2')).toEqual({ who: 'author', text: 'Your coach removed your message' });
  expect(spaceRemovedLine(row(), 'u-3')).toEqual({ who: 'other', text: 'Removed by Coach Sam Okafor' });
  expect(spaceRemovedLine(row({ kind: 'voice' }), 'coach-1')?.text).toBe('You removed this voice note');
  expect(spaceRemovedLine(row({ kind: 'voice' }), 'u-2')?.text).toBe('Your coach removed your voice note');
  expect(spaceRemovedLine(row({ kind: 'photo' }), 'u-2')?.text).toBe('Your coach removed your message');
  expect(spaceRemovedLine(row({ removed_by: { ...BY, name: '  ' } }), null)?.text).toBe('Removed by Coach');
});

it('the author gets the Community safety link when it can open; nobody else does', async () => {
  const onSafety = jest.fn();
  const author = await render(<SpaceRemovedPlaceholder id="r" line={{ who: 'author', text: 'Your coach removed your message' }} onSafety={onSafety} />);
  await fireEvent.press(author.getByLabelText('Community safety'));
  expect(onSafety).toHaveBeenCalledTimes(1);
  const noRoute = await render(<SpaceRemovedPlaceholder id="r" line={{ who: 'author', text: 'Your coach removed your message' }} />);
  expect(noRoute.queryByLabelText('Community safety')).toBeNull();
  const other = await render(<SpaceRemovedPlaceholder id="r" line={{ who: 'other', text: 'Removed by Coach Sam' }} onSafety={onSafety} />);
  expect(other.queryByLabelText('Community safety')).toBeNull();
});
