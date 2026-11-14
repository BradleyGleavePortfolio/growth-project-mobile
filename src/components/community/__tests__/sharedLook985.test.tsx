/**
 * REFINE-985: the client's DM thread moves toward Voice B Studio 05b only through optional props on shared community
 * pieces (ThreadHeader `voiceB`, MessageBubble `voiceB`, ComposerInput `voiceB`, CommunityEmptyState `voiceB`, SafetyMenu
 * `triggerColor` and `triggerSize`). Unset, each piece draws the numbers it drew at m#985's head f9492cbd (read from
 * that head's StyleSheets and written out here), and no caller but CommunityDmThreadScreen passes any of them.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  coachApi: {},
}));
const mockTheme = () => {
  const tokens = jest.requireActual('../../../theme/tokens');
  return { colors: jest.requireActual('../../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => mockTheme() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const { Text } = require('react-native');
  const Icon = (p: { name: string; color?: string; size?: number }) => R.createElement(Text, { testID: `icon-${p.name}`, style: { color: p.color, fontSize: p.size } }, '');
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: { getString: () => undefined, getStringAsync: async () => undefined, set: async () => undefined, delete: async () => undefined, getAllKeys: async () => [] },
  prefsStorage: { getString: () => undefined },
}));

const ThreadHeader = require('../ThreadHeader').default;
const MessageBubble = require('../MessageBubble').default;
const ComposerInput = require('../ComposerInput').default;
const CommunityEmptyState = require('../EmptyState').default;
const SafetyMenu = require('../SafetyMenu').default;
const { forestPop: fp, lightTokens: t, spacing, radius } = jest.requireActual('../../../theme/tokens');

const withQuery = (el: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>;
const css = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;
const ME = '00000010-0000-4000-8000-000000000000';
const OTHER = '00000020-0000-4000-8000-000000000000';
const message = (from: string) => ({ id: `m-${from}`, thread_id: 't', sender_user_id: from, recipient_user_id: from === ME ? OTHER : ME, body: 'Hi', created_at: '2026-11-13T16:00:00.000Z', deleted: false });

describe('REFINE-985: each shared piece with every new prop unset draws as at f9492cbd', () => {
  it('ThreadHeader, deep tone (the voice note page) and with a subtitle and initials (the coach\'s DM screens)', async () => {
    const plain = await render(<ThreadHeader tone="deep" title="Morning check-in" onBack={() => undefined} testID="h" />);
    expect(css(plain.getByTestId('h'))).toMatchObject({ gap: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, backgroundColor: fp.deep });
    expect(css(plain.getByTestId('h'))).not.toHaveProperty('paddingTop');
    expect(css(plain.getByText('Morning check-in'))).toMatchObject({ fontSize: 20, lineHeight: 25 });
    const coach = await render(<ThreadHeader tone="deep" title="Riley Park" subtitle="Client" initials="RP" onBack={() => undefined} testID="c" />);
    expect(css(coach.getByTestId('c-tile'))).toMatchObject({ width: 44, height: 44, borderRadius: radius.input, backgroundColor: fp.sage, borderColor: fp.sageLine });
    expect(css(within(coach.getByTestId('c-tile')).getByText('RP'))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: fp.forest });
    expect(css(coach.getByText('Client'))).toMatchObject({ fontSize: 14, lineHeight: 19 });
  });

  it('MessageBubble (the coaching chat, the coach\'s DM thread): today\'s bubble and time', async () => {
    const theirs = await render(<MessageBubble message={message(OTHER)} myUserId={ME} showTime testID="b" />);
    const [bubble] = theirs.container.queryAll((n) => typeof n.type === 'string' && css(n).maxWidth !== undefined);
    expect(css(bubble)).toMatchObject({ maxWidth: '82%', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, borderBottomLeftRadius: radius.sm, backgroundColor: t.bgSurface, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth });
    expect(theirs.queryByTestId('bubble-b')).toBeNull();
    const time = theirs.getByText(/\d:\d\d/);
    expect(css(time)).toMatchObject({ fontSize: 11, marginTop: 2, color: t.textMuted });
  });

  it('ComposerInput (the space chat, challenges, the coach\'s DM thread): today\'s bar, box and Send', async () => {
    const view = await render(<ComposerInput placeholder="Message" maxLength={4000} onSubmit={() => undefined} testID="k" />);
    expect(css(view.getByTestId('k'))).toMatchObject({ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, alignItems: 'flex-end', backgroundColor: t.bgSurface, borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth });
    expect(css(view.getByTestId('k-field'))).toMatchObject({ minHeight: 44, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15, borderColor: t.border });
    expect(view.getByTestId('k-field').props.placeholderTextColor).toBe(t.textMuted);
    expect(css(view.getByTestId('k-send'))).toMatchObject({ width: 44, height: 44, borderRadius: 22, backgroundColor: t.disabledBg });
    expect(css(within(view.getByTestId('k-send')).getByTestId('icon-arrow-up'))).toMatchObject({ color: t.textOnDisabled });
  });

  it('CommunityEmptyState (the DM list and every Community empty state): today\'s button', async () => {
    const view = await render(<CommunityEmptyState stem="dmInboxEmpty" title="No conversations yet" actionLabel="Message your coach" onAction={() => undefined} testID="e" />);
    expect(css(view.getByTestId('e-action'))).toMatchObject({ minHeight: 48, paddingHorizontal: spacing.xl, borderRadius: radius.md, backgroundColor: t.accent });
    expect(css(view.getByText('Message your coach'))).toMatchObject({ fontSize: 15, fontWeight: '600' });
    expect(css(view.getByText('Message your coach'))).not.toHaveProperty('lineHeight');
  });

  it('SafetyMenu (every report menu): today\'s 18 pt muted mark on its 44 pt target', async () => {
    const view = await render(withQuery(<SafetyMenu targetType="message" targetId="m-1" authorUserId={OTHER} authorName="Riley Park" viewerUserId={ME} testID="s" />));
    expect(css(view.getByTestId('s'))).toMatchObject({ minWidth: 44, minHeight: 44 });
    expect(css(within(view.getByTestId('s')).getByTestId('icon-ellipsis-horizontal'))).toMatchObject({ color: t.textMuted, fontSize: 18 });
  });

  it('SafetyMenu with the client DM thread\'s props: the mark takes them and keeps its 44 pt target', async () => {
    const view = await render(withQuery(<SafetyMenu targetType="message" targetId="m-1" authorUserId={OTHER} authorName="Riley Park" viewerUserId={ME} triggerColor={fp.onDeep} triggerSize={22} testID="s" />));
    expect(css(view.getByTestId('s'))).toMatchObject({ minWidth: 44, minHeight: 44 });
    expect(css(within(view.getByTestId('s')).getByTestId('icon-ellipsis-horizontal'))).toMatchObject({ color: fp.onDeep, fontSize: 22 });
  });
});

describe('REFINE-985: no caller but the client\'s DM thread passes a new prop', () => {
  const SRC = path.resolve(__dirname, '../../..');
  const DEFINES = ['components/community/ThreadHeader.tsx', 'components/community/MessageBubble.tsx', 'components/community/ComposerInput.tsx',
    'components/community/EmptyState.tsx', 'components/community/SafetyMenu.tsx'];
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : files(p);
    return /\.(tsx?|jsx?)$/.test(d.name) ? [p] : [];
  });

  it('every file under src that names voiceB, triggerColor or triggerSize is a defining piece or CommunityDmThreadScreen', () => {
    const users = files(SRC).filter((f) => /\b(voiceB|triggerColor|triggerSize)\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/')).sort();
    expect(users).toEqual([...DEFINES, 'screens/community/CommunityDmThreadScreen.tsx'].sort());
  });
});
