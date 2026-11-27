/**
 * COMMUNITY-DM-FORMER-REACH-M, class guard: Style 3's sheet (FormerCoachSheet) offers Block and Report beside the app's
 * SafetyMenu, so it must ask and answer in SafetyMenu's approved words. Both real components, one table: each row
 * taps the same action in each and compares every Alert they raise (title, body, buttons). Android raises the
 * follow-up Alert as soon as the sheet closes, so no Modal dismiss is needed. Names and ids are fictional.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: {} })), post: (...a: unknown[]) => mockPost(...a), delete: jest.fn() },
  coachApi: {},
}));
const mockTheme = () => {
  const tokens = jest.requireActual('../../../theme/tokens');
  return { colors: jest.requireActual('../../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => mockTheme() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), captureException: jest.fn() }));

const SafetyMenu = require('../SafetyMenu').default;
const { FormerCoachSheet } = require('../FormerCoach');

const MAYA = '00000030-0000-4000-8000-000000000000';
const MSG = '00000901-0000-4000-8000-000000000000';
const realOS = Platform.OS;
let alert: jest.SpyInstance;
beforeEach(() => {
  mockPost.mockReset();
  mockPost.mockImplementation(async (url: string) => ({ data: url === '/community/blocks' ? { blocked_user_id: MAYA, blocked: true } : {} }));
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
afterEach(() => {
  alert.mockRestore();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>);
type Said = Array<[string, string?, Array<{ text?: string; style?: string }>?]>;
const said = (): Said => alert.mock.calls.map(([t, b, buttons]) => [t, b, (buttons ?? []).map(({ text, style }: { text?: string; style?: string }) => ({ text, style }))]);

async function viaSafetyMenu(name: string | null, act1: 'block' | 'report'): Promise<Said> {
  const v = await wrap(<SafetyMenu targetType="message" targetId={MSG} authorUserId={MAYA} authorName={name} viewerUserId="me" viewerCoachId="lee" testID="sm" />);
  await fireEvent.press(v.getByTestId('sm'));
  if (act1 === 'block') await fireEvent.press(v.getByTestId('sm-block'));
  else {
    await fireEvent.press(v.getByTestId('sm-report'));
    await fireEvent.press(v.getByTestId('sm-reason-self_harm'));
  }
  return said();
}
async function viaFormerSheet(name: string | null, act1: 'block' | 'report'): Promise<Said> {
  const v = await wrap(<FormerCoachSheet visible name={name} coachId={MAYA} reportMessageId={MSG} onClose={() => undefined} onBlocked={() => undefined} />);
  if (act1 === 'block') await fireEvent.press(v.getByTestId('former-sheet-block'));
  else {
    await fireEvent.press(v.getByTestId('former-sheet-report'));
    await fireEvent.press(v.getByTestId('former-sheet-reason-self_harm'));
  }
  return said();
}

describe.each([
  ['named, block', 'Maya Brooks', 'block'],
  ['no name, block', null, 'block'],
  ['report (the 911 / 988 line after Self-harm)', 'Maya Brooks', 'report'],
] as const)('%s', (_label, name, act1) => {
  it('the Style 3 sheet says exactly what SafetyMenu says', async () => {
    const menu = await viaSafetyMenu(name, act1);
    alert.mockClear();
    const sheet = await viaFormerSheet(name, act1);
    expect(menu.length).toBeGreaterThan(0);
    expect(sheet).toEqual(menu);
  });
});

it('confirming Block in the sheet blocks her old coach (203-D51) through the same call', async () => {
  const onBlocked = jest.fn();
  const v = await wrap(<FormerCoachSheet visible name="Maya Brooks" coachId={MAYA} reportMessageId={null} onClose={() => undefined} onBlocked={onBlocked} />);
  expect(v.queryByTestId('former-sheet-report')).toBeNull(); // nothing to report yet: no row that leads nowhere
  await fireEvent.press(v.getByTestId('former-sheet-block'));
  const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => Promise<void> }>;
  await act(async () => { await buttons.find((b) => b.text === 'Block')?.onPress?.(); });
  expect(mockPost).toHaveBeenCalledWith('/community/blocks', { user_id: MAYA }, expect.anything());
  expect(onBlocked).toHaveBeenCalled();
});
