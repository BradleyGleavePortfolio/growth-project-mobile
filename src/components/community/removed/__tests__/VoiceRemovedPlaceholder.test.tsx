/**
 * VoiceRemovedPlaceholder (REMOVED-BY-M item 3, owner #174-4): who reads which line for a coach-removed
 * voice note (RB-W4..RB-W6), and the row's newest voice GOAL style (#172-10: the B-06b fold).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import VoiceRemovedPlaceholder, { voiceRemovedLine } from '../VoiceRemovedPlaceholder';
import { lightTokens } from '../../../../theme/tokens';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

const removed = { author_id: 'u-author', removed_at: '2026-10-25T23:40:00Z', removed_by: { role: 'coach' as const, user_id: 'u-coach', name: 'Sam' } };

describe('voiceRemovedLine', () => {
  it('a live note has no line', () => {
    expect(voiceRemovedLine({ author_id: 'u-author' }, 'u-author')).toBeNull();
  });

  it('the remover, the author and everyone else each read their own line', () => {
    expect(voiceRemovedLine(removed, 'u-coach')).toEqual({ who: 'remover', text: 'You removed this voice note' });
    expect(voiceRemovedLine(removed, 'u-author')).toEqual({ who: 'author', text: 'Your coach removed your voice note' });
    expect(voiceRemovedLine(removed, 'u-other')).toEqual({ who: 'other', text: 'Removed by Coach Sam' });
    expect(voiceRemovedLine(removed, null)).toEqual({ who: 'other', text: 'Removed by Coach Sam' });
  });

  it('a blank coach name never leaves a dangling space', () => {
    const blank = { ...removed, removed_by: { ...removed.removed_by, name: '  ' } };
    expect(voiceRemovedLine(blank, 'u-other')?.text).toBe('Removed by Coach');
  });
});

describe('VoiceRemovedPlaceholder', () => {
  beforeEach(() => mockNavigate.mockReset());

  it('draws the quiet GOAL fold row in Inter, with no link for everyone else', async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <VoiceRemovedPlaceholder line={{ who: 'other', text: 'Removed by Coach Sam' }} testID="ph" />,
    );
    expect(StyleSheet.flatten(getByTestId('ph').props.style)).toMatchObject({
      borderStyle: 'dashed',
      borderRadius: 16,
      padding: 12,
    });
    expect(StyleSheet.flatten(getByText('Removed by Coach Sam').props.style)).toMatchObject({
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 18,
    });
    expect(queryByTestId('ph-safety')).toBeNull();
  });

  it('the author gets a Community safety link that opens the safety screen', async () => {
    const { getByTestId } = await render(
      <VoiceRemovedPlaceholder line={{ who: 'author', text: 'Your coach removed your voice note' }} testID="ph" />,
    );
    const link = getByTestId('ph-safety');
    expect(link.props.accessibilityRole).toBe('link');
    expect(link.props.accessibilityLabel).toBe('Community safety');
    await fireEvent.press(link);
    expect(mockNavigate).toHaveBeenCalledWith('CommunitySafety');
  });

  // FR-881R6 (brief: the placeholder line's colour): the line sits straight on the page (bgPrimary,
  // bone #F7FAF7; the app is light-only, ThemeProvider.tsx). WCAG AA body text needs 4.5:1.
  it('the line and its link read at least 4.5:1 on the page they sit on', async () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const { getByText } = await render(
      <VoiceRemovedPlaceholder line={{ who: 'author', text: 'Your coach removed your voice note' }} testID="ph" />,
    );
    const page = lightTokens.bgPrimary;
    const line = StyleSheet.flatten(getByText('Your coach removed your voice note').props.style).color as string;
    const link = StyleSheet.flatten(getByText('Community safety').props.style).color as string;
    expect(ratio(line, page)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(link, page)).toBeGreaterThanOrEqual(4.5);
  });
});
